// Guest editing (#97, @freero/shared guestEditing.ts): a guest on a board that lets guests edit is
// still a COMMENTER (its access, its layers, its comments); its board socket may also write the
// shared doc's `elements`, judged here:
//
//   who            a guest socket whose access says so (boards' describeAccess `guestEdit`: the board's
//                  switch, a "can edit" link, the workspace's `guestEditing` policy, the operator),
//                  re-resolved on every access refresh, while no facilitator locked the board
//                  (`guestGrantFor`; a facilitator's allowed types narrow what it may add). rooms.ts
//                  sends it in the role message (`guestEdit`) and recomputes it with the role.
//   the update     may touch only `elements`, `comments` (commenter rules) and, for a participant,
//                  `voting` / `estimation` — top-level maps, plain values (`touchedRoots`, read
//                  from the update itself against the room's doc: no copy of the doc per update, a
//                  guest drags items). Anything else comes from a forged client: dropped like a
//                  commenter's.
//   inside the     `guardGuestEdits` undoes, in the transaction that applies it (facilitation.ts
//   transaction    explains why compensation, not dropping): a change or deletion of an element the
//                  guest didn't create or that is locked, a change of its type, locking, protecting
//                  or linking it; an add of a type outside its grant, locked or linked, or past
//                  GUEST_EDIT_LIMITS (per guest per hour, per guest, guests' items on the board).
//                  Past the socket's rate (a token bucket) every change of an update is undone.
//                  attribution.ts stamps `createdBy` and `guestName` on what it adds.
//
// What the guest is told: the correction (its doc converges) and, at most every few seconds per
// reason, a GuestEditNotice (WS_MESSAGE_NOTICE) the client shows.
import * as Y from 'yjs';
import {
  GUEST_EDIT_LIMITS,
  GUEST_EDIT_TYPES,
  guestMayChange,
  isGuestId,
  WS_MESSAGE_NOTICE,
  Y_ELEMENTS,
  type ElementType,
  type FacilitationSession,
  type GuestEditGrant,
  type GuestEditNotice,
  type GuestEditNoticeCode,
} from '@freero/shared';
import * as encoding from 'lib0/encoding';
import type { Attribution } from './attribution';
import { changedKeys } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a guest socket may do while `session` runs (null: nothing beyond commenting — the board is locked). */
export function guestGrantFor(session: FacilitationSession | null): GuestEditGrant | null {
  if (session?.locked) return null;
  const allowed = session?.allowedTypes;
  return { types: GUEST_EDIT_TYPES.filter((t) => !allowed || allowed.includes(t)) as ElementType[] };
}

export const sameGrant = (a: GuestEditGrant | null, b: GuestEditGrant | null) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- what an update touches

/** Content refs (Yjs) of plain values: deleted, JSON, binary, any. Types, text and subdocs are not. */
const PLAIN_CONTENT = new Set([1, 2, 3, 8]);

/** The top-level name of a type in `doc`, or null when it is nested (or not a root at all). */
function topLevelName(doc: Y.Doc, type: unknown): string | null {
  if (!(type instanceof Y.AbstractType) || type._item) return null;
  for (const [name, root] of doc.share) if (root === type) return name;
  return null;
}

/**
 * The top-level maps `update` writes in `doc` — inserts and deletions — or null when it writes
 * anything else: a nested shared type, text, a subdoc, or structs the room doesn't know (an update
 * that would stay pending). Read from the update's structs; origins are looked up in the update
 * itself, then in the doc.
 */
