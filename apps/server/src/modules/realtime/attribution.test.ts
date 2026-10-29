// Element attribution from sockets is the server's (attribution.ts, KAI-222). These drive real
// Y.Docs the way rooms.ts does: the socket's update and the guard in ONE transaction. The forged add
// over a real socket, seen by every client, is the `npm run verify` case; here the cases a real room
// rarely produces on demand: edits of existing items, and items that come back (moves, undo).
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { guardAttribution, type Attribution } from './attribution';

const via = { kind: 'oauth', id: 'app1', name: 'Claude' };

function serve(server: Y.Doc, update: Uint8Array, userId: string, known: (id: string) => Attribution | undefined = () => undefined): void {
  server.getMap('elements');
  server.transact((tr) => {
    Y.applyUpdate(server, update);
    guardAttribution(tr, server.getMap('elements'), userId, known);
  }, 'socket');
}

function updateOf(doc: Y.Doc, write: (els: Y.Map<unknown>) => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  write(doc.getMap('elements'));
  return Y.encodeStateAsUpdate(doc, before);
}

it('an editor changing an agent’s item keeps its text change but can’t take or rewrite who made it', () => {
  const server = new Y.Doc();
  server.getMap('elements').set('s1', { id: 's1', type: 'sticky', text: 'plan', createdBy: 'maria', createdVia: via, createdAt: 5 });
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));

  serve(server, updateOf(client, (els) => els.set('s1', { id: 's1', type: 'sticky', text: 'plan v2', createdBy: 'ben', createdAt: 9 })), 'ben');

  expect(server.getMap('elements').get('s1')).toEqual({ id: 's1', type: 'sticky', text: 'plan v2', createdBy: 'maria', createdVia: via, createdAt: 5 });
});

it('an item moved into a hidden frame or brought back by undo keeps its creator, but a new item claiming that creator is the sender’s', () => {
  const server = new Y.Doc();
  const client = new Y.Doc();
  // `moved` sits in another doc of the room (the shared doc, on its way into the editors layer);
  // `undone` was deleted lately. Both were Maria's, through Claude.
  const known = (id: string) => (id === 'moved' || id === 'undone' ? { createdBy: 'maria', createdVia: via } : undefined);

  serve(
    server,
    updateOf(client, (els) => {
      els.set('moved', { id: 'moved', type: 'sticky', createdBy: 'maria', createdVia: via });
      els.set('undone', { id: 'undone', type: 'sticky', createdBy: 'maria', createdVia: via });
      els.set('forged', { id: 'forged', type: 'sticky', createdBy: 'maria', createdVia: via });
    }),
    'ben',
    known,
  );

  const els = server.getMap('elements');
  expect(els.get('moved')).toMatchObject({ createdBy: 'maria', createdVia: via });
  expect(els.get('undone')).toMatchObject({ createdBy: 'maria', createdVia: via });
  expect(els.get('forged')).toEqual({ id: 'forged', type: 'sticky', createdBy: 'ben' });
});
