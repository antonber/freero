// Layer docs in the database: saves from several instances never overwrite each other, and
// compaction cleans up layers nobody should keep (KAI-79).
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { appendLayerUpdates, compactLayer, loadLayer, loadLayers } from './layerStore';

let boardId: string;
beforeAll(async () => {
  await openTestDb();
  const user = await createUser({ name: 'Layer', email: 'layer@test.freero.app', password: 'password-123' });
  boardId = (await createBoard(user.id, 'Layers', '')).id;
});
afterAll(closeTestDb);

/** One replica of a layer doc: each call returns the update of one write. */
function replica(seed?: Uint8Array | null) {
  const doc = new Y.Doc();
  if (seed) Y.applyUpdate(doc, seed);
  return (fn: (m: Y.Map<unknown>) => void) => {
    let update: Uint8Array | null = null;
    doc.on('update', (u: Uint8Array) => (update = u));
    fn(doc.getMap('elements'));
    return update!;
  };
}

const keysOf = (state: Uint8Array | null) => {
  const d = new Y.Doc();
  if (state) Y.applyUpdate(d, state);
  return [...d.getMap('elements').keys()].sort();
};

it('two instances saving the same layer at once both keep their changes, also across compaction', async () => {
  const onA = replica();
  const onB = replica();
  await Promise.all([
    appendLayerUpdates(boardId, 'editors', [onA((m) => m.set('a', 1))]),
    appendLayerUpdates(boardId, 'editors', [onB((m) => m.set('b', 2))]),
  ]);
  expect(await compactLayer(boardId, 'editors', true)).toBe('compacted');
  await appendLayerUpdates(boardId, 'editors', [onA((m) => m.set('c', 3))]);
  expect(keysOf(await loadLayer(boardId, 'editors'))).toEqual(['a', 'b', 'c']);
});

it("compaction deletes a layer that holds nothing and a removed member's layer, keeps the rest", async () => {
  const ana = replica();
  await appendLayerUpdates(boardId, 'u:ana', [ana((m) => m.set('draft', 'x'))]);
  await appendLayerUpdates(boardId, 'u:ana', [ana((m) => m.delete('draft'))]); // revealed: empty now
  const gone = replica();
  await appendLayerUpdates(boardId, 'u:gone', [gone((m) => m.set('draft', 'y'))]);
  const ben = replica();
  await appendLayerUpdates(boardId, 'u:ben', [ben((m) => m.set('draft', 'z'))]);

  expect(await compactLayer(boardId, 'u:ana', true)).toBe('deleted');
  expect(await compactLayer(boardId, 'u:gone', false)).toBe('deleted');
  expect(await compactLayer(boardId, 'u:ben', true)).toBe('compacted');
  const left = (await loadLayers(boardId)).map((l) => l.layer).sort();
  expect(left).toEqual(['editors', 'u:ben']);
});
