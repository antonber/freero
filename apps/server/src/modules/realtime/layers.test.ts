import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { ANONYMOUS_AUTHOR } from '@freero/shared';
import { applyLayerOp, privateLayerOf } from './layers';

function layer(entries: Record<string, unknown>, collection = 'voting'): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap(collection);
  for (const [k, v] of Object.entries(entries)) map.set(k, v);
  return doc;
}

it("revealing a vote moves every voter's sealed ballot of that session into the shared doc in one update, and nothing else", () => {
  const main = new Y.Doc();
  const layers = new Map<string, Y.Doc>([
    ['u:ana', layer({ 's1:ana': { elementIds: ['a'] }, 's0:ana': { elementIds: ['old'] } })],
    ['u:ben', layer({ 's1:ben': { elementIds: ['b', 'b'] } })],
    // Hidden frames' contents are never revealed by a private-layer op.
    ['editors', layer({ 's1:eve': { elementIds: ['x'] } })],
  ]);
  let updates = 0;
  main.on('update', () => updates++);

  applyLayerOp({ type: 'reveal', collection: 'voting', prefix: 's1:' }, main, layers, 'server');

  expect(main.getMap('voting').toJSON()).toEqual({ 's1:ana': { elementIds: ['a'] }, 's1:ben': { elementIds: ['b', 'b'] } });
  expect(updates).toBe(1); // nobody ever sees half of the ballots
  expect(layers.get('u:ana')!.getMap('voting').toJSON()).toEqual({ 's0:ana': { elementIds: ['old'] } });
  expect(layers.get('u:ben')!.getMap('voting').size).toBe(0);
  expect(layers.get('editors')!.getMap('voting').size).toBe(1);
});

it('an anonymous reveal sends the other members nothing that says who wrote a draft: no id, name, app, time, nor the author’s comments on it (#44)', () => {
  const main = new Y.Doc();
  const ana = new Y.Doc();
  const els = ana.getMap('elements');
  // Written before the facilitator made the session anonymous: Ana's, through an app.
  els.set('d1', { id: 'd1', type: 'sticky', text: 'ship it', createdBy: 'user-ana-7Qx', createdVia: { kind: 'oauth', id: 'app1', name: 'Claude' }, createdAt: 1111, updatedAt: 2222 });
  // Written while it was anonymous (stamped by the server), with a note to self pinned to it.
  els.set('d2', { id: 'd2', type: 'sticky', text: 'too many meetings', createdBy: ANONYMOUS_AUTHOR, createdAt: 3333, updatedAt: 4444 });
  const comments = ana.getMap('comments');
  comments.set('t:th1', { kind: 'thread', id: 'th1', x: 0, y: 0, elementId: 'd2', createdAt: 3400, createdBy: 'user-ana-7Qx' });
  comments.set('m:th1:m1', { kind: 'message', threadId: 'th1', id: 'm1', authorId: 'user-ana-7Qx', authorName: 'Ana Lima', text: 'ask Ben first', createdAt: 3400 });
  const sent: Uint8Array[] = [];
  main.on('update', (u: Uint8Array) => sent.push(u));

  applyLayerOp({ type: 'reveal', collection: 'elements', anonymous: true }, main, new Map([[privateLayerOf('user-ana-7Qx'), ana]]), 'server', 5000);

  // What every other member's socket receives, byte for byte.
  const bytes = Buffer.concat(sent);
  for (const secret of ['user-ana-7Qx', 'Ana Lima', 'Claude', 'ask Ben first']) expect(bytes.includes(Buffer.from(secret)), secret).toBe(false);
  const got = new Y.Doc();
  for (const u of sent) Y.applyUpdate(got, u);
  expect(got.getMap('elements').toJSON()).toEqual({
    d1: { id: 'd1', type: 'sticky', text: 'ship it', createdBy: ANONYMOUS_AUTHOR, createdAt: 5000, updatedAt: 5000 },
    d2: { id: 'd2', type: 'sticky', text: 'too many meetings', createdBy: ANONYMOUS_AUTHOR, createdAt: 5000, updatedAt: 5000 },
  });
  // The thread goes with the draft, not left in Ana's layer for the next load to move into the board.
  expect(comments.size).toBe(0);
});
