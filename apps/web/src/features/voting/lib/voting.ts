// Pure voting model over the feature's `voting` collection:
//   'session'                 -> VotingSession (the latest one)
//   `${sessionId}:${userId}`  -> Ballot (each user writes only their own key)
//   `h:${sessionId}`          -> VotingHistoryEntry: an earlier vote's totals, kept for the results
//                                panel when the next one starts (never its ballots)
// A ballot is one value per *user* (not per tab or per vote), so two tabs of the same user
// overwrite each other's ballot (last writer wins) instead of adding up past the limit.
//
// Hidden results (session.anonymous): the ballot goes to the voter's PRIVATE copy of the
// collection (Editor.privateCollection — the server sends it to nobody else) and the shared key
// only holds a `sealed` marker ("has voted"). Ending the session reveals every sealed ballot into
// the shared collection on the server, replacing the markers.
//
// Anonymous ballots (session.anonymousBallots, always with hidden results): the sealed ballot and the
// marker carry no name, and the server reveals the ballots under `anon:<n>` voter ids, deleting the
// markers (realtime votingRules.ts), so after the vote nobody can tell who voted for what.
//
// Commenters and guests vote too while the board lets them take part (Editor.isParticipant): the
// server holds them to their own ballot like everyone (votingRules.ts).
import {
  VOTES_PER_USER_MAX,
  VOTES_PER_USER_MIN,
  VOTING_HISTORY_MAX,
  VOTING_SESSION_KEY,
  isVotingHistoryKey,
  votingHistoryKey,
  type BoardElement,
  type ElementType,
  type VoteBallot,
  type VotingHistoryEntry,
  type VotingSession,
} from '@freero/shared';
import type { Collection } from '@engine';

export const SESSION_KEY = VOTING_SESSION_KEY;
export const MIN_VOTES = VOTES_PER_USER_MIN;
/** The server rejects ballots over the session's budget and budgets over this (votingRules.ts). */
export const MAX_VOTES = VOTES_PER_USER_MAX;
/** What "All stickies, cards and shapes" means. */
export const VOTABLE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(['sticky', 'card', 'shape']);

/** Stored ballot: the shared VoteBallot plus the voter's display name for the participants list. */
export interface Ballot extends VoteBallot {
  userName?: string;
  userColor?: string;
}

export type VotingValue = VotingSession | Ballot | VotingHistoryEntry;
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
    if (key === SESSION_KEY || !v || !('elementIds' in v) || !('userId' in v) || !('sessionId' in v)) continue;
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
  const cap = session.maxPerItem;
  const per = new Map<string, number>();
  const kept = cap ? ballot.elementIds.filter((id) => (per.set(id, (per.get(id) ?? 0) + 1).get(id) ?? 0) <= cap) : ballot.elementIds;
  return kept.filter(exists).slice(0, session.votesPerUser);
}

/** Server-clock ms left before the vote's timer closes it (null: no timer). */
export function timeLeft(session: VotingSession, now: number): number | null {
  return session.endsAt === undefined || session.endsAt === null ? null : Math.max(0, session.endsAt - now);
}

/** Is the session taking votes at server time `now` (running, and its timer not run out)? */
export const isOpen = (session: VotingSession | undefined, now: number): boolean => !!session?.active && timeLeft(session, now) !== 0;

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
    .filter((b) => b.sealed || countedVotes(b, session, exists).length > 0)
    .map((b) => ({ id: b.userId, name: b.userName || 'Someone', color: b.userColor || '#8a89a3' }));
}

interface Actor {
  id: string;
  name: string;
  color: string;
}

function writeBallot(store: VotingStore, session: VotingSession, user: Actor, elementIds: string[]) {
  // An anonymous vote's ballot carries no name (the server would strip it anyway: votingRules.ts).
  const ballot: Ballot = session.anonymousBallots
    ? { sessionId: session.id, userId: user.id, elementIds, anonymous: true }
    : { sessionId: session.id, userId: user.id, elementIds, userName: user.name, userColor: user.color };
  store.set(ballotKey(session.id, user.id), ballot);
}

/** Why `user` can't add a vote on `elementId` now (null: they can). */
export function whyNoVote(session: VotingSession, current: string[], elementId: string): 'budget' | 'item' | null {
  if (current.length >= session.votesPerUser) return 'budget';
  if (session.maxPerItem && current.filter((id) => id === elementId).length >= session.maxPerItem) return 'item';
  return null;
}

/**
 * Adds one vote on `elementId`. Returns false (and writes nothing) when it isn't allowed. The
 * session is read from `store`; the ballot is read from and written to `ballots` (the voter's
 * private copy while results are hidden).
 */
export function castVote(
  store: VotingStore,
  user: Actor,
  elementId: string,
  exists: (id: string) => boolean,
  ballots: VotingStore = store,
  now = Date.now(),
): boolean {
  const session = getSession(store);
  if (!session || !isOpen(session, now) || !exists(elementId)) return false;
  const current = countedVotes(ballots.get(ballotKey(session.id, user.id)) as Ballot | undefined, session, exists);
  if (whyNoVote(session, current, elementId)) return false;
  writeBallot(ballots, session, user, [...current, elementId]);
  return true;
}

