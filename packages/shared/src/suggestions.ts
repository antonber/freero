// ---- Suggestions (KAI-169): changes proposed for people to accept ----
// An agent, an app or an AI action can SUGGEST instead of edit: new items, field changes of items
// on the board, deletions. A suggestion is not board content until someone who may edit accepts
// it, so it never enters the shared doc: it lives in the `suggestions` collection of the board's
// `editors` layer (see "Board layers" in ARCHITECTURE.md), which the server sends only to owners'
// and editors' sockets. Viewers, commenters and guests who can't edit never receive it.
//
//   key      record id
//   value    SuggestionRecord (one proposed change of ONE item; a proposal of many items shares
//            a `groupId`, and every record carries the group's author and description)
//
// Who writes what (server-enforced, apps/server/src/modules/realtime/suggestions.ts):
//   - records are CREATED only by the server (the public API, structure insertion with
//     target 'suggestions', in-app AI): the author badge can't be forged by a socket.
//   - an owner's/editor's socket may only set or clear `decision` on a record (accept, reject,
//     undo of either), naming themselves. The accepted change itself is an ordinary edit of the
//     shared doc in the same client transaction (one undo step).
//   - decided records are kept for a while (undo needs them) and pruned by the server.
//
// Stale: when the item a suggestion changes was edited (the fields it changes, for an update;
// anything about it, for a deletion) or deleted after it was proposed, accepting it would
// silently overwrite someone's work, so it shows as stale and is applied only when the reviewer
// says so (`force`).
import type { BoardElement } from './elements';

export const SUGGESTIONS_COLLECTION = 'suggestions';
/** Pending suggestions a board may hold; a proposal past it is refused whole. */
export const MAX_PENDING_SUGGESTIONS = 2000;
export const MAX_SUGGESTION_DESCRIPTION = 500;
/** Decided records are kept this long (so accept / reject can be undone), then pruned. */
export const DECIDED_SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;

/** 'person': someone suggesting themselves; 'app': an API token or OAuth app acting for a person; 'ai': Freero's AI actions. */
export type SuggestionAuthorKind = 'person' | 'app' | 'ai';
export interface SuggestionAuthor {
  kind: SuggestionAuthorKind;
  /** What the badge says: the app's or token's name, "AI", or the person's name. */
  name: string;
  /** The person it acts for (app, ai) or is (person). */
  userId: string;
  /** That person's name when it was proposed ("Claude for Maria"). */
  userName: string;
  /** The API token or app authorisation that proposed it (kind 'app'). */
  credentialId?: string;
}

export type SuggestionOp = 'create' | 'update' | 'delete';

export interface SuggestionDecision {
  status: 'accepted' | 'rejected';
  /** Who decided (a user id; the server checks a socket names itself). */
  by: string;
  at: number;
  /** Accepted although it was stale. */
  forced?: true;
}

export interface SuggestionRecord {
  id: string;
  groupId: string;
  author: SuggestionAuthor;
  /** What the proposer says the group does. Untrusted text, shown as text. */
  description: string;
  createdAt: number;
  op: SuggestionOp;
  /** create: the proposed item, under the id it gets when accepted. */
  element?: BoardElement;
  /** create: content kept outside the element (a table's cells, as copy / paste carries it). */
  content?: unknown;
  /** update / delete: the item it changes. */
  targetId?: string;
  /** update: the fields it sets. */
  patch?: Record<string, unknown>;
  /** update: what those fields were when it was proposed (null: absent). */
  base?: Record<string, unknown>;
  /** delete: the item's fingerprint when it was proposed (elementFingerprint). */
  baseHash?: string;
  /** Set when someone accepted or rejected it. Undefined = pending. */
  decision?: SuggestionDecision;
}

/** 'ready', or why it is stale: the item changed, or it (or an item it needs) is gone. */
export type SuggestionState = 'ready' | 'changed' | 'gone';