export function touchedRoots(doc: Y.Doc, update: Uint8Array): Set<string> | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return null;
  }
  const roots = new Set<string>();
  // This update's own items, by client: [clock, length, root].
  const own = new Map<number, Array<[number, number, string]>>();
  const inUpdate = (id: Y.ID): string | undefined => {
    for (const [clock, len, root] of own.get(id.client) ?? []) if (id.clock >= clock && id.clock < clock + len) return root;
    return undefined;
  };
  const inDoc = (id: Y.ID): string | null | undefined => {
    if (id.clock >= Y.getState(doc.store, id.client)) return undefined;
    let item: unknown;
    try {
      item = Y.getItem(doc.store, id);
    } catch {
      return undefined;
    }
    return item instanceof Y.Item ? topLevelName(doc, item.parent) : null;
  };
  const items: Y.Item[] = [];
  // Each client's structs must continue where the doc stands: a gap would leave them pending.
  const next = new Map<number, number>();
  for (const s of decoded.structs) {
    if (s.constructor.name === 'Skip') return null;
    const at = next.get(s.id.client) ?? Y.getState(doc.store, s.id.client);
    if (s.id.clock > at) return null;
    next.set(s.id.client, Math.max(at, s.id.clock + s.length));
    if (s instanceof Y.Item) items.push(s);
  }
  // Items whose parent is given come first; the others (map overwrites, list inserts) find it
  // through their origin, which may be another item of this update: a few passes settle it.
  let pending = items;
  for (let pass = 0; pending.length && pass < 4; pass++) {
    const later: Y.Item[] = [];
    for (const it of pending) {
      if (!PLAIN_CONTENT.has(it.content.getRef())) return null;
      const parent = it.parent as unknown;
      let root: string | null | undefined;
      if (typeof parent === 'string') root = parent;
      else if (parent) return null; // a nested type's id
      else {
        const origin = it.origin ?? it.rightOrigin;
        if (!origin) return null;
        root = inUpdate(origin) ?? inDoc(origin);
      }
      if (root === null) return null;
      if (root === undefined) {
        later.push(it);
        continue;
      }
      roots.add(root);
      const list = own.get(it.id.client) ?? [];
      list.push([it.id.clock, it.length, root]);
      own.set(it.id.client, list);
    }
    if (later.length === pending.length) return null;
    pending = later;
  }
  if (pending.length) return null;
  for (const [client, ranges] of decoded.ds.clients) {
    for (const r of ranges) {
      for (let clock = r.clock; clock < r.clock + r.len; ) {
        const id = Y.createID(client, clock);
        const local = inUpdate(id);
        if (local !== undefined) {
          roots.add(local);
          clock++;
          continue;
        }
        if (clock >= Y.getState(doc.store, client)) return null;
        let item: unknown;
        try {
          item = Y.getItem(doc.store, id);
        } catch {
          return null;
        }
        if (item instanceof Y.Item) {
          const root = topLevelName(doc, item.parent);
          if (root === null) return null;
          roots.add(root);
          clock = item.id.clock + item.length;
        } else clock++;
      }
    }
  }
  return roots;
}

// ---------------------------------------------------------------- inside the transaction

/** How many items a guest may still add, counted once per update that adds (see the header). */
export interface GuestBudget {
  /** The guest's adds within the last hour on this board (timestamps, kept by the room). */
  recent: number[];
}

export interface GuestEditContext {
  guestId: string;
  grant: GuestEditGrant;
  /** The socket is past its rate: every change of this update is undone. */
  frozen: boolean;
  budget: GuestBudget;
  /** The attribution the room already holds for element `id` elsewhere (moved, removed lately). */
  known(id: string): Attribution | undefined;
  now: number;
}

const HOUR_MS = 60 * 60_000;
const sameLink = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
/** Content from outside the board a guest may not bring in: an uploaded or remote picture as a sticker. */
const outsideContent = (el: Record<string, unknown>) => typeof el.emoji === 'string' && el.emoji.startsWith('img:');

