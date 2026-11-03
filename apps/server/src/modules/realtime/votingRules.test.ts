// The vote budget is enforced by undoing a socket's forbidden voting change inside the transaction
// that applies it (votingRules.ts), the way rooms.ts runs it: a voter's client, the server's
// shared doc (and a private layer doc), and what the server relays.
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import type { VotingSession } from '@freero/shared';
import { guardVotes, type VoterWho } from './votingRules';

const session = (patch: Partial<VotingSession> = {}): VotingSession => ({
  id: 's1',
  active: true,
  title: 'Vote',
  votesPerUser: 3,
  elementIds: null,
  anonymous: false,
  startedBy: 'lead',
  startedAt: 1,
  endedAt: null,
  ...patch,
});
const ballot = (userId: string, elementIds: string[], sessionId = 's1') => ({ sessionId, userId, elementIds });

/** A server doc (shared or layer) and a client that starts from its state. */
function pair(seed?: (voting: Y.Map<unknown>) => void) {
  const server = new Y.Doc();
  const voting = server.getMap<unknown>('voting');
  seed?.(voting);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client, voting: () => client.getMap<unknown>('voting') };
}

/** Applies what `write` does on `client` to `server` as `userId`'s socket; returns what the room relays and the correction. */
function serve(server: Y.Doc, client: Y.Doc, write: () => void, userId: string | VoterWho, shared = server) {
  let update: Uint8Array | null = null;
  const on = (u: Uint8Array) => (update = u);
  client.on('update', on);
  write();
  client.off('update', on);
  const before = Y.encodeStateVector(server);
  const relayed: Uint8Array[] = [];
  const relay = (u: Uint8Array) => relayed.push(u);
  server.on('update', relay);
  let fixed = false;
  server.transact((tr) => {
    Y.applyUpdate(server, update!);
    fixed = guardVotes(tr, server, shared, userId);
  }, 'socket');
  server.off('update', relay);
  if (fixed) Y.applyUpdate(client, Y.encodeStateAsUpdate(server, before));
  return relayed;
}

/** What a bystander applying the relayed updates ends up with. */
function bystanderSees(server0: Uint8Array, relayed: Uint8Array[]) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, server0);
  for (const u of relayed) Y.applyUpdate(doc, u);
  return doc.getMap<unknown>('voting').toJSON();
}

it('a raw client voting over the budget never reaches anyone, and its doc converges so its next vote still applies', () => {
  const { server, client, voting } = pair((v) => v.set('session', session()));
  const start = Y.encodeStateAsUpdate(server);
  const relayed = serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a', 'a', 'a', 'a', 'a'])), 'amy');
  expect(bystanderSees(start, relayed)['s1:amy']).toBeUndefined();
  expect(voting().has('s1:amy')).toBe(false);

  serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a', 'b', 'c'])), 'amy');
  expect(server.store.pendingStructs).toBeNull();
  expect(server.getMap('voting').get('s1:amy')).toEqual(ballot('amy', ['a', 'b', 'c']));
});

it('nobody can stuff the box with ballots of made-up voters, nor vote in a session that is not running', () => {
  const { server, client, voting } = pair((v) => v.set('session', session()));
  serve(server, client, () => voting().set('s1:ghost', ballot('ghost', ['a', 'a', 'a'])), 'amy');
  serve(server, client, () => voting().set('s1:ghost2', ballot('amy', ['a'])), 'amy');
  serve(server, client, () => voting().set('s9:amy', ballot('amy', ['a'], 's9')), 'amy');
  expect([...server.getMap('voting').keys()]).toEqual(['session']);

  serve(server, client, () => voting().set('session', session({ active: false, endedAt: 2 })), 'lead');
  serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a'])), 'amy');
  expect(server.getMap('voting').has('s1:amy')).toBe(false);
});

it("raising a running vote's budget is undone together with the bigger ballot sent in the same update, but a new vote may wipe everyone's ballots", () => {
  const { server, client, voting } = pair((v) => {
    v.set('session', session());
    v.set('s1:bob', ballot('bob', ['x', 'y']));
  });
  serve(
    server,
    client,
    () =>
      client.transact(() => {
        voting().set('session', session({ votesPerUser: 20 }));
        voting().set('s1:amy', ballot('amy', ['a', 'a', 'a', 'a', 'a', 'a']));
      }),
    'amy',
  );
  expect((server.getMap('voting').get('session') as VotingSession).votesPerUser).toBe(3);
  expect(server.getMap('voting').has('s1:amy')).toBe(false);

  serve(
    server,
    client,
    () =>
      client.transact(() => {
        for (const k of [...voting().keys()]) voting().delete(k);
        voting().set('session', session({ id: 's2', votesPerUser: 5 }));
      }),
    'amy',
  );
  expect(server.getMap('voting').toJSON()).toEqual({ session: session({ id: 's2', votesPerUser: 5 }) });
});

