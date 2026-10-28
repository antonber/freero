// Suggestions on the client (KAI-169): accepting a proposal is ONE undo step of the acceptor that
// also brings the suggestions back when undone; a suggestion whose item changed since is never
// applied without the reviewer saying so; two people accepting at once make one item, not two.
import { afterEach, expect, it } from 'vitest';
import type { BoardElement, SuggestionRecord } from '@freero/shared';
import { createTestBoard, type TestBoard } from '../testing';
import type { EngineCore } from '../runtime/core';
import { REPLICA_ORIGIN } from '../store/replicas';
import { boxDef, bundle, makeCore } from './harness';
import type { ElementDefinition } from '../api';

let core: EngineCore | null = null;
let board: TestBoard | null = null;
afterEach(() => {
  core?.destroy();
  board?.destroy();
  core = board = null;
});

const author = { kind: 'app' as const, name: 'Planner bot', userId: 'agent-owner', userName: 'Maria', credentialId: 'tok1' };
const base = { groupId: 'g1', author, description: 'Ideas for the retro', createdAt: 1 };
const sticky = (id: string, x: number, text: string): BoardElement =>
  ({ id, type: 'sticky', x, y: 0, w: 100, h: 100, rotation: 0, z: 0, createdBy: 'agent-owner', createdAt: 1, updatedAt: 1, text, color: 'yellow' }) as unknown as BoardElement;
const create = (id: string, el: BoardElement, groupId = 'g1'): SuggestionRecord => ({ id, ...base, groupId, op: 'create', element: el });

/** What the server does: records arrive in the editors layer as a remote change. */
function propose(c: EngineCore, records: SuggestionRecord[]) {
  const map = c.store.suggestionsMap();
  c.store.layers.editors.doc.transact(() => records.forEach((r) => map.set(r.id, structuredClone(r))), REPLICA_ORIGIN);
}

it('accepting a proposal of several stickies is one undo step for the acceptor; undo takes them off the board and makes them pending again', () => {
  core = makeCore();
  const editor = core.editor;
  propose(core, [create('s1', sticky('a', 0, 'One')), create('s2', sticky('b', 200, 'Two')), create('s3', sticky('c', 400, 'Three'))]);
  expect(editor.getElements()).toHaveLength(0); // proposed, not on the board

  const r = editor.acceptSuggestions(['s1', 's2', 's3']);
  expect(r.accepted.sort()).toEqual(['s1', 's2', 's3']);
  const els = editor.getElements();
  expect(els.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']); // the ids the proposer was told
  expect(els.every((e) => e.createdBy === 'u1' && e.suggestedBy?.name === 'Planner bot')).toBe(true);
  expect(editor.getSuggestions()).toHaveLength(0);

  editor.undo();
  expect(editor.getElements()).toHaveLength(0);
  expect(editor.getSuggestions().map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  editor.redo();
  expect(editor.getElements()).toHaveLength(3);
});

it('a rewrite of a sticky someone edited since is refused unless the reviewer forces it, and accepting a line brings the stickies it joins', () => {
  core = makeCore({ role: 'owner', bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>] })] });
  const editor = core.editor;
  const id = editor.create({ type: 'sticky', x: 0, y: 0, text: 'Old' } as never);
  propose(core, [{ id: 'u', ...base, op: 'update', targetId: id, patch: { text: 'Proposed' }, base: { text: 'Old' } }]);
  expect(editor.getSuggestions()[0].state).toBe('ready');

  editor.update(id, { text: 'Edited by Bob' } as never); // after it was proposed
  expect(editor.getSuggestions()[0].state).toBe('changed');
  expect(editor.acceptSuggestions(['u'])).toEqual({ accepted: [], stale: ['u'] });
  expect((editor.getElement(id) as unknown as { text: string }).text).toBe('Edited by Bob');
  editor.acceptSuggestions(['u'], { force: true });
  expect((editor.getElement(id) as unknown as { text: string }).text).toBe('Proposed');

  // A line between two proposed stickies can't land alone: they come along.
  const line = { id: 'l', type: 'connector', x: 0, y: 0, w: 1, h: 1, rotation: 0, z: 0, createdBy: '', createdAt: 1, updatedAt: 1, start: { elementId: 'p', x: 0, y: 0 }, end: { elementId: 'q', x: 0, y: 0 } };
  propose(core, [create('sp', sticky('p', 500, 'P'), 'g2'), create('sq', sticky('q', 700, 'Q'), 'g2'), create('sl', line as unknown as BoardElement, 'g2')]);
  expect(editor.acceptSuggestions(['sl']).accepted.sort()).toEqual(['sl', 'sp', 'sq']);
  expect(['p', 'q', 'l'].every((x) => editor.getElement(x))).toBe(true);
});

it('two editors accepting the same new sticky at the same moment end up with one sticky', () => {
  board = createTestBoard({ users: ['ann', 'bob'], features: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>] })] });
  board.propose([create('s1', sticky('a', 0, 'Only once'))]);
  const [ann, bob] = board.editors();
  ann.acceptSuggestions(['s1']);
  bob.acceptSuggestions(['s1']); // concurrent: neither has seen the other's accept
  board.sync();
  for (const e of [ann, bob]) {
    expect(e.getElements().filter((el) => el.type === 'sticky')).toHaveLength(1);
    expect(e.getSuggestions()).toHaveLength(0);
  }
});
