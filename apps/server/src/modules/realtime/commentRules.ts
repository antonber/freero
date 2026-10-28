// Who may write which record of the `comments` collection, for connections that are trusted with
// comments only (commenters). Owners and editors may write the whole doc, so these rules never
// apply to them.
//
// The record layout is `@freero/shared` CommentRecord (one small record per key):
//
//   key                          a commenter may create / change it when …     … and delete it when
//   t:<tid>                      it names them as `createdBy`; anyone may      the same update tombstones
//                                DETACH a pinned thread (only elementId,       the thread (x:<tid>)
//                                corner, x, y change; elementId becomes null)
//   s:<tid>                      `by` is them: anyone may resolve / reopen     the thread is tombstoned
//                                any thread (shared workflow state, attributed
//                                and reversible)
//   m:<tid>:<mid>                `authorId` is them, before and after          they wrote it, or the thread
//                                                                              is tombstoned
//   r:<tid>:<mid>:<uid>:<emoji>  <uid> and `userId` are them                   <uid> is them, or the message
//                                                                              / thread is tombstoned
//   x:<tid>                      `by` is them and they created the thread, or  never (tombstones are final)
//                                wrote every message still in it
//   x:<tid>:<mid>                `by` is them and they wrote the message       never
//
// "The thread is tombstoned" means x:<tid> is created (validly) in the same update or already
// exists: deleting a thread or message removes everyone's records under it, which is only allowed
// together with the tombstone that its author is entitled to write.
//
// Legacy boards stored a thread whole under one key. Any commenter's client converts such a value
// into records (comments `upgradeLegacy`): deleting a legacy value is allowed, and records created
// in the same update are allowed when they are what the deleted value already said (same author,
// same text), so the conversion cannot be used to forge someone else's message.
import type {
  CommentMessageRecord,
  CommentReactionRecord,
  CommentStatusRecord,
  CommentThreadRecord,
  CommentTombstone,
} from '@freero/shared';

/** One key's value before and after the update (`undefined` = absent). */
export interface KeyChange {
  key: string;
  before: unknown;
  after: unknown;
}

