// Element content (KAI-230): a table's cells (and other ELEMENT_CONTENT_COLLECTIONS) live in the
// same doc as the table, so a table in a hidden frame or a private draft never sends its text to a
// socket that may not read the table — whoever writes or moves it: a request, a reveal, a socket
// whose client had not seen the move yet, or a board saved before the rule.
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { tableCellKey, type BoardElement, type ElementDraft } from '@freero/shared';
import { guardContentPlacement, placeElementContent, writeElementContent } from './elementContent';
import { applyLayerOp, EDITORS_LAYER, privateLayerOf } from './layers';
import { applyChange, viewOf } from './view';

const owner = { userId: 'owner', role: 'owner' as const };
const viewer = { userId: 'viewer', role: 'viewer' as const };
const cell = (tableId: string) => tableCellKey('t', tableId, 'r1', 'c1');

const base = { rotation: 0, z: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1 };
const frame = (id: string, hidden: boolean) => ({ id, type: 'frame', x: 0, y: 0, w: 800, h: 600, title: 'F', fill: '#fff', index: 0, hidden, ...base }) as unknown as BoardElement;
const table = (id: string, frameId: string | null) =>
  ({ id, type: 'table', x: 100, y: 100, w: 200, h: 80, frameId, rows: [{ id: 'r1', h: 40 }], cols: [{ id: 'c1', w: 200 }], header: false, fontSize: 14, ...base }) as unknown as BoardElement;

function board() {
  const main = new Y.Doc();
  const editors = new Y.Doc();
  const layers = new Map([[EDITORS_LAYER, editors]]);
  return { main, editors, layers };
}

/** Every update the shared doc emits, i.e. what the server relays to every socket, viewers included. */
function relayed(doc: Y.Doc): Uint8Array[] {
  const out: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => out.push(u));
  return out;
}
const mentions = (updates: Uint8Array[], text: string) => updates.some((u) => Buffer.from(u).includes(Buffer.from(text)));

it('a table a request puts in a hidden frame keeps its cells out of the shared doc until the frame is shown', () => {
  const { main, editors, layers } = board();
  main.getMap('elements').set('f', frame('f', true));
  const sent = relayed(main);
  applyChange(main, layers, { create: [table('t1', 'f') as unknown as ElementDraft], collections: { tableCells: { [cell('t1')]: 'salary bands' } } }, owner, 'req');
  expect(mentions(sent, 'salary bands')).toBe(false);
  expect(editors.getMap('tableCells').get(cell('t1'))).toBe('salary bands');
  expect(viewOf(main, layers, viewer).collection('tableCells').has(cell('t1'))).toBe(false);
  expect(viewOf(main, layers, owner).collection('tableCells').get(cell('t1'))).toBe('salary bands');

  applyChange(main, layers, { update: [{ id: 'f', patch: { hidden: false } }] }, owner, 'req');
  expect(main.getMap('tableCells').get(cell('t1'))).toBe('salary bands');
  expect(editors.getMap('tableCells').has(cell('t1'))).toBe(false);
});

it("revealing a private table brings its cells into the shared doc with it; discarding drafts drops their cells; cells alone can't be revealed", () => {
  const main = new Y.Doc();
  const mine = new Y.Doc();
  const layers = new Map([[privateLayerOf('owner'), mine]]);
  mine.getMap('elements').set('t1', table('t1', null));
  mine.getMap('tableCells').set(cell('t1'), 'my idea');
  mine.getMap('elements').set('t2', table('t2', null));
  mine.getMap('tableCells').set(cell('t2'), 'second thought');

  expect(applyLayerOp({ type: 'reveal', collection: 'tableCells' }, main, layers, 'srv')).toBe(0);
  expect(main.getMap('tableCells').size).toBe(0);

  applyLayerOp({ type: 'reveal', collection: 'elements', prefix: 't1' }, main, layers, 'srv');
  expect(main.getMap('tableCells').get(cell('t1'))).toBe('my idea');
  expect(mine.getMap('tableCells').has(cell('t1'))).toBe(false);

  applyLayerOp({ type: 'discard', collection: 'elements' }, main, layers, 'srv');
  expect(mine.getMap('tableCells').size).toBe(0);
  expect(main.getMap('tableCells').has(cell('t2'))).toBe(false);
});

it("a cell a socket writes into the shared doc for a hidden table is moved to the editors layer before anyone receives it", () => {
  const { main, editors } = board();
  editors.getMap('elements').set('t1', table('t1', 'f'));
  main.getMap('tableCells'); // the room creates it up front
  // The writer's client still had the table as shared content.
  const client = new Y.Doc();
  client.getMap('tableCells').set(cell('t1'), 'typed meanwhile');
  const sent = relayed(main);
  let moved = 0;
  main.transact((tr) => {
    Y.applyUpdate(main, Y.encodeStateAsUpdate(client));
    moved = guardContentPlacement(tr, main, { editors, own: undefined }, 'srv');
  }, 'socket');
  expect(moved).toBe(1);
  expect(mentions(sent, 'typed meanwhile')).toBe(false);
  expect(main.getMap('tableCells').has(cell('t1'))).toBe(false);
  expect(editors.getMap('tableCells').get(cell('t1'))).toBe('typed meanwhile');
});

it('a board saved with a hidden table\'s cells in the shared doc is fixed when it loads, and loading again changes nothing', () => {
  const { main, editors, layers } = board();
  main.getMap('elements').set('f', frame('f', true));
  editors.getMap('elements').set('t1', table('t1', 'f'));
  main.getMap('tableCells').set(cell('t1'), 'from before the rule');
  main.getMap('presenterNotes').set('gone', { text: 'orphan', by: 'owner', at: 1 }); // its frame is gone: stays

  expect(placeElementContent(main, layers, 'srv')).toBe(1);
  expect(main.getMap('tableCells').size).toBe(0);
  expect(editors.getMap('tableCells').get(cell('t1'))).toBe('from before the rule');
  expect(main.getMap('presenterNotes').has('gone')).toBe(true);
  expect(placeElementContent(main, layers, 'srv')).toBe(0);
});

it("a live activity's results in a hidden frame are published to owners and editors only", () => {
  const { main, editors, layers } = board();
  editors.getMap('elements').set('a1', { id: 'a1', type: 'activity', x: 0, y: 0, w: 300, h: 200, frameId: 'f', ...base } as unknown as BoardElement);
  const sent = relayed(main);
  writeElementContent(main, layers, 'engageResults', { a1: { activityId: 'a1', respondents: 3, sealed: false, updatedAt: 1, words: [{ word: 'reorg', count: 3 }] } }, 'srv');
  expect(mentions(sent, 'reorg')).toBe(false);
  expect(editors.getMap('engageResults').has('a1')).toBe(true);
});
