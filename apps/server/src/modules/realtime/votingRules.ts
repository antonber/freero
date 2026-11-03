// Dot-voting rules (KAI-210, parity rank 5), enforced here next to the facilitator limits (facilitation.ts).
//
// The `voting` collection (@freero/shared VOTING_COLLECTION) holds the running VotingSession under
// VOTING_SESSION_KEY, one ballot per voter under `${sessionId}:${userId}`, and past votes' totals
// under `h:<sessionId>`. Readers tally only `votesPerUser` votes of a ballot, but a raw client could
// still stuff the box: write a ballot over budget, write ballots under made-up user ids (each counts
// as another voter), raise the running session's budget, or vote after its timer. So a socket's
// change to the collection, in the shared doc or in its private layer (sealed ballots of a hidden
// vote), is undone in the same transaction unless:
//
//   key                     it may set it to …                               it may delete it
//   session (shared only)   a well-formed session (VOTES_PER_USER_MIN ≤       editors: always (clear
//                           votesPerUser ≤ VOTES_PER_USER_MAX, a per-item     results, start a new vote);
//                           cap within it, anonymousBallots only sealed);     participants: never
//                           the same session id keeps what it promised
//                           (budget, caps, sealing, anonymity, scope) —
//                           editors only
//   h:<id> (shared only)    editors only                                     editors only
//   <sid>:<uid>             its OWN ballot (uid and userId are the socket's   editors: always (a new vote
//                           user, the key is `${sessionId}:${userId}`) for    wipes everyone's ballots);
//                           the RUNNING session sid before its deadline,      participants: only their own
//                           with at most votesPerUser votes and at most
//                           maxPerItem on one item
//
// Anonymous votes (`anonymousBallots`): nothing that reaches the shared doc may say who voted for
// what. A ballot arriving in a private layer is rewritten (not undone) to the server's stamp —
// `anonymous: true`, no name or colour — so the reveal (layers.ts, revealBallots) writes it without
// its voter whatever the session says by then; a ballot in the shared doc can only be the bare
// "has voted" marker (no name, no votes). Rewritten inside the transaction, the name never reaches
// another socket (the struct holding it is deleted and garbage-collected before the update goes out).
//
// Compensation, not dropping, for the reason given in facilitation.ts: the sender is sent the
// correction and its doc converges. The Yjs undo manager does not track collections, so an honest
// client never writes someone else's ballot (undo can't bring one back). Reveals of sealed ballots
// are made by the server (not a socket) and checked when each ballot was written.
import * as Y from 'yjs';
import {
  ANONYMOUS_VOTER_PREFIX,
  isVotingHistoryKey,
  VOTE_DEADLINE_GRACE_MS,
  VOTES_PER_USER_MAX,
  VOTES_PER_USER_MIN,
  VOTING_COLLECTION,
  VOTING_SESSION_KEY,
  type VoteBallot,
  type VotingSession,
} from '@freero/shared';
import { changedKeys } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isCount = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;

/** A session value with a usable id and budget, or null. */
export function asVotingSession(v: unknown): VotingSession | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.active !== 'boolean') return null;
  const n = v.votesPerUser;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < VOTES_PER_USER_MIN || n > VOTES_PER_USER_MAX) return null;
  if (v.maxPerItem !== undefined && v.maxPerItem !== null && !isCount(v.maxPerItem, n)) return null;
  if (v.endsAt !== undefined && v.endsAt !== null && (typeof v.endsAt !== 'number' || !Number.isFinite(v.endsAt))) return null;
  if (v.anonymousBallots !== undefined && typeof v.anonymousBallots !== 'boolean') return null;
  // Anonymous ballots are sealed ballots: a ballot written into the shared doc names its writer.
  if (v.anonymousBallots === true && v.anonymous !== true) return null;
  return v as unknown as VotingSession;
}

/** What a session promises its voters: fixed for its id (title, end and timer may change). */
const promise = (s: VotingSession) => [s.votesPerUser, s.maxPerItem ?? null, !!s.anonymous, !!s.anonymousBallots, s.elementIds ?? null, s.startedBy];

/** May a socket turn the session value `before` into `after`? */
export function mayChangeVotingSession(before: unknown, after: unknown): boolean {
  if (same(before, after) || after === undefined) return true;
  const next = asVotingSession(after);
  if (!next) return false;
  const prev = asVotingSession(before);
  return !prev || prev.id !== next.id || same(promise(prev), promise(next));
}

/** Is the running `session` still taking ballots at server time `now`? */
export const takesBallots = (session: VotingSession | null, now: number): session is VotingSession =>
  !!session?.active && (session.endsAt === undefined || session.endsAt === null || now <= session.endsAt + VOTE_DEADLINE_GRACE_MS);

/** May `userId` set ballot key `key` to `after` while `session` runs (undefined `after`: delete)? */
export function mayWriteBallot(key: string, after: unknown, userId: string, session: VotingSession | null, now = Date.now()): boolean {
  if (after === undefined) return true;
  if (!isObj(after) || after.userId !== userId || typeof after.sessionId !== 'string') return false;
  if (key !== `${after.sessionId}:${userId}`) return false;
  if (!takesBallots(session, now) || session.id !== after.sessionId) return false;
  const ids = after.elementIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string') || ids.length > session.votesPerUser) return false;
  const cap = session.maxPerItem;
  if (cap) {
    const per = new Map<string, number>();
    for (const id of ids as string[]) if ((per.set(id, (per.get(id) ?? 0) + 1).get(id) ?? 0) > cap) return false;
  }
  return true;
}

