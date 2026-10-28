import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyLayerOp } from './layers';

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
