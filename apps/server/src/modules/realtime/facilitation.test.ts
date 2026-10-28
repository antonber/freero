// Facilitator limits are enforced by undoing a forbidden change inside the transaction that
// applies it (facilitation.ts). These drive real Y.Docs the way rooms.ts does: a participant's
// client, the server's doc, and a bystander that receives what the server relays.
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { FACILITATION_COLLECTION, FACILITATION_KEY, type FacilitationSession } from '@freero/shared';
import { guardSession, revertForbiddenAdds } from './facilitation';

const session = (by: string, patch: Partial<FacilitationSession> = {}): FacilitationSession => ({
  by,
  byName: by,
  startedAt: 1,
  locked: false,
  allowedTypes: ['sticky'],
  follow: false,
  cursorsHidden: false,
  ...patch,
});

/** Server side of one socket update, as rooms.ts applies it; returns what it relays. */
function serve(server: Y.Doc, update: Uint8Array, guard: (tr: Y.Transaction) => void): Uint8Array[] {
  // A room creates its maps up front (an update can't then make a placeholder type the guard misses).
  server.getMap('elements');
  server.getMap(FACILITATION_COLLECTION);
  const relayed: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => relayed.push(u);
  server.on('update', onUpdate);
  server.transact((tr) => {
    Y.applyUpdate(server, update);
    guard(tr);
  }, 'socket');
  server.off('update', onUpdate);
  return relayed;
}

function lastUpdate(doc: Y.Doc, write: () => void): Uint8Array {
  let out: Uint8Array | null = null;
  const on = (u: Uint8Array) => (out = u);
  doc.on('update', on);
  write();
  doc.off('update', on);
  return out!;
}

it('a shape added by a participant limited to stickies never reaches anyone, and their doc converges instead of diverging', () => {
  const server = new Y.Doc();
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const allowed = new Set(['sticky']);
  const guard = (tr: Y.Transaction) => revertForbiddenAdds(tr, server.getMap('elements'), allowed, () => false);

  const forged = lastUpdate(client, () => client.getMap('elements').set('s1', { id: 's1', type: 'shape' }));
  const before = Y.encodeStateVector(server);
  const relayed = serve(server, forged, guard);

  // A bystander applying what was relayed never sees the shape, not even for one update.
  const bystander = new Y.Doc();
  const seen: string[] = [];
  bystander.getMap('elements').observe((e) => e.changes.keys.forEach((_, k) => seen.push(k)));
  for (const u of relayed) Y.applyUpdate(bystander, u);
  expect(relayed).toHaveLength(1);
  expect(seen).toEqual([]);

  // The sender gets the compensation and keeps working: its next update applies on the server.
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server, before));
  expect(client.getMap('elements').has('s1')).toBe(false);
  const next = lastUpdate(client, () => client.getMap('elements').set('n1', { id: 'n1', type: 'sticky' }));
  serve(server, next, guard);
  expect(server.store.pendingStructs).toBeNull();
  expect(server.getMap('elements').has('n1')).toBe(true);
});

it('moving an existing shape between docs is not adding it, but turning a sticky into a shape is', () => {
  const server = new Y.Doc();
  server.getMap('elements').set('note', { id: 'note', type: 'sticky', text: 'keep me' });
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const allowed = new Set(['sticky']);
  const elsewhere = new Set(['moved']);
  const guard = (tr: Y.Transaction) => revertForbiddenAdds(tr, server.getMap('elements'), allowed, (id) => elsewhere.has(id));

  serve(server, lastUpdate(client, () => client.getMap('elements').set('moved', { id: 'moved', type: 'shape' })), guard);
  serve(server, lastUpdate(client, () => client.getMap('elements').set('note', { id: 'note', type: 'shape' })), guard);

  expect(server.getMap('elements').get('moved')).toMatchObject({ type: 'shape' });
  expect(server.getMap('elements').get('note')).toEqual({ id: 'note', type: 'sticky', text: 'keep me' });
});

it('a participant can neither end nor take over the facilitator\'s session, while the board owner can end it', () => {
  const server = new Y.Doc();
  server.getMap(FACILITATION_COLLECTION).set(FACILITATION_KEY, session('lead'));
  const participant = new Y.Doc();
  Y.applyUpdate(participant, Y.encodeStateAsUpdate(server));
  const fac = (d: Y.Doc) => d.getMap(FACILITATION_COLLECTION);

  const asParticipant = (tr: Y.Transaction) => guardSession(tr, server, { userId: 'p', access: 'editor' });
  serve(server, lastUpdate(participant, () => fac(participant).delete(FACILITATION_KEY)), asParticipant);
  expect(fac(server).get(FACILITATION_KEY)).toMatchObject({ by: 'lead' });
  Y.applyUpdate(participant, Y.encodeStateAsUpdate(server));
  serve(server, lastUpdate(participant, () => fac(participant).set(FACILITATION_KEY, session('p', { allowedTypes: null }))), asParticipant);
  expect(fac(server).get(FACILITATION_KEY)).toMatchObject({ by: 'lead', allowedTypes: ['sticky'] });

  const owner = new Y.Doc();
  Y.applyUpdate(owner, Y.encodeStateAsUpdate(server));
  serve(server, lastUpdate(owner, () => fac(owner).delete(FACILITATION_KEY)), (tr) => guardSession(tr, server, { userId: 'o', access: 'owner' }));
  expect(fac(server).has(FACILITATION_KEY)).toBe(false);
});
