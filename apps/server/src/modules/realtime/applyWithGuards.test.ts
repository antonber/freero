import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyThenGuard } from './applyWithGuards';

it('a correction the server writes in the transaction that applies a socket’s update keeps the board’s client id (before, each one gave it a new id and its state vector one more entry)', () => {
  const board = new Y.Doc();
  const elements = board.getMap<unknown>('elements');
  board.transact(() => elements.set('a', { type: 'sticky', text: 'kept' }));
  const guest = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(board));
  const before = Y.encodeStateVector(guest);
  guest.getMap<unknown>('elements').delete('a');
  const update = Y.encodeStateAsUpdate(guest, before);

  const id = board.clientID;
  for (let i = 0; i < 3; i++)
    board.transact((tr) => {
      applyThenGuard(tr, board, update);
      if (!elements.has('a')) elements.set('a', { type: 'sticky', text: 'kept' }); // the guard puts it back
    });
  expect(elements.get('a')).toEqual({ type: 'sticky', text: 'kept' });
  expect(board.clientID).toBe(id);
});
