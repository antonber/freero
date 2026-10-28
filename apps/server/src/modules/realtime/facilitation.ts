// Facilitator controls (KAI-129), enforced here next to the comment rules (commentRules.ts).
//
// The `facilitation` collection of the shared doc holds at most one FacilitationSession
// (@freero/shared). While it is set, every editor socket except the facilitator's is limited (the
// board owner never is: it is their board, and they may end anyone's session):
//
//   locked         the socket's EFFECTIVE role is commenter: its doc updates go through the
//                  commenter filter (comments only) and it may not write layers. The client is
//                  told with a role message carrying `limits`, so its UI drops to commenting.
//   allowedTypes   it may not ADD elements of other types. Its update is applied together with a
//                  compensation in the SAME transaction (the added element removed again), so
//                  nobody else ever receives it and the sender's doc converges (it is sent the
//                  compensation) instead of diverging the way a dropped update would.
//
// Why compensation and not dropping for added types: a Yjs client's updates are one gap-free
// sequence, so a dropped update leaves every later update of that client pending on the server.
// A participant's own client never sends a forbidden add (the engine mirrors the limits), so this
// only meets forged clients and races with a limit that was just set.
//
// What counts as ADDING: an element id that is in none of the room's docs and was not removed
// from one moments ago. Moving an element between the shared doc and a layer (hiding a frame,
// private mode) arrives as a delete in one doc and an insert in another, in either order; that is
// not new content. Changing an existing element into a forbidden type is adding too.
//
// Who may write the collection: anyone who may edit may START a session naming themselves; once
// one runs, only its facilitator or the board owner may change or end it, and nobody may hand it
// to someone else. Other writes are compensated the same way. Following and hidden cursors are
// views each client applies; they are not enforceable and not enforced.
import * as Y from 'yjs';
import { FACILITATION_COLLECTION, FACILITATION_KEY, type FacilitationSession, type Role, type SessionLimits } from '@freero/shared';

const canEdit = (role: Role) => role === 'owner' || role === 'editor';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A well-formed session value, or null. */
export function asSession(v: unknown): FacilitationSession | null {
  if (!isObj(v)) return null;
  const { by, byName, startedAt, locked, allowedTypes, follow, cursorsHidden } = v;
  if (typeof by !== 'string' || !by || typeof byName !== 'string' || typeof startedAt !== 'number') return null;
  if (typeof locked !== 'boolean' || typeof follow !== 'boolean' || typeof cursorsHidden !== 'boolean') return null;
  if (allowedTypes !== null && !(Array.isArray(allowedTypes) && allowedTypes.every((t) => typeof t === 'string'))) return null;
  return { by, byName, startedAt, locked, allowedTypes: allowedTypes as string[] | null, follow, cursorsHidden };
}

export function readFacilitation(doc: Y.Doc): FacilitationSession | null {
  if (!doc.share.has(FACILITATION_COLLECTION)) return null;
  return asSession(doc.getMap<unknown>(FACILITATION_COLLECTION).get(FACILITATION_KEY));
}

export interface Effective {
  role: Role;
  limits: SessionLimits | null;
}

/** What a socket of `userId` with access `access` may do while `session` runs. */
export function effectiveAccess(access: Role, userId: string, session: FacilitationSession | null): Effective {
  if (!session || access !== 'editor' || userId === session.by || (!session.locked && !session.allowedTypes)) return { role: access, limits: null };
  return {
    role: session.locked ? 'commenter' : access,
    limits: { byName: session.byName, locked: session.locked, addTypes: session.allowedTypes ? [...session.allowedTypes] : null },
  };
}

export const sameEffective = (a: Effective, b: Effective) => a.role === b.role && JSON.stringify(a.limits) === JSON.stringify(b.limits);

/** May `who` turn the collection's session value `before` into `after`? */
export function mayChangeSession(before: unknown, after: unknown, who: { userId: string; access: Role }): boolean {
  if (JSON.stringify(before) === JSON.stringify(after)) return true;
  if (!canEdit(who.access)) return false;
  const prev = asSession(before);
  const next = after === undefined ? null : asSession(after);
  if (after !== undefined && !next) return false; // only well-formed sessions
  if (!prev) return !next || next.by === who.userId; // start one as yourself (or clear garbage)
  if (who.userId !== prev.by && who.access !== 'owner') return false;
  return !next || next.by === prev.by;
}

