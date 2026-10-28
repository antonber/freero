// Suggestions (KAI-169; format and rules: @freero/shared suggestions.ts). Pure over Y.Docs and
// board views; rooms.ts runs them against the live room.
//
// Where they live: the `suggestions` collection of the board's `editors` layer. That layer is
// already synced only to owner/editor sockets, persisted, relayed between instances and left
// alone by version restore, so suggestions get all of that without a layer of their own, and a
// viewer, commenter or guest who can't edit never receives a single suggestion.
//
// Who writes them:
//   - the SERVER creates records (`proposeRecords`: the public API, structure insertion with
//     target 'suggestions', and later in-app AI), so the author badge is what Freero says it is;
//   - a SOCKET (owner/editor, effective role: a facilitator's lock makes participants commenters,
//     who write no layer at all) may only set or clear the `decision` of an existing record,
//     naming itself (`guardSuggestionWrites`, inside the transaction that applies its update,
//     like the facilitation guards). The accepted change itself is an ordinary edit of the shared
//     doc made by the same client in the same transaction: one undo step for the acceptor;
//   - accepting / rejecting on a request (`planDecision`) applies the change with `applyChange`
//     and sets the decisions as the server.
// Every accept / reject / undo of either is audited where it is applied (rooms.ts).
import * as Y from 'yjs';
import {
  acceptClosure,
  asDecision,
  asSuggestionRecord,
  DECIDED_SUGGESTION_TTL_MS,
  elementFingerprint,
  MAX_PENDING_SUGGESTIONS,
  MAX_SUGGESTION_DESCRIPTION,
  pendingSuggestions,
  rejectClosure,
  stableJson,
  SUGGESTIONS_COLLECTION,
  suggestionState,
  tableCellEntries,
  withoutDanglingRefs,
  type BoardElement,
  type ElementDraft,
  type SuggestionAuthor,
  type SuggestionDecision,
  type SuggestionRecord,
  type SuggestionState,
  type TableCopyContent,
} from '@freero/shared';
import { changedKeys } from './facilitation';
import { BoardChangeError, type BoardChange, type BoardView } from './view';

export { SUGGESTIONS_COLLECTION };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const STAMPS = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

/** The records of a layer doc's collection (read-only; empty when it has none). */
export function suggestionEntries(doc: Y.Doc | undefined): Array<[string, unknown]> {
  if (!doc || !doc.share.has(SUGGESTIONS_COLLECTION)) return [];
  return [...doc.getMap<unknown>(SUGGESTIONS_COLLECTION).entries()];
}

/** A suggestion as a reviewer sees it now: the record plus whether it still applies. */
export interface ReviewedSuggestion {
  record: SuggestionRecord;
  state: SuggestionState;
}

/** Pending suggestions with their state against the board as `view` shows it (an editor's view). */
export function reviewSuggestions(records: readonly SuggestionRecord[], view: BoardView): ReviewedSuggestion[] {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const creates = new Set(records.flatMap((r) => (r.op === 'create' && r.element ? [r.element.id] : [])));
  return records.map((record) => ({ record, state: suggestionState(record, (id) => byId.get(id), creates) }));
}

/**
 * The records a proposal becomes: one per new item, per changed item and per deleted item, all
 * in one new group. `change` is planned against `view` (the proposer's editor view) exactly like
 * a direct write would be — the same planners — so accepting it later does what writing it now
 * would have done. `content`: what new tables hold (by element id).
 */
export function proposeRecords(
  view: BoardView,
  change: BoardChange,
  opts: { author: SuggestionAuthor; description: string; content?: Record<string, unknown>; newId: () => string; pending: number; now?: number },
): SuggestionRecord[] {
  const now = opts.now ?? Date.now();
  const description = opts.description.trim();
  if (description.length > MAX_SUGGESTION_DESCRIPTION) throw new BoardChangeError(`description is longer than ${MAX_SUGGESTION_DESCRIPTION} characters`);
  for (const name of Object.keys(change.collections ?? {}))
    if (name !== 'tableCells') throw new BoardChangeError(`A suggestion can't change '${name}'`);
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const groupId = opts.newId();
  const base = { groupId, author: opts.author, description, createdAt: now };
  const out: SuggestionRecord[] = [];
  for (const d of change.create ?? []) {
    if (byId.has(d.id)) throw new BoardChangeError(`Element ${d.id} already exists`);
    const element = { ...d, z: 0, createdBy: opts.author.userId, createdAt: now, updatedAt: now } as BoardElement;
    const content = opts.content?.[d.id];
    out.push({ id: opts.newId(), ...base, op: 'create', element, ...(content !== undefined ? { content } : {}) });
  }
  const patches = new Map<string, Record<string, unknown>>();
  for (const u of change.update ?? []) {
    if (!byId.has(u.id)) throw new BoardChangeError(`No element ${u.id} on this board`);
    const { id: _id, type: _type, ...patch } = u.patch;
    patches.set(u.id, { ...patches.get(u.id), ...patch });
  }
  const removing = new Set(change.remove ?? []);
  for (const [targetId, patch] of patches) {
    if (removing.has(targetId)) continue; // deleting it says it all
    const cur = byId.get(targetId)! as unknown as Record<string, unknown>;
    const was: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) was[k] = cur[k] ?? null;
    if (stableJson(was) === stableJson(patch)) continue; // changes nothing
    out.push({ id: opts.newId(), ...base, op: 'update', targetId, patch, base: was });
  }
  for (const targetId of removing) {
    const cur = byId.get(targetId);
    if (!cur) throw new BoardChangeError(`No element ${targetId} on this board`);
    out.push({ id: opts.newId(), ...base, op: 'delete', targetId, baseHash: elementFingerprint(cur) });
  }
  if (!out.length) throw new BoardChangeError('Nothing to suggest: the proposal changes nothing');
  if (opts.pending + out.length > MAX_PENDING_SUGGESTIONS)
    throw new BoardChangeError(`This board already has ${opts.pending} suggestions waiting for review; at most ${MAX_PENDING_SUGGESTIONS} can wait at once`);
  return out;
}

