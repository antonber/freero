// Dot-voting budget (KAI-210), enforced here next to the facilitator limits (facilitation.ts).
//
// The `voting` collection (@freero/shared VOTING_COLLECTION) holds the running VotingSession under
// VOTING_SESSION_KEY and one ballot per voter under `${sessionId}:${userId}`. Readers tally only
// `votesPerUser` votes of a ballot, but a raw client could still stuff the box: write a ballot over
// budget, write ballots under made-up user ids (each counts as another voter), or raise the running
// session's budget. So a socket's change to the collection, in the shared doc or in its private
// layer (sealed ballots of a hidden vote), is undone in the same transaction unless:
//
//   key                     it may set it to …                               it may delete it
//   session (shared only)   a well-formed session with VOTES_PER_USER_MIN ≤  always (clear results,
//                           votesPerUser ≤ VOTES_PER_USER_MAX; the same       start a new vote)
//                           session id keeps its votesPerUser
//   <sid>:<uid>             its OWN ballot (uid and userId are the socket's   always (a new vote wipes
//                           user, the key is `${sessionId}:${userId}`) for    everyone's ballots; editors
//                           the RUNNING session sid, with at most             may also end the vote)
//                           votesPerUser votes
//
// Compensation, not dropping, for the reason given in facilitation.ts: the sender is sent the
// correction and its doc converges. The Yjs undo manager does not track collections, so an honest
// client never writes someone else's ballot (undo can't bring one back). Reveals of sealed ballots
// are made by the server (not a socket) and checked when each ballot was written.
import * as Y from 'yjs';
import { VOTES_PER_USER_MAX, VOTES_PER_USER_MIN, VOTING_COLLECTION, VOTING_SESSION_KEY, type VotingSession } from '@freero/shared';
import { changedKeys } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A session value with a usable id and budget, or null. */
export function asVotingSession(v: unknown): VotingSession | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.active !== 'boolean') return null;
  const n = v.votesPerUser;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < VOTES_PER_USER_MIN || n > VOTES_PER_USER_MAX) return null;
  return v as unknown as VotingSession;
}

/** May a socket turn the session value `before` into `after`? */
export function mayChangeVotingSession(before: unknown, after: unknown): boolean {
  if (same(before, after) || after === undefined) return true;
  const next = asVotingSession(after);
  if (!next) return false;
  const prev = asVotingSession(before);
  return !prev || prev.id !== next.id || prev.votesPerUser === next.votesPerUser;
}

/** May `userId` set ballot key `key` to `after` while `session` runs (undefined `after`: delete)? */
export function mayWriteBallot(key: string, after: unknown, userId: string, session: VotingSession | null): boolean {
  if (after === undefined) return true;
  if (!isObj(after) || after.userId !== userId || typeof after.sessionId !== 'string') return false;
  if (key !== `${after.sessionId}:${userId}`) return false;
  if (!session?.active || session.id !== after.sessionId) return false;
  const ids = after.elementIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') && ids.length <= session.votesPerUser;
}

function restore(map: Y.Map<unknown>, key: string, before: unknown): void {
  if (before === undefined) map.delete(key);
  else map.set(key, before);
}

/**
 * Undoes this transaction's changes to `doc`'s voting collection that `userId` may not make (see
 * the header). `shared`: the board's shared doc, which holds the session; for a private layer pass
 * the layer doc as `doc` and the shared doc as `shared`. The voting map of `doc` must exist before
 * the transaction (changedKeys). True when it undid something.
 */
export function guardVotes(tr: Y.Transaction, doc: Y.Doc, shared: Y.Doc, userId: string): boolean {
  if (!doc.share.has(VOTING_COLLECTION)) return false;
  const map = doc.getMap<unknown>(VOTING_COLLECTION);
  const changes = changedKeys(tr, map);
  if (!changes.size) return false;
  let reverted = false;
  const session = changes.get(VOTING_SESSION_KEY);
  if (session && (doc !== shared || !mayChangeVotingSession(session.before, session.after))) {
    restore(map, VOTING_SESSION_KEY, session.before);
    reverted = true;
  }
  // Ballots are judged against the session as it stands after this update (a new vote in the same
  // update counts; a session change undone above does not).
  const running = asVotingSession(shared.getMap<unknown>(VOTING_COLLECTION).get(VOTING_SESSION_KEY));
  for (const [key, { before, after }] of changes) {
    if (key === VOTING_SESSION_KEY || same(before, after) || mayWriteBallot(key, after, userId, running)) continue;
    restore(map, key, before);
    reverted = true;
  }
  return reverted;
}
