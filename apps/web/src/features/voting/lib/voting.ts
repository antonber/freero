// Pure voting model over the feature's `voting` collection:
//   'session'                 -> VotingSession (the latest one; older results are discarded)
//   `${sessionId}:${userId}`  -> Ballot (each user writes only their own key)
// A ballot is one value per *user* (not per tab or per vote), so two tabs of the same user
// overwrite each other's ballot (last writer wins) instead of adding up past the limit.
import type { BoardElement, ElementType, VoteBallot, VotingSession } from '@freero/shared';
import type { Collection } from '@engine';

export const SESSION_KEY = 'session';
export const MIN_VOTES = 1;
export const MAX_VOTES = 20;
/** What "All stickies, cards and shapes" means. */
export const VOTABLE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(['sticky', 'card', 'shape']);

/** Stored ballot: the shared VoteBallot plus the voter's display name for the participants list. */
export interface Ballot extends VoteBallot {
  userName?: string;
  userColor?: string;
}

export type VotingValue = VotingSession | Ballot;
export type VotingStore = Pick<Collection<VotingValue>, 'get' | 'set' | 'delete' | 'entries'>;
export interface Voter {
  id: string;
  name: string;
  color: string;
}

export const ballotKey = (sessionId: string, userId: string) => `${sessionId}:${userId}`;

export function getSession(store: Pick<VotingStore, 'get'>): VotingSession | undefined {
  const s = store.get(SESSION_KEY);
  return s && 'votesPerUser' in s ? s : undefined;
}

export function isEligible(session: VotingSession, el: Pick<BoardElement, 'id' | 'type'>): boolean {
  return session.elementIds ? session.elementIds.includes(el.id) : VOTABLE_TYPES.has(el.type);
}

/** Ballots that belong to `session` (stale keys from older sessions are ignored). */
export function ballotsOf(entries: Array<[string, VotingValue]>, session: VotingSession): Ballot[] {
  const out: Ballot[] = [];
  for (const [key, v] of entries) {
    if (key === SESSION_KEY || !v || !('elementIds' in v) || !('userId' in v)) continue;
    if (v.sessionId === session.id && key === ballotKey(session.id, v.userId)) out.push(v);
  }
  return out;
}

/**
 * The votes of a ballot that count: on elements that still exist and are eligible, and never
 * more than the session allows (a stale or misbehaving client can't stuff the box).
 */
export function countedVotes(ballot: VoteBallot | undefined, session: VotingSession, exists: (id: string) => boolean): string[] {
  if (!ballot) return [];
  return ballot.elementIds.filter(exists).slice(0, session.votesPerUser);
}

/** elementId -> total votes (duplicates on one element each count). */
export function tally(session: VotingSession, ballots: VoteBallot[], exists: (id: string) => boolean): Map<string, number> {
  const totals = new Map<string, number>();
  for (const b of ballots) for (const id of countedVotes(b, session, exists)) totals.set(id, (totals.get(id) ?? 0) + 1);
  return totals;
}

/**
 * Elements by total, highest first; ties keep board order (`order` = ids in render order) and
 * share a rank (1, 1, 3).
 */
export function ranked(totals: Map<string, number>, order: string[]): Array<{ id: string; votes: number; rank: number }> {
  const pos = new Map(order.map((id, i) => [id, i]));
  const sorted = [...totals]
    .filter(([id, n]) => n > 0 && pos.has(id))
    .map(([id, votes]) => ({ id, votes, rank: 0 }))
    .sort((a, b) => b.votes - a.votes || pos.get(a.id)! - pos.get(b.id)!);
  sorted.forEach((r, i) => (r.rank = i > 0 && sorted[i - 1].votes === r.votes ? sorted[i - 1].rank : i + 1));
  return sorted;
}

export function voters(ballots: Ballot[], session: VotingSession, exists: (id: string) => boolean): Voter[] {
  return ballots
    .filter((b) => countedVotes(b, session, exists).length > 0)
    .map((b) => ({ id: b.userId, name: b.userName || 'Someone', color: b.userColor || '#8a89a3' }));
}

interface Actor {
  id: string;
  name: string;
  color: string;
}

function writeBallot(store: VotingStore, session: VotingSession, user: Actor, elementIds: string[]) {
  const ballot: Ballot = { sessionId: session.id, userId: user.id, elementIds, userName: user.name, userColor: user.color };
  store.set(ballotKey(session.id, user.id), ballot);
}

/** Adds one vote on `elementId`. Returns false (and writes nothing) when it isn't allowed. */
export function castVote(
  store: VotingStore,
  user: Actor,
  elementId: string,
  exists: (id: string) => boolean,
): boolean {
  const session = getSession(store);
  if (!session?.active || !exists(elementId)) return false;
  const current = countedVotes(store.get(ballotKey(session.id, user.id)) as Ballot | undefined, session, exists);
  if (current.length >= session.votesPerUser) return false;
  writeBallot(store, session, user, [...current, elementId]);
  return true;
}

/** Takes back one of your votes on `elementId`. */
export function retractVote(store: VotingStore, user: Actor, elementId: string, exists: (id: string) => boolean): boolean {
  const session = getSession(store);
  if (!session?.active) return false;
  const current = countedVotes(store.get(ballotKey(session.id, user.id)) as Ballot | undefined, session, exists);
  const i = current.lastIndexOf(elementId);
  if (i < 0) return false;
  writeBallot(store, session, user, [...current.slice(0, i), ...current.slice(i + 1)]);
  return true;
}

export interface SessionOptions {
  id: string;
  title: string;
  votesPerUser: number;
  hideResults: boolean;
  elementIds: string[] | null;
}

/**
 * Starts a session, discarding the previous session and all its ballots. Call inside
 * `editor.transact` so peers see the switch as one update (never old ballots + new session).
 */
export function startSession(store: VotingStore, opts: SessionOptions, user: Actor, now: number): VotingSession {
  for (const [key] of store.entries()) store.delete(key);
  const session: VotingSession = {
    id: opts.id,
    active: true,
    title: opts.title.trim() || 'Vote',
    votesPerUser: Math.min(MAX_VOTES, Math.max(MIN_VOTES, Math.round(opts.votesPerUser))),
    elementIds: opts.elementIds,
    anonymous: opts.hideResults,
    startedBy: user.id,
    startedAt: now,
    endedAt: null,
  };
  store.set(SESSION_KEY, session);
  return session;
}

export function endSession(store: VotingStore, now: number): void {
  const session = getSession(store);
  if (session?.active) store.set(SESSION_KEY, { ...session, active: false, endedAt: now });
}

/** Removes the results entirely (session + ballots). */
export function clearSession(store: VotingStore): void {
  for (const [key] of store.entries()) store.delete(key);
}