// ---------------------------------------------------------------- inside a transaction
//
// Y.YMapEvent computes old values only once the transaction's delete set is sorted (in its
// cleanup), so the same diff is computed here by scanning the transaction's delete set.

interface ItemLike {
  id: { client: number; clock: number };
  length: number;
  left: ItemLike | null;
  deleted: boolean;
  content: { getContent(): unknown[] };
}

function deletedIn(tr: Y.Transaction, item: ItemLike): boolean {
  const ranges = tr.deleteSet.clients.get(item.id.client);
  return !!ranges && ranges.some((r) => item.id.clock >= r.clock && item.id.clock < r.clock + r.len);
}
const addedIn = (tr: Y.Transaction, item: ItemLike) => item.id.clock >= (tr.beforeState.get(item.id.client) ?? 0);
const lastValue = (item: ItemLike) => {
  const c = item.content.getContent();
  return c[c.length - 1];
};

/**
 * Keys of `map` this transaction changed so far, with the value each had before it. `map` must
 * have been created (getMap) before the transaction: an update that creates a root type makes a
 * placeholder that getMap later replaces, and its changes are recorded under the placeholder.
 */
export function changedKeys(tr: Y.Transaction, map: Y.Map<unknown>): Map<string, { before: unknown; after: unknown }> {
  const out = new Map<string, { before: unknown; after: unknown }>();
  const keys = tr.changed.get(map as unknown as Y.AbstractType<Y.YEvent<any>>);
  if (!keys) return out;
  const items = (map as unknown as { _map: Map<string, ItemLike> })._map;
  for (const key of keys) {
    if (key === null) continue;
    const item = items.get(key);
    if (!item) continue;
    let before: unknown;
    if (addedIn(tr, item)) {
      let prev = item.left;
      while (prev && addedIn(tr, prev)) prev = prev.left;
      before = prev && deletedIn(tr, prev) ? lastValue(prev) : undefined;
    } else before = deletedIn(tr, item) ? lastValue(item) : map.get(key);
    const after = map.get(key);
    if (before !== undefined || after !== undefined) out.set(key, { before, after });
  }
  return out;
}

function restore(map: Y.Map<unknown>, key: string, before: unknown): void {
  if (before === undefined) map.delete(key);
  else map.set(key, before);
}

/** Undoes changes of the facilitation collection `who` may not make. True when it did. */
export function guardSession(tr: Y.Transaction, doc: Y.Doc, who: { userId: string; access: Role }): boolean {
  if (!doc.share.has(FACILITATION_COLLECTION)) return false;
  const map = doc.getMap<unknown>(FACILITATION_COLLECTION);
  let reverted = false;
  for (const [key, { before, after }] of changedKeys(tr, map)) {
    if (key === FACILITATION_KEY && mayChangeSession(before, after, who)) continue;
    restore(map, key, before);
    reverted = true;
  }
  return reverted;
}

const typeOf = (v: unknown) => (isObj(v) && typeof v.type === 'string' ? v.type : null);

/**
 * Undoes elements this transaction ADDED (see the header) whose type is not in `allowed`.
 * `existsElsewhere(id)`: the id is in another doc of the room, or left one moments ago.
 * Returns how many it undid.
 */
export function revertForbiddenAdds(
  tr: Y.Transaction,
  elements: Y.Map<unknown>,
  allowed: ReadonlySet<string>,
  existsElsewhere: (id: string) => boolean,
): number {
  let n = 0;
  for (const [key, { before, after }] of changedKeys(tr, elements)) {
    if (after === undefined) continue; // removing is not adding
    const type = typeOf(after);
    if (type && allowed.has(type)) continue;
    if (before !== undefined ? typeOf(before) === type : existsElsewhere(key)) continue;
    restore(elements, key, before);
    n++;
  }
  return n;
}