/** Takes back one of your votes on `elementId` (`ballots` as in castVote). */
export function retractVote(
  store: VotingStore,
  user: Actor,
  elementId: string,
  exists: (id: string) => boolean,
  ballots: VotingStore = store,
  now = Date.now(),
): boolean {
  const session = getSession(store);
  if (!session || !isOpen(session, now)) return false;
  const current = countedVotes(ballots.get(ballotKey(session.id, user.id)) as Ballot | undefined, session, exists);
  const i = current.lastIndexOf(elementId);
  if (i < 0) return false;
  writeBallot(ballots, session, user, [...current.slice(0, i), ...current.slice(i + 1)]);
  return true;
}

/**
 * Hidden results: keeps the shared "has voted" marker in line with the user's sealed ballot
 * (`votes` = how many votes it holds). Writes only when that changes.
 */
export function syncSealedMarker(store: VotingStore, session: VotingSession, user: Actor, votes: number): void {
  const key = ballotKey(session.id, user.id);
  const has = !!(store.get(key) as Ballot | undefined)?.sealed;
  const who = session.anonymousBallots ? {} : { userName: user.name, userColor: user.color };
  if (votes > 0 && !has) store.set(key, { sessionId: session.id, userId: user.id, elementIds: [], sealed: true, ...who });
  else if (votes === 0 && has) store.delete(key);
}

export interface SessionOptions {
  id: string;
  title: string;
  votesPerUser: number;
  hideResults: boolean;
  elementIds: string[] | null;
  /** Ballots revealed without their voters (always sealed until the end: the server refuses it otherwise). */
  anonymous?: boolean;
  /** At most this many of one person's votes on one item. */
  maxPerItem?: number | null;
  /** The vote closes by itself this long after it starts. */
  durationMs?: number | null;
}

/** Longest vote timer (99 minutes, like the board timer). */
export const MAX_VOTE_DURATION = 99 * 60_000;

/**
 * Starts a session, discarding the previous session and all its ballots. Call inside
 * `editor.transact` so peers see the switch as one update (never old ballots + new session).
 */
export function startSession(store: VotingStore, opts: SessionOptions, user: Actor, now: number, exists: (id: string) => boolean = () => true): VotingSession {
  archive(store, exists, now);
  for (const [key] of store.entries()) if (!isVotingHistoryKey(key)) store.delete(key);
  const votesPerUser = Math.min(MAX_VOTES, Math.max(MIN_VOTES, Math.round(opts.votesPerUser)));
  const cap = opts.maxPerItem ? Math.min(votesPerUser, Math.max(1, Math.round(opts.maxPerItem))) : null;
  const duration = opts.durationMs ? Math.min(MAX_VOTE_DURATION, Math.max(10_000, Math.round(opts.durationMs))) : null;
  const anonymous = !!opts.anonymous;
  const session: VotingSession = {
    id: opts.id,
    active: true,
    title: opts.title.trim() || 'Vote',
    votesPerUser,
    elementIds: opts.elementIds,
    // Anonymous ballots stay sealed until the end: running totals would show whose click moved which count.
    anonymous: opts.hideResults || anonymous,
    startedBy: user.id,
    startedAt: now,
    endedAt: null,
    ...(anonymous ? { anonymousBallots: true } : {}),
    ...(cap && cap < votesPerUser ? { maxPerItem: cap } : {}),
    ...(duration ? { endsAt: now + duration } : {}),
  };
  store.set(SESSION_KEY, session);
  return session;
}

/** Past votes, newest first. */
export function historyOf(entries: Array<[string, VotingValue]>): VotingHistoryEntry[] {
  const out: VotingHistoryEntry[] = [];
  for (const [key, v] of entries) if (isVotingHistoryKey(key) && v && 'totals' in v && 'session' in v) out.push(v);
  return out.sort((a, b) => b.archivedAt - a.archivedAt);
}

/**
 * Keeps the ended session's results in the history (totals only, never ballots) — before a new
 * vote or "Clear results" removes them — and drops the oldest past votes beyond VOTING_HISTORY_MAX.
 * A running vote, or one nobody voted in, leaves nothing.
 */
export function archive(store: VotingStore, exists: (id: string) => boolean, now: number): void {
  const session = getSession(store);
  if (session && !session.active) {
    const ballots = ballotsOf(store.entries(), session);
    const totals = [...tally(session, ballots, exists)].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (totals.length) {
      const entry: VotingHistoryEntry = { session, totals, voters: voters(ballots, session, exists).length, archivedAt: now };
      store.set(votingHistoryKey(session.id), entry);
    }
  }
  const past = historyOf(store.entries());
  for (const old of past.slice(VOTING_HISTORY_MAX)) store.delete(votingHistoryKey(old.session.id));
}

export function endSession(store: VotingStore, now: number): void {
  const session = getSession(store);
  if (session?.active) store.set(SESSION_KEY, { ...session, active: false, endedAt: now });
}

/** Removes the current results from the board (session + ballots); they stay in the history. */
export function clearSession(store: VotingStore, exists: (id: string) => boolean = () => true, now = Date.now()): void {
  archive(store, exists, now);
  for (const [key] of store.entries()) if (!isVotingHistoryKey(key)) store.delete(key);
}

/** Forgets one past vote. */
export function forgetPast(store: VotingStore, sessionId: string): void {
  store.delete(votingHistoryKey(sessionId));
}