/** Fields that change without changing what an item IS (stacking, timestamps, attribution). */
const VOLATILE = new Set(['z', 'updatedAt', 'suggestedBy']);

/** JSON with object keys sorted: equal values give equal text, whatever order keys were written in. */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/** FNV-1a (two 32-bit lanes) of a string, base 36: a cheap content fingerprint, not a security hash. */
function fnv(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** What an item is, ignoring stacking and timestamps: equal before and after = nobody changed it. */
export function elementFingerprint(el: BoardElement): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el)) if (!VOLATILE.has(k)) o[k] = v;
  return fnv(stableJson(o));
}

export const sameValue = (a: unknown, b: unknown) => stableJson(a ?? null) === stableJson(b ?? null);

/** Items a proposed new item points at: the ends of a line, what it rides on, its mind-map parent. */
export function suggestionRefs(el: BoardElement, opts: { frame?: boolean } = {}): string[] {
  const e = el as BoardElement & { start?: { elementId?: string | null }; end?: { elementId?: string | null }; parentId?: string | null };
  const out: string[] = [];
  if (e.type === 'connector') for (const end of [e.start, e.end]) if (end?.elementId) out.push(end.elementId);
  if (e.attachedTo) out.push(e.attachedTo);
  if (e.type === 'mindmap' && e.parentId) out.push(e.parentId);
  if (opts.frame && e.frameId) out.push(e.frameId);
  return out;
}

/**
 * Whether `rec` can be applied as proposed to the board `get` reads (`pendingCreates`: ids of
 * items other pending suggestions would create, which a new line may connect).
 */
export function suggestionState(rec: SuggestionRecord, get: (id: string) => BoardElement | undefined, pendingCreates: ReadonlySet<string>): SuggestionState {
  if (rec.op === 'create') {
    if (!rec.element) return 'gone';
    return suggestionRefs(rec.element).every((id) => get(id) || pendingCreates.has(id)) ? 'ready' : 'gone';
  }
  const cur = rec.targetId ? get(rec.targetId) : undefined;
  if (!cur) return 'gone';
  if (rec.op === 'update') {
    const now = cur as unknown as Record<string, unknown>;
    return Object.entries(rec.base ?? {}).every(([k, v]) => sameValue(now[k], v)) ? 'ready' : 'changed';
  }
  return elementFingerprint(cur) === rec.baseHash ? 'ready' : 'changed';
}

/** The item as it would look once `rec` is accepted (a deletion: the item it deletes). */
export function suggestedElement(rec: SuggestionRecord, get: (id: string) => BoardElement | undefined): BoardElement | null {
  if (rec.op === 'create') return rec.element ?? null;
  const cur = rec.targetId ? get(rec.targetId) : undefined;
  if (!cur) return null;
  return rec.op === 'update' ? ({ ...cur, ...rec.patch, id: cur.id, type: cur.type } as BoardElement) : cur;
}

/**
 * `ids` plus the pending suggestions they can't be accepted without: new items they point at
 * (a line's ends, the frame a new sticky goes in), transitively. Accepting a line accepts the
 * stickies it joins.
 */
export function acceptClosure(ids: Iterable<string>, pending: readonly SuggestionRecord[]): string[] {
  const byElement = new Map<string, SuggestionRecord>();
  for (const r of pending) if (r.op === 'create' && r.element) byElement.set(r.element.id, r);
  const byId = new Map(pending.map((r) => [r.id, r]));
  const out = new Set<string>();
  const stack = [...ids].filter((id) => byId.has(id));
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const r = byId.get(id)!;
    if (r.op !== 'create' || !r.element) continue;
    for (const ref of suggestionRefs(r.element, { frame: true })) {
      const dep = byElement.get(ref);
      if (dep && !out.has(dep.id)) stack.push(dep.id);
    }
  }
  return [...out];
}

/**
 * `ids` plus the pending suggestions that make no sense without them: new items pointing at new
 * items being rejected (a line between two rejected stickies), transitively.
 */
