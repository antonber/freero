// Live activities' results are written only by the server (KAI-132): a socket's write to them —
// even an owner's or editor's, even into a layer a reveal could carry them out of — is undone in
// the transaction that applies it, the way rooms.ts runs the guard.
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { ENGAGE_RESULTS_COLLECTION } from '@freero/shared';
import { guardServerCollections, prepareServerCollections } from './serverCollections';

function apply(server: Y.Doc, write: (client: Y.Doc) => void): boolean {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  let update: Uint8Array | null = null;
  client.on('update', (u: Uint8Array) => (update = u));
  write(client);
  let fixed = false;
  prepareServerCollections(server);
  server.transact((tr) => {
    Y.applyUpdate(server, update!);
    fixed = guardServerCollections(tr, server);
  });
  return fixed;
}

it('an editor socket can neither forge nor erase results the server published', () => {
  const server = new Y.Doc();
  prepareServerCollections(server);
  server.getMap(ENGAGE_RESULTS_COLLECTION).set('act1', { activityId: 'act1', respondents: 3, sealed: false });

  expect(apply(server, (c) => c.getMap(ENGAGE_RESULTS_COLLECTION).set('act1', { activityId: 'act1', respondents: 99, sealed: false }))).toBe(true);
  expect(server.getMap(ENGAGE_RESULTS_COLLECTION).get('act1')).toMatchObject({ respondents: 3 });

  expect(apply(server, (c) => c.getMap(ENGAGE_RESULTS_COLLECTION).delete('act1'))).toBe(true);
  expect(server.getMap(ENGAGE_RESULTS_COLLECTION).get('act1')).toMatchObject({ respondents: 3 });

  expect(apply(server, (c) => c.getMap(ENGAGE_RESULTS_COLLECTION).set('act2', { activityId: 'act2', respondents: 5, sealed: false }))).toBe(true);
  expect(server.getMap(ENGAGE_RESULTS_COLLECTION).has('act2')).toBe(false);

  // Other collections are untouched by the guard.
  expect(apply(server, (c) => c.getMap('comments').set('t:1', { id: '1' }))).toBe(false);
  expect(server.getMap('comments').has('t:1')).toBe(true);
});