/**
 * The form a ballot must have in an anonymous vote (see the header): in the voter's private layer
 * the stamped ballot without name or colour, in the shared doc the bare "has voted" marker.
 */
export function anonymousForm(after: Record<string, unknown>, inPrivateLayer: boolean): VoteBallot {
  const base = { sessionId: after.sessionId as string, userId: after.userId as string };
  return inPrivateLayer ? { ...base, elementIds: after.elementIds as string[], anonymous: true } : { ...base, elementIds: [], sealed: true };
}

function restore(map: Y.Map<unknown>, key: string, before: unknown): void {
  if (before === undefined) map.delete(key);
  else map.set(key, before);
}

export interface VoterWho {
  userId: string;
  /** A participant (not an editor): own ballot only, never the session or the history. */
  participant?: boolean;
  /** Server time (tests). */
  now?: number;
}

/**
 * Undoes (or, in an anonymous vote, rewrites) this transaction's changes to `doc`'s voting
 * collection that `who` may not make (see the header). `shared`: the board's shared doc, which holds
 * the session; for a private layer pass the layer doc as `doc` and the shared doc as `shared`. The
 * voting map of `doc` must exist before the transaction (changedKeys). True when it changed something.
 */
export function guardVotes(tr: Y.Transaction, doc: Y.Doc, shared: Y.Doc, who: string | VoterWho): boolean {
  const { userId, participant = false, now = Date.now() } = typeof who === 'string' ? { userId: who } : who;
  if (!doc.share.has(VOTING_COLLECTION)) return false;
  const map = doc.getMap<unknown>(VOTING_COLLECTION);
  const changes = changedKeys(tr, map);
  if (!changes.size) return false;
  let reverted = false;
  const session = changes.get(VOTING_SESSION_KEY);
  if (session && (doc !== shared || participant || !mayChangeVotingSession(session.before, session.after))) {
    restore(map, VOTING_SESSION_KEY, session.before);
    reverted = true;
  }
  // Ballots are judged against the session as it stands after this update (a new vote in the same
  // update counts; a session change undone above does not).
  const running = asVotingSession(shared.getMap<unknown>(VOTING_COLLECTION).get(VOTING_SESSION_KEY));
  for (const [key, { before, after }] of changes) {
    if (key === VOTING_SESSION_KEY || same(before, after)) continue;
    if (isVotingHistoryKey(key)) {
      if (doc !== shared || participant) {
        restore(map, key, before);
        reverted = true;
      }
      continue;
    }
    const own = key.endsWith(`:${userId}`) && !key.slice(0, -userId.length - 1).includes(':');
    const allowed = after === undefined ? !participant || own : mayWriteBallot(key, after, userId, running, now);
    if (!allowed) {
      restore(map, key, before);
      reverted = true;
      continue;
    }
    if (after === undefined || !running?.anonymousBallots || !isObj(after)) continue;
    const want = anonymousForm(after, doc !== shared);
    if (!same(after, want)) {
      map.set(key, want);
      reverted = true;
    }
  }
  return reverted;
}

// ---------------------------------------------------------------- the reveal of an anonymous vote

/** Is this sealed ballot revealed without its voter: stamped when written, or of the running anonymous session? */
export function isAnonymousBallot(value: unknown, main: Y.Doc): boolean {
  if (!isObj(value)) return false;
  if (value.anonymous === true) return true;
  const s = asVotingSession(main.getMap<unknown>(VOTING_COLLECTION).get(VOTING_SESSION_KEY));
  return !!s?.anonymousBallots && value.sessionId === s.id;
}

/**
 * Writes sealed ballots of anonymous votes into the shared doc's voting map (inside the reveal's
 * transaction) without their voters: each under `${sessionId}:anon:<n>`, numbered in an order that
 * depends only on the votes they hold (never on who, when or where they were written), with the
 * voters' "has voted" markers deleted. Numbering continues after the session's anonymous ballots
 * already there, so a later reveal adds instead of overwriting; two instances revealing the same
 * ballots at once write the same keys and values.
 */
export function revealAnonymousBallots(target: Y.Map<unknown>, ballots: unknown[]): void {
  const bySession = new Map<string, string[][]>();
  for (const b of ballots) {
    if (!isObj(b) || typeof b.sessionId !== 'string' || !Array.isArray(b.elementIds)) continue;
    const ids = (b.elementIds as unknown[]).filter((id): id is string => typeof id === 'string').sort();
    if (typeof b.userId === 'string') target.delete(`${b.sessionId}:${b.userId}`);
    if (!ids.length) continue;
    bySession.set(b.sessionId, [...(bySession.get(b.sessionId) ?? []), ids]);
  }
  for (const [sessionId, list] of bySession) {
    const prefix = `${sessionId}:${ANONYMOUS_VOTER_PREFIX}`;
    let n = 0;
    for (const key of target.keys()) if (key.startsWith(prefix)) n++;
    list.sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : a.join('\u0000') > b.join('\u0000') ? 1 : 0));
    for (const elementIds of list) {
      const userId = `${ANONYMOUS_VOTER_PREFIX}${n++}`;
      target.set(`${sessionId}:${userId}`, { sessionId, userId, elementIds } satisfies VoteBallot);
    }
  }
}