/** Undoes what a guest socket may not do to `elements` in this transaction. */
export function guardGuestEdits(tr: Y.Transaction, elements: Y.Map<unknown>, ctx: GuestEditContext): { reverted: number; refused: GuestEditNoticeCode | null } {
  const changes = changedKeys(tr, elements);
  let reverted = 0;
  let refused: GuestEditNoticeCode | null = null;
  const undo = (key: string, before: unknown) => {
    if (before === undefined) elements.delete(key);
    else elements.set(key, before);
    reverted++;
  };
  // Counted lazily: only an update that adds anything pays for a scan of the board.
  let counts: { mine: number; guests: number } | null = null;
  const added = new Set([...changes].filter(([, c]) => c.before === undefined).map(([k]) => k));
  const count = () => {
    if (counts) return counts;
    counts = { mine: 0, guests: 0 };
    elements.forEach((v, k) => {
      if (added.has(k) || !isObj(v) || typeof v.createdBy !== 'string' || !isGuestId(v.createdBy)) return;
      counts!.guests++;
      if (v.createdBy === ctx.guestId) counts!.mine++;
    });
    return counts;
  };
  const types = new Set<string>(ctx.grant.types);
  ctx.budget.recent = ctx.budget.recent.filter((t) => ctx.now - t < HOUR_MS);
  for (const [key, { before, after }] of changes) {
    if (ctx.frozen) {
      undo(key, before);
      refused = 'rate';
      continue;
    }
    if (before !== undefined) {
      const ok =
        guestMayChange(before, ctx.guestId) &&
        (after === undefined ||
          (isObj(after) &&
            after.type === (before as Record<string, unknown>).type &&
            !after.locked &&
            !after.lockProtected &&
            !outsideContent(after) &&
            sameLink(after.link, (before as Record<string, unknown>).link)));
      if (!ok) undo(key, before);
      continue;
    }
    if (after === undefined) continue;
    const prior = ctx.known(key);
    const ok =
      isObj(after) &&
      typeof after.type === 'string' &&
      types.has(after.type) &&
      !after.locked &&
      !after.lockProtected &&
      !after.link &&
      !outsideContent(after) &&
      (!prior || prior.createdBy === ctx.guestId);
    if (!ok) {
      undo(key, before);
      continue;
    }
    if (prior) continue; // its own item back (an undo of its deletion): no new content
    const c = count();
    const limit: GuestEditNoticeCode | null =
      ctx.budget.recent.length >= GUEST_EDIT_LIMITS.itemsPerHour
        ? 'hourly'
        : c.mine >= GUEST_EDIT_LIMITS.itemsPerGuest
          ? 'total'
          : c.guests >= GUEST_EDIT_LIMITS.guestItemsPerBoard
            ? 'board'
            : null;
    if (limit) {
      undo(key, before);
      refused = limit;
      continue;
    }
    c.mine++;
    c.guests++;
    ctx.budget.recent.push(ctx.now);
  }
  return { reverted, refused };
}

// ---------------------------------------------------------------- the socket's rate

export interface TokenBucket {
  tokens: number;
  at: number;
}

export const newBucket = (now: number): TokenBucket => ({ tokens: GUEST_EDIT_LIMITS.updateBurst, at: now });

/** Takes one token for an update; false when the socket is past its rate. */
export function takeToken(b: TokenBucket, now: number): boolean {
  b.tokens = Math.min(GUEST_EDIT_LIMITS.updateBurst, b.tokens + ((now - b.at) / 1000) * GUEST_EDIT_LIMITS.updatesPerSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function encodeGuestNotice(code: GuestEditNoticeCode): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, WS_MESSAGE_NOTICE);
  encoding.writeVarString(e, JSON.stringify({ type: 'guest-edit', code } satisfies GuestEditNotice));
  return encoding.toUint8Array(e);
}

/** Every element `guestId` added, in `doc` (the owner's "Remove everything they added"). */
export function guestItemIds(doc: Y.Doc, guestId: string): string[] {
  const out: string[] = [];
  doc.getMap<unknown>(Y_ELEMENTS).forEach((v, k) => {
    if (isObj(v) && v.createdBy === guestId) out.push(k);
  });
  return out;
}

/** Items per guest in `doc`, for the owner's guest list. */
export function guestItemCounts(doc: Y.Doc): Map<string, { items: number; name: string | null }> {
  const out = new Map<string, { items: number; name: string | null }>();
  doc.getMap<unknown>(Y_ELEMENTS).forEach((v) => {
    if (!isObj(v) || typeof v.createdBy !== 'string' || !isGuestId(v.createdBy)) return;
    const cur = out.get(v.createdBy) ?? { items: 0, name: null };
    cur.items++;
    if (typeof v.guestName === 'string') cur.name = v.guestName;
    out.set(v.createdBy, cur);
  });
  return out;
}
