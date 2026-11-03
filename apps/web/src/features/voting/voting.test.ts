import { describe, expect, it } from 'vitest';
import { createTestBoard } from '@engine';
import manifest from './feature';
import { end, start, vote } from './lib/actions';
import {
  ballotKey,
  ballotsOf,
  castVote,
  endSession,
  getSession,
  historyOf,
  retractVote,
  startSession,
  tally,
  voters,
  type VotingStore,
  type VotingValue,
} from './lib/voting';

/** In-memory stand-in for one client's replica of the `voting` collection. */
function replica(seed?: Map<string, VotingValue>): VotingStore & { map: Map<string, VotingValue> } {
  const map = new Map(seed);
  return {
    map,
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, structuredClone(v)),
    delete: (k) => void map.delete(k),
    entries: () => [...map.entries()],
  };
}

/** Yjs map semantics: concurrent writes to the same key resolve to one of them (last writer here). */
function merge(...replicas: Array<{ map: Map<string, VotingValue> }>): Map<string, VotingValue> {
  const out = new Map<string, VotingValue>();
  for (const r of replicas) for (const [k, v] of r.map) out.set(k, v);
  return out;
}

const ana = { id: 'ana', name: 'Ana', color: '#f00' };
const ben = { id: 'ben', name: 'Ben', color: '#0f0' };
const board = new Set(['s1', 's2', 's3', 's4']);
const exists = (id: string) => board.has(id);

function boardWithSession(votesPerUser: number) {
  const r = replica();
  startSession(r, { id: 'sess1', title: 'Pick', votesPerUser, hideResults: false, elementIds: null }, ana, 1);
  return r;
}

describe('voting', () => {
  it("a user can't exceed votes-per-user, even with two tabs", () => {
    const synced = boardWithSession(3);
    castVote(synced, ana, 's1', exists);

    // Two tabs of the same user, both seeing 2 votes left, spend them concurrently.
    const tabA = replica(synced.map);
    const tabB = replica(synced.map);
    expect(castVote(tabA, ana, 's2', exists)).toBe(true);
    expect(castVote(tabA, ana, 's2', exists)).toBe(true);
    expect(castVote(tabA, ana, 's3', exists)).toBe(false); // out of votes in this tab
    castVote(tabB, ana, 's4', exists);
    castVote(tabB, ana, 's4', exists);

    const merged = merge(tabA, tabB);
    const session = getSession(replica(merged))!;
    const totals = tally(session, ballotsOf([...merged], session), exists);
    const anaTotal = [...totals.values()].reduce((a, b) => a + b, 0);
    expect(anaTotal).toBe(3);
  });

  it('results tally duplicate votes, and ignore deleted elements, over-limit ballots and older sessions', () => {
    const r = boardWithSession(3);
    castVote(r, ana, 's1', exists);
    castVote(r, ana, 's1', exists);
    castVote(r, ana, 's2', exists);
    castVote(r, ben, 's1', exists);
    // A stale client writes a stuffed ballot and one for an older session.
    r.set(ballotKey('sess1', 'eve'), { sessionId: 'sess1', userId: 'eve', elementIds: ['s3', 's3', 's3', 's3', 's3'] });
    r.set(ballotKey('old', 'ben'), { sessionId: 'old', userId: 'ben', elementIds: ['s2', 's2'] });
    // ...and Ben voted on a sticky that someone deleted afterwards.
    castVote(r, ben, 's4', exists);
    const afterDelete = (id: string) => id !== 's4' && exists(id);

    const session = getSession(r)!;
    const totals = tally(session, ballotsOf(r.entries(), session), afterDelete);
    expect(Object.fromEntries(totals)).toEqual({ s1: 3, s2: 1, s3: 3 });
  });

  it('removing a vote takes back one of your duplicates, never everyone else’s', () => {
    const r = boardWithSession(5);
    castVote(r, ana, 's1', exists);
    castVote(r, ana, 's1', exists);
    castVote(r, ben, 's1', exists);
    expect(retractVote(r, ana, 's1', exists)).toBe(true);
    expect(retractVote(r, ben, 's2', exists)).toBe(false);
    const session = getSession(r)!;
    expect(tally(session, ballotsOf(r.entries(), session), exists).get('s1')).toBe(2);
  });

  it('starting a new session discards the previous ballots so old votes never leak into it', () => {
    const r = boardWithSession(3);
    castVote(r, ana, 's1', exists);
    castVote(r, ben, 's2', exists);
    startSession(r, { id: 'sess2', title: 'Round 2', votesPerUser: 3, hideResults: true, elementIds: null }, ben, 2);
    expect(r.entries().map(([k]) => k)).toEqual(['session']);
    // Ana gets her full allowance again.
    for (let i = 0; i < 3; i++) expect(castVote(r, ana, 's1', exists)).toBe(true);
  });

  it("the next vote keeps the ended vote's totals in the history — never its ballots — and drops the oldest past votes", () => {
    const r = boardWithSession(3);
    castVote(r, ana, 's1', exists);
    castVote(r, ben, 's1', exists);
    castVote(r, ben, 's2', exists);
    endSession(r, 5);
    startSession(r, { id: 'sess2', title: 'Round 2', votesPerUser: 3, hideResults: true, elementIds: null }, ana, 6, exists);
    const [past] = historyOf(r.entries());
    expect(past.totals).toEqual([['s1', 2], ['s2', 1]]);
    expect(past.voters).toBe(2);
    expect(JSON.stringify(past)).not.toContain('"ben"'); // a voter (Ana started the vote: its session says so)
    expect(r.entries().some(([k]) => k.startsWith('sess1:'))).toBe(false);

    for (let i = 3; i < 30; i++) {
      castVote(r, ana, 's3', exists);
      endSession(r, i * 10);
      startSession(r, { id: `sess${i}`, title: `Round ${i}`, votesPerUser: 3, hideResults: false, elementIds: null }, ana, i * 10 + 1, exists);
    }
    const kept = historyOf(r.entries());
    expect(kept).toHaveLength(20);
    expect(kept[0].session.id).toBe('sess28'); // the newest ended vote; sess29 still runs
  });

  it('with hidden results, the other replicas learn only that someone voted, never on what, until the vote ends', () => {
    const board = createTestBoard({ users: ['ana', 'ben'], features: [manifest] });
    const [ana, ben] = board.editors('voting');
    const pick = ana.create({ type: 'sticky', x: 0, y: 0 } as never);
    start(ana, { title: 'Pick', votesPerUser: 3, hideResults: true, elementIds: null });
    board.sync();
    vote(ana, pick);
    vote(ana, pick);
    board.sync();

    const seen = ben.collection<VotingValue>('voting').entries();
    expect(JSON.stringify(seen)).not.toContain(pick);
    const session = getSession(ben.collection<VotingValue>('voting'))!;
    expect(voters(ballotsOf(seen, session), session, () => true).map((v) => v.id)).toEqual(['ana']);

    end(ana);
    board.sync();
    const after = ben.collection<VotingValue>('voting').entries();
    expect(tally(session, ballotsOf(after, session), () => true).get(pick)).toBe(2);
    board.destroy();
  });
});
