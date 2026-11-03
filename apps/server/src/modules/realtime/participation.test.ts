// Participants (participation.ts): what a commenter or guest taking part may write, judged inside
// the transaction that applies their update, as rooms.ts runs it: a client doc, the server's doc,
// and the compensation the client is sent back.
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { decideUpdate } from './filter';
import { guardParticipantEstimates } from './estimationRules';
import { guardSession } from './facilitation';
import { guardDrafts } from './participation';

/** A server doc seeded by `seed`, and a client that starts from it. */
function pair(seed?: (doc: Y.Doc) => void) {
  const server = new Y.Doc();
  seed?.(server);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

/** What `write` does on `client`, applied to `server` with `guard` in the same transaction; the client gets the correction. */
function serve(server: Y.Doc, client: Y.Doc, write: (doc: Y.Doc) => void, guard: (tr: Y.Transaction) => boolean) {
  const before = Y.encodeStateVector(client);
  write(client);
  const update = Y.encodeStateAsUpdate(client, before);
  const vector = Y.encodeStateVector(server);
  let fixed = false;
  for (const name of ['elements', 'estimation', 'facilitation']) server.getMap(name);
  server.transact((tr) => {
    Y.applyUpdate(server, update);
    fixed = guard(tr);
  }, 'socket');
  if (fixed) Y.applyUpdate(client, Y.encodeStateAsUpdate(server, vector));
}

const sticky = (id: string, x: number, patch: Record<string, unknown> = {}) => ({ id, type: 'sticky', x, y: 0, w: 100, h: 100, z: 1, rotation: 0, text: id, ...patch });

it("a participant's private drafts are taken only while private mode runs, of the types it makes private, inside its frame — and they can always throw a draft away", () => {
  const shared = new Y.Doc();
  const mode = (patch: Record<string, unknown>) => shared.getMap('privateMode').set('session', { active: true, startedBy: 'lead', startedByName: 'Lead', startedAt: 1, frameId: null, ...patch });
  shared.getMap('elements').set('f1', { id: 'f1', type: 'frame', x: 0, y: 0, w: 500, h: 500, z: 0, rotation: 0 });
  const { server: layer, client } = pair();
  const draft = (id: string, el: unknown) => serve(layer, client, (d) => d.getMap('elements').set(id, el), (tr) => guardDrafts(tr, layer, shared));
  const held = () => [...layer.getMap('elements').keys()].sort();

  draft('early', sticky('early', 0)); // before private mode: refused
  mode({});
  draft('n1', sticky('n1', 0));
  draft('fr', { id: 'fr', type: 'frame', x: 0, y: 0, w: 10, h: 10, z: 1, rotation: 0 }); // not something private mode makes private
  expect(held()).toEqual(['n1']);

  mode({ frameId: 'f1' });
  draft('in', sticky('in', 100));
  draft('out', sticky('out', 2000));
  expect(held()).toEqual(['in', 'n1']);

  shared.getMap('privateMode').set('session', { active: false, startedBy: 'lead', startedByName: 'Lead', startedAt: 1, frameId: null });
  serve(layer, client, (d) => d.getMap('elements').set('n1', sticky('n1', 0, { text: 'edited after the reveal' })), (tr) => guardDrafts(tr, layer, shared));
  expect((layer.getMap('elements').get('n1') as { text: string }).text).toBe('n1');
  serve(layer, client, (d) => d.getMap('elements').delete('n1'), (tr) => guardDrafts(tr, layer, shared));
  expect(held()).toEqual(['in']);
  expect(client.getMap('elements').toJSON()).toEqual(layer.getMap('elements').toJSON());
});

it('a participant picks only their own card for the item being estimated, until it is revealed, and the shared doc only learns that they picked', () => {
  const round = { id: 'r1', itemIds: ['c1', 'c2'], index: 0, deck: { kind: 'fibonacci', values: ['1', '2', '3'] }, revealed: false, startedBy: 'lead', startedByName: 'Lead', startedAt: 1 };
  const me = { roundId: 'r1', itemId: 'c1', userId: 'guest_kim', userName: 'Guest · Kim', userColor: '#123' };
  const { server: shared, client } = pair((d) => d.getMap('estimation').set('round', round));
  const { server: layer, client: mine } = pair();
  const inShared = (write: (m: Y.Map<unknown>) => void) => serve(shared, client, (d) => write(d.getMap('estimation')), (tr) => guardParticipantEstimates(tr, shared, shared, 'guest_kim'));
  const inLayer = (write: (m: Y.Map<unknown>) => void) => serve(layer, mine, (d) => write(d.getMap('estimation')), (tr) => guardParticipantEstimates(tr, layer, shared, 'guest_kim'));

  inLayer((m) => m.set('v:r1:c1:guest_kim', { ...me, value: '3' }));
  inShared((m) => m.set('v:r1:c1:guest_kim', { ...me, sealed: true }));
  inShared((m) => m.set('v:r1:c1:ben', { ...me, userId: 'ben', sealed: true })); // someone else's
  inShared((m) => m.set('v:r1:c2:guest_kim', { ...me, itemId: 'c2', sealed: true })); // not the current item
  inShared((m) => m.set('v:r1:c1:guest_kim', { ...me, value: '3' })); // the value, in the open
  inShared((m) => m.set('round', { ...round, revealed: true }));
  inLayer((m) => m.set('v:r1:c1:guest_kim', { ...me, value: '100' })); // not in the deck
  expect(shared.getMap('estimation').toJSON()).toEqual({ round, 'v:r1:c1:guest_kim': { ...me, sealed: true } });
  expect(layer.getMap('estimation').toJSON()).toEqual({ 'v:r1:c1:guest_kim': { ...me, value: '3' } });

  shared.getMap('estimation').set('round', { ...round, revealed: true });
  inLayer((m) => m.set('v:r1:c1:guest_kim', { ...me, value: '1' }));
  expect((layer.getMap('estimation').get('v:r1:c1:guest_kim') as { value: string }).value).toBe('3');
});

it('closing participation is for the owner, or for the facilitator while someone facilitates (any editor otherwise) — never a commenter', () => {
  const closed = { open: false, by: 'x', at: 1 };
  const facilitating = { by: 'fac', byName: 'Fac', startedAt: 1, locked: false, allowedTypes: null, follow: false, cursorsHidden: false };
  const attempt = (who: { userId: string; access: 'owner' | 'editor' | 'commenter' }, session: unknown) => {
    const { server, client } = pair((d) => session && d.getMap('facilitation').set('session', session));
    serve(server, client, (d) => d.getMap('facilitation').set('participation', closed), (tr) => guardSession(tr, server, who));
    return server.getMap('facilitation').has('participation');
  };
  expect(attempt({ userId: 'ed', access: 'editor' }, null)).toBe(true);
  expect(attempt({ userId: 'ed', access: 'editor' }, facilitating)).toBe(false);
  expect(attempt({ userId: 'fac', access: 'editor' }, facilitating)).toBe(true);
  expect(attempt({ userId: 'own', access: 'owner' }, facilitating)).toBe(true);
  expect(attempt({ userId: 'kim', access: 'commenter' }, null)).toBe(false);
});

it("a participant's update that reaches past comments, ballots and picks — a sticky on the shared board — is dropped whole", () => {
  const { server, client } = pair((d) => d.getMap('voting').set('session', { id: 's1' }));
  const before = Y.encodeStateVector(client);
  client.transact(() => {
    client.getMap('voting').set('s1:kim', { sessionId: 's1', userId: 'kim', elementIds: ['a'] });
    client.getMap('elements').set('n1', sticky('n1', 0));
  });
  const both = Y.encodeStateAsUpdate(client, before);
  expect(decideUpdate('commenter', server, both, 'kim', undefined, undefined, true)).toBe('drop');
  const ballotOnly = new Y.Doc();
  Y.applyUpdate(ballotOnly, Y.encodeStateAsUpdate(server));
  const sv = Y.encodeStateVector(ballotOnly);
  ballotOnly.getMap('voting').set('s1:kim', { sessionId: 's1', userId: 'kim', elementIds: ['a'] });
  const vote = Y.encodeStateAsUpdate(ballotOnly, sv);
  expect(decideUpdate('commenter', server, vote, 'kim', undefined, undefined, true)).toBe('apply');
  expect(decideUpdate('commenter', server, vote, 'kim', undefined, undefined, false)).toBe('drop');
});