it("a sealed ballot in a hidden vote's private layer keeps to the budget of the shared session", () => {
  const shared = new Y.Doc();
  shared.getMap('voting').set('session', session({ anonymous: true, votesPerUser: 2 }));
  const { server: layer, client, voting } = pair();
  serve(layer, client, () => voting().set('s1:amy', ballot('amy', ['a', 'b', 'c'])), 'amy', shared);
  expect(layer.getMap('voting').has('s1:amy')).toBe(false);
  serve(layer, client, () => voting().set('s1:amy', ballot('amy', ['a', 'b'])), 'amy', shared);
  expect(layer.getMap('voting').get('s1:amy')).toEqual(ballot('amy', ['a', 'b']));
});

it("a participant (commenter or guest) can cast and take back only their own ballot: never end, restart or re-scope the vote, clear someone else's ballot, or rewrite past results", () => {
  const { server, client, voting } = pair((v) => {
    v.set('session', session());
    v.set('s1:bob', ballot('bob', ['x']));
    v.set('h:s0', { session: session({ id: 's0', active: false }), totals: [['x', 4]], voters: 2, archivedAt: 1 });
  });
  const kim = { userId: 'guest_kim', participant: true };
  serve(server, client, () => voting().set('s1:guest_kim', ballot('guest_kim', ['a', 'b'])), kim);
  expect(server.getMap('voting').get('s1:guest_kim')).toEqual(ballot('guest_kim', ['a', 'b']));

  serve(server, client, () => voting().set('session', session({ active: false, endedAt: 2 })), kim);
  serve(server, client, () => voting().delete('s1:bob'), kim);
  serve(server, client, () => voting().set('h:s0', { session: session({ id: 's0', active: false }), totals: [['a', 99]], voters: 1, archivedAt: 1 }), kim);
  serve(server, client, () => client.transact(() => {
    for (const k of [...voting().keys()]) if (k !== 's1:guest_kim') voting().delete(k);
    voting().set('session', session({ id: 's2', startedBy: 'guest_kim' }));
  }), kim);
  const after = server.getMap('voting').toJSON();
  expect(after.session).toEqual(session());
  expect(after['s1:bob']).toEqual(ballot('bob', ['x']));
  expect(after['h:s0'].totals).toEqual([['x', 4]]);
  expect(voting().toJSON()).toEqual(after); // the guest's doc converged on the server's

  serve(server, client, () => voting().delete('s1:guest_kim'), kim);
  expect(server.getMap('voting').has('s1:guest_kim')).toBe(false);
});

it('no ballot is taken once the vote’s timer has run out, nor one that puts more than the per-item cap on one item', () => {
  const { server, client, voting } = pair((v) => v.set('session', session({ votesPerUser: 5, maxPerItem: 2, endsAt: 10_000 })));
  serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a', 'a', 'a'])), { userId: 'amy', now: 5_000 });
  expect(server.getMap('voting').has('s1:amy')).toBe(false);
  serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a', 'a', 'b'])), { userId: 'amy', now: 5_000 });
  expect(server.getMap('voting').get('s1:amy')).toEqual(ballot('amy', ['a', 'a', 'b']));
  serve(server, client, () => voting().set('s1:amy', ballot('amy', ['a', 'a', 'b', 'c'])), { userId: 'amy', now: 20_000 });
  expect(server.getMap('voting').get('s1:amy')).toEqual(ballot('amy', ['a', 'a', 'b']));
});

it("an anonymous vote can't be turned back into a named one while it runs, and no ballot in it ever carries the voter's name — in the private layer or as the shared marker", () => {
  const shared = new Y.Doc();
  const anon = session({ anonymous: true, anonymousBallots: true });
  shared.getMap('voting').set('session', anon);
  const { server: sharedServer, client: sharedClient, voting: sharedVoting } = pair((v) => v.set('session', anon));
  serve(sharedServer, sharedClient, () => sharedVoting().set('session', { ...anon, anonymousBallots: false }), 'lead');
  expect(sharedServer.getMap('voting').get('session')).toEqual(anon);
  const relayed = serve(sharedServer, sharedClient, () => sharedVoting().set('s1:amy', { ...ballot('amy', []), sealed: true, userName: 'Amy Pond' }), 'amy');
  expect(sharedServer.getMap('voting').get('s1:amy')).toEqual({ sessionId: 's1', userId: 'amy', elementIds: [], sealed: true });
  expect(relayed.some((u) => Buffer.from(u).includes(Buffer.from('Amy Pond')))).toBe(false);

  // An older client seals its ballot with its name: the server stamps it and drops the name.
  const { server: layer, client, voting } = pair();
  serve(layer, client, () => voting().set('s1:amy', { ...ballot('amy', ['a']), userName: 'Amy Pond', userColor: '#f00' }), 'amy', shared);
  expect(layer.getMap('voting').get('s1:amy')).toEqual({ sessionId: 's1', userId: 'amy', elementIds: ['a'], anonymous: true });
});