/** Thrown when the suggestions asked for are not (or no longer) pending. */
export class SuggestionNotFoundError extends Error {}
/** Thrown when accepting would overwrite changes made since (accept them with `force`). */
export class SuggestionStaleError extends Error {
  constructor(readonly stale: Array<{ id: string; state: SuggestionState }>) {
    super(`${stale.length} of these suggestions ${stale.length === 1 ? 'is' : 'are'} out of date: the item changed or is gone since. Review and accept with force, or reject.`);
  }
}

export interface DecisionPlan {
  /** The board change accepting applies (empty for a rejection). */
  change: BoardChange;
  /** Every record decided (what was asked, plus what it needs or what needs it). */
  records: SuggestionRecord[];
  decision: SuggestionDecision;
}

/**
 * What deciding `ids` (suggestion ids, or every pending one of `groupId`) does on the board as
 * `view` shows it. Accepting also accepts the new items they need (a line's ends); rejecting also
 * rejects the new items that need them. Stale ones are refused unless `force`: then an update
 * of an item that is gone and a deletion of one that is gone are skipped, and a new item loses
 * references to items that are gone.
 */
export function planDecision(
  entries: Iterable<[string, unknown]>,
  view: BoardView,
  ask: { ids?: string[]; groupId?: string; status: 'accepted' | 'rejected'; force?: boolean; by: string; now?: number },
): DecisionPlan {
  const pending = pendingSuggestions(entries);
  const asked = ask.groupId ? pending.filter((r) => r.groupId === ask.groupId).map((r) => r.id) : [...new Set(ask.ids ?? [])];
  const byId = new Map(pending.map((r) => [r.id, r]));
  const missing = asked.find((id) => !byId.has(id));
  if (missing || !asked.length) throw new SuggestionNotFoundError(missing ? `No pending suggestion ${missing} on this board` : 'No pending suggestions to decide');
  const decision: SuggestionDecision = { status: ask.status, by: ask.by, at: ask.now ?? Date.now() };
  if (ask.status === 'rejected') {
    const records = rejectClosure(asked, pending).map((id) => byId.get(id)!);
    return { change: {}, records, decision };
  }
  const records = acceptClosure(asked, pending).map((id) => byId.get(id)!);
  const reviewed = reviewSuggestions(pending, view);
  const states = new Map(reviewed.map((r) => [r.record.id, r.state]));
  const stale = records.filter((r) => states.get(r.id) !== 'ready').map((r) => ({ id: r.id, state: states.get(r.id)! }));
  if (stale.length && !ask.force) throw new SuggestionStaleError(stale);
  if (stale.length) decision.forced = true;

  const onBoard = new Set(view.elements.map((e) => e.el.id));
  const accepted = new Set(records.flatMap((r) => (r.op === 'create' && r.element ? [r.element.id] : [])));
  const exists = (id: string) => onBoard.has(id) || accepted.has(id);
  const change: Required<Pick<BoardChange, 'create' | 'update' | 'remove'>> & { collections?: BoardChange['collections'] } = { create: [], update: [], remove: [] };
  const cells: Record<string, string> = {};
  const removing = new Set(records.flatMap((r) => (r.op === 'delete' && r.targetId && onBoard.has(r.targetId) ? [r.targetId] : [])));
  for (const r of records) {
    if (r.op === 'create' && r.element) {
      const el = withoutDanglingRefs(r.element, exists) as unknown as Record<string, unknown>;
      const draft: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(el)) if (!STAMPS.has(k)) draft[k] = v;
      draft.suggestedBy = { kind: r.author.kind, name: r.author.name, userId: r.author.userId };
      change.create.push(draft as ElementDraft);
      if (el.type === 'table' && isObj(r.content)) Object.assign(cells, tableCellEntries(r.element.id, r.content as TableCopyContent));
    } else if (r.op === 'update' && r.targetId && onBoard.has(r.targetId) && !removing.has(r.targetId)) {
      change.update.push({ id: r.targetId, patch: { ...r.patch } });
    }
  }
  change.remove = [...removing];
  if (Object.keys(cells).length) change.collections = { tableCells: cells };
  return { change, records, decision };
}