export function rejectClosure(ids: Iterable<string>, pending: readonly SuggestionRecord[]): string[] {
  const byId = new Map(pending.map((r) => [r.id, r]));
  const out = new Set([...ids].filter((id) => byId.has(id)));
  for (let grew = true; grew; ) {
    grew = false;
    const gone = new Set([...out].flatMap((id) => (byId.get(id)?.op === 'create' && byId.get(id)?.element ? [byId.get(id)!.element!.id] : [])));
    for (const r of pending) {
      if (out.has(r.id) || r.op !== 'create' || !r.element) continue;
      if (suggestionRefs(r.element).some((ref) => gone.has(ref))) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** A new item accepted although an item it points at is gone: the dangling references dropped. */
export function withoutDanglingRefs(el: BoardElement, exists: (id: string) => boolean): BoardElement {
  const e = { ...el } as BoardElement & { start?: { elementId?: string | null }; end?: { elementId?: string | null }; parentId?: string | null };
  if (e.type === 'connector') {
    if (e.start?.elementId && !exists(e.start.elementId)) e.start = { ...e.start, elementId: null };
    if (e.end?.elementId && !exists(e.end.elementId)) e.end = { ...e.end, elementId: null };
  }
  if (e.attachedTo && !exists(e.attachedTo)) e.attachedTo = null;
  if (e.type === 'mindmap' && e.parentId && !exists(e.parentId)) e.parentId = null;
  if (e.frameId && !exists(e.frameId)) e.frameId = null;
  return e;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function asAuthor(v: unknown): SuggestionAuthor | null {
  if (!isObj(v)) return null;
  const { kind, name, userId, userName, credentialId } = v;
  if (kind !== 'person' && kind !== 'app' && kind !== 'ai') return null;
  if (!str(name) || !str(userId) || typeof userName !== 'string' || userName.length > 200) return null;
  if (credentialId !== undefined && !str(credentialId)) return null;
  return { kind, name, userId, userName, ...(credentialId !== undefined ? { credentialId } : {}) };
}

/** A decision value as stored, or null (also for a malformed one). */
export function asDecision(v: unknown): SuggestionDecision | null {
  if (!isObj(v)) return null;
  const { status, by, at, forced } = v;
  if ((status !== 'accepted' && status !== 'rejected') || !str(by) || typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (forced !== undefined && forced !== true) return null;
  return { status, by, at, ...(forced ? { forced: true as const } : {}) };
}

/**
 * A well-formed record from a stored value (layer content is data another client could have
 * shaped), or null. Readers skip null values.
 */
export function asSuggestionRecord(v: unknown, key?: string): SuggestionRecord | null {
  if (!isObj(v)) return null;
  const { id, groupId, description, createdAt, op, element, targetId, patch, base, baseHash, decision } = v;
  if (!str(id, 64) || (key !== undefined && key !== id) || !str(groupId, 64)) return null;
  if (typeof description !== 'string' || description.length > MAX_SUGGESTION_DESCRIPTION) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  const author = asAuthor(v.author);
  if (!author) return null;
  if (decision !== undefined && !asDecision(decision)) return null;
  if (op === 'create') {
    if (!isObj(element) || !str(element.id, 64) || !str(element.type, 40)) return null;
  } else if (op === 'update') {
    if (!str(targetId, 64) || !isObj(patch) || !isObj(base)) return null;
  } else if (op === 'delete') {
    if (!str(targetId, 64) || !str(baseHash, 40)) return null;
  } else return null;
  return v as unknown as SuggestionRecord;
}

/** Pending records of a collection's entries, oldest first (malformed ones skipped). */
export function pendingSuggestions(entries: Iterable<[string, unknown]>): SuggestionRecord[] {
  const out: SuggestionRecord[] = [];
  for (const [k, v] of entries) {
    const r = asSuggestionRecord(v, k);
    if (r && !r.decision) out.push(r);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