interface LegacyThread {
  id?: string;
  messages: Array<{ id?: string; authorId?: string; text?: string; reactions?: Record<string, string[]> }>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isRecord = (v: unknown): v is Obj & { kind: string } => isObj(v) && typeof v.kind === 'string';
const isLegacy = (v: unknown): v is LegacyThread => isObj(v) && !isRecord(v) && Array.isArray(v.messages);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * True when every change in `changes` is one `userId` may make as a commenter. `prior(key)` reads
 * the collection as it was before the update; `priorKeys()` lists its keys.
 */
export function commenterMayChangeComments(
  changes: KeyChange[],
  userId: string,
  prior: (key: string) => unknown,
  priorKeys: () => Iterable<string>,
): boolean {
  const byKey = new Map(changes.map((c) => [c.key, c]));
  /** Legacy whole-thread values deleted by this update, by thread id. */
  const legacy = new Map<string, LegacyThread>();
  for (const c of changes) {
    if (c.after === undefined && isLegacy(c.before)) legacy.set(c.before.id ?? c.key, c.before);
  }
  const legacyMessage = (tid: string, mid: string) => legacy.get(tid)?.messages.find((m) => m.id === mid);

  const mayTombstoneThread = (tid: string): boolean => {
    const t = prior(`t:${tid}`);
    if (isRecord(t) && (t as unknown as CommentThreadRecord).createdBy === userId) return true;
    // Not the creator: only when every live message of the thread is theirs (deleting the last
    // message of a thread deletes the thread).
    const prefix = `m:${tid}:`;
    let any = false;
    for (const k of priorKeys()) {
      if (!k.startsWith(prefix)) continue;
      const m = prior(k);
      if (!isRecord(m) || (m as unknown as CommentMessageRecord).authorId !== userId) return false;
      any = true;
    }
    return any;
  };
  const newTombstone = (key: string): boolean => {
    const c = byKey.get(key);
    return !!c && c.before === undefined && allowed(c);
  };
  const threadTombstoned = (tid: string) => isRecord(prior(`x:${tid}`)) || newTombstone(`x:${tid}`);
  const messageTombstoned = (tid: string, mid: string) =>
    threadTombstoned(tid) || isRecord(prior(`x:${tid}:${mid}`)) || newTombstone(`x:${tid}:${mid}`);

  const verdicts = new Map<string, boolean>();
  function allowed(c: KeyChange): boolean {
    const cached = verdicts.get(c.key);
    if (cached !== undefined) return cached;
    verdicts.set(c.key, false); // no rule may justify itself through a cycle
    const v = decide(c);
    verdicts.set(c.key, v);
    return v;
  }

  function decide({ key, before, after }: KeyChange): boolean {
    if (same(before, after)) return true;
    if (after === undefined && isLegacy(before)) return true; // converted into records
    if (after !== undefined && !isRecord(after)) return false;
    const [prefix, tid = '', mid = '', uid = '', ...rest] = key.split(':');
    const a = after as Obj | undefined;
    const b = isRecord(before) ? before : undefined;
    if (before !== undefined && !b) return false; // overwriting a non-record (legacy) value in place

    switch (prefix) {
      case 't': {
        if (key !== `t:${tid}`) return false;
        if (!a) return threadTombstoned(tid);
        const t = a as unknown as CommentThreadRecord;
        if (t.kind !== 'thread' || t.id !== tid) return false;
        if (!b) {
          if (t.createdBy === userId) return true;
          const lt = legacy.get(tid);
          return !!lt && t.createdBy === (lt.messages[0]?.authorId ?? '');
        }
        const p = b as unknown as CommentThreadRecord;
        if (p.createdBy === userId && t.createdBy === userId) return true;
        // Detach: the pinned element is gone; anyone keeps the thread where it was.
        const strip = (r: CommentThreadRecord) => ({ ...r, elementId: null, corner: null, x: 0, y: 0 });
        return !!p.elementId && !t.elementId && same(strip(p), strip(t));
      }
      case 's': {
        if (key !== `s:${tid}`) return false;
        if (!a) return threadTombstoned(tid);
        const s = a as unknown as CommentStatusRecord;
        if (s.kind !== 'status' || s.threadId !== tid) return false;
        return s.by === userId || (s.by === '' && legacy.has(tid));
      }
      case 'm': {
        if (key !== `m:${tid}:${mid}`) return false;
        if (!a) return (b as unknown as CommentMessageRecord).authorId === userId || threadTombstoned(tid);
        const m = a as unknown as CommentMessageRecord;
        if (m.kind !== 'message' || m.threadId !== tid || m.id !== mid) return false;
        if (m.authorId === userId) return !b || (b as unknown as CommentMessageRecord).authorId === userId;
        const lm = !b ? legacyMessage(tid, mid) : undefined;
        return !!lm && lm.authorId === m.authorId && lm.text === m.text;
      }
      case 'r': {
        const emoji = rest.join(':');
        if (!tid || !mid || !uid || !emoji) return false;
        if (!a) return uid === userId || messageTombstoned(tid, mid);
        const r = a as unknown as CommentReactionRecord;
        if (r.kind !== 'reaction' || r.threadId !== tid || r.messageId !== mid || r.userId !== uid || r.emoji !== emoji) return false;
        if (uid === userId) return true;
        return !b && !!legacyMessage(tid, mid)?.reactions?.[emoji]?.includes(uid);
      }
      case 'x': {
        if (b || !a) return false; // tombstones are final
        const x = a as unknown as CommentTombstone;
        if (x.kind !== 'deleted' || x.threadId !== tid || x.by !== userId) return false;
        if (key === `x:${tid}`) return !x.messageId && mayTombstoneThread(tid);
        if (key !== `x:${tid}:${mid}` || x.messageId !== mid) return false;
        const m = prior(`m:${tid}:${mid}`);
        return isRecord(m) && (m as unknown as CommentMessageRecord).authorId === userId;
      }
      default:
        return false;
    }
  }

  return changes.every(allowed);
}