/** Writes `decision` onto `records` in the layer (one transaction, `origin`). */
export function writeDecisions(doc: Y.Doc, records: readonly SuggestionRecord[], decision: SuggestionDecision, origin: unknown): void {
  const map = doc.getMap<unknown>(SUGGESTIONS_COLLECTION);
  doc.transact(() => {
    for (const r of records) map.set(r.id, { ...r, decision });
  }, origin);
}

/** Adds proposal records to the layer (one transaction, `origin`). */
export function writeProposal(doc: Y.Doc, records: readonly SuggestionRecord[], origin: unknown): void {
  const map = doc.getMap<unknown>(SUGGESTIONS_COLLECTION);
  doc.transact(() => {
    for (const r of records) map.set(r.id, r);
  }, origin);
}

/** A decision change a socket made: from → to (undefined: pending). */
export interface DecisionChange {
  record: SuggestionRecord;
  from: SuggestionDecision | undefined;
  to: SuggestionDecision | undefined;
}

const withoutDecision = (r: SuggestionRecord) => {
  const { decision: _d, ...rest } = r;
  return stableJson(rest);
};

/**
 * May a socket of `userId` turn the stored value `before` into `after`? Only by setting the
 * decision of a pending record to one naming itself, or clearing (undoing) its own decision.
 * Never by adding, deleting or otherwise changing a record.
 */
export function maySocketChangeSuggestion(before: unknown, after: unknown, userId: string): boolean {
  if (stableJson(before) === stableJson(after)) return true;
  const b = asSuggestionRecord(before);
  const a = asSuggestionRecord(after);
  if (!b || !a || b.id !== a.id || withoutDecision(a) !== withoutDecision(b)) return false;
  const from = b.decision ? asDecision(b.decision) : undefined;
  const to = a.decision ? asDecision(a.decision) : undefined;
  if (!from && to) return to.by === userId;
  if (from && !to) return from.by === userId;
  return false; // decided → decided differently: undo first
}

/**
 * Undoes, inside the transaction applying a socket's update to the editors layer, every change
 * of the suggestions collection the socket may not make (see maySocketChangeSuggestion), and
 * returns how many it undid plus the decisions it let through (for the audit log).
 */
export function guardSuggestionWrites(tr: Y.Transaction, doc: Y.Doc, userId: string): { reverted: number; decided: DecisionChange[] } {
  if (!doc.share.has(SUGGESTIONS_COLLECTION)) return { reverted: 0, decided: [] };
  const map = doc.getMap<unknown>(SUGGESTIONS_COLLECTION);
  let reverted = 0;
  const decided: DecisionChange[] = [];
  for (const [key, { before, after }] of changedKeys(tr, map)) {
    if (maySocketChangeSuggestion(before, after, userId)) {
      const a = asSuggestionRecord(after);
      const b = asSuggestionRecord(before);
      if (a && b && stableJson(a.decision) !== stableJson(b.decision)) decided.push({ record: a, from: b.decision, to: a.decision });
      continue;
    }
    if (before === undefined) map.delete(key);
    else map.set(key, before);
    reverted++;
  }
  return { reverted, decided };
}

/** Deletes records decided longer than the undo window ago (`origin`: the server). Returns how many. */
export function pruneDecided(doc: Y.Doc, origin: unknown, now = Date.now()): number {
  if (!doc.share.has(SUGGESTIONS_COLLECTION)) return 0;
  const map = doc.getMap<unknown>(SUGGESTIONS_COLLECTION);
  const old: string[] = [];
  for (const [k, v] of map.entries()) {
    const r = asSuggestionRecord(v, k);
    if (!r) old.push(k); // garbage nobody can read
    else if (r.decision && now - r.decision.at > DECIDED_SUGGESTION_TTL_MS) old.push(k);
  }
  if (old.length)
    doc.transact(() => {
      for (const k of old) map.delete(k);
    }, origin);
  return old.length;
}

/** A layer's state without its suggestions (a duplicated board starts with none pending). */
export function withoutSuggestions(state: Uint8Array): Uint8Array {
  const from = new Y.Doc();
  const to = new Y.Doc();
  try {
    Y.applyUpdate(from, state);
    to.transact(() => {
      for (const name of from.share.keys()) {
        if (name === SUGGESTIONS_COLLECTION) continue;
        const src = from.getMap<unknown>(name);
        const dst = to.getMap<unknown>(name);
        for (const [k, v] of src.entries()) if (!(v instanceof Y.AbstractType)) dst.set(k, v);
      }
    });
    return Y.encodeStateAsUpdate(to);
  } finally {
    from.destroy();
    to.destroy();
  }
}
