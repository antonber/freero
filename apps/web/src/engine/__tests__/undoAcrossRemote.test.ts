// One Undo (or Redo, or Escape mid-drag) takes back exactly one of the person's own actions, whole,
// across every doc it wrote — also once a collaborator has overwritten a later action, which then
// has nothing left to take back. It must never fall through into part of an earlier action.
import { afterEach, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { REPLICA_ORIGIN } from '../store/replicas';
import { boxDef, bundle, frameDef, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const hidingFrame: ElementDefinition<'frame'> = { ...frameDef, hidesContents: (f) => !!f.hidden };
const setup = () => makeCore({ role: 'owner', bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, hidingFrame as ElementDefinition<any>] })] });

/** A collaborator's write to a shared element, arriving as a remote change. */
function collaboratorSets(id: string, patch: Partial<BoardElement> & Record<string, unknown>): void {
  const el = core.store.elements.get(id)!;
  core.store.doc.transact(() => core.store.elements.set(id, { ...el, ...patch } as BoardElement), REPLICA_ORIGIN);
}

const text = (id: string) => core.editor.getElement<BoardElement & { text?: string }>(id)?.text;

it('undo after a collaborator overwrote my last edit never deletes the sticky I dragged out of a hidden frame before it', () => {
  core = setup();
  const editor = core.editor;
  editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
  const dragged = editor.create({ type: 'sticky', x: 100, y: 100 } as never); // in the editors layer
  const other = editor.create({ type: 'sticky', x: 2000, y: 0, text: 'mine' } as never);
  core.store.clearUndo();

  editor.moveBy([{ id: dragged, dx: 900, dy: 0 }]); // one step over two docs: editors layer -> shared
  editor.update(other, { text: 'my edit' } as never);
  collaboratorSets(other, { text: 'their edit' });

  // My edit is already gone: this Undo has nothing to take back, and touches nothing else.
  editor.undo();
  expect(text(other)).toBe('their edit');
  expect(editor.layerOf(dragged)).toBe('shared');

  // The next Undo takes the drag back whole: into the hidden frame, out of the shared doc.
  editor.undo();
  expect(editor.layerOf(dragged)).toBe('editors');
  expect(editor.getElement(dragged)).toMatchObject({ x: 100 });
  expect(core.store.elements.has(dragged)).toBe(false);
});

it('redo after a collaborator overwrote what I undid last never puts back half of the drag I undid before it', () => {
  core = setup();
  const editor = core.editor;
  editor.create({ type: 'frame', x: 0, y: 0, hidden: true } as never);
  const dragged = editor.create({ type: 'sticky', x: 100, y: 100 } as never);
  const other = editor.create({ type: 'sticky', x: 2000, y: 0, text: 'mine' } as never);
  core.store.clearUndo();

  editor.update(other, { text: 'my edit' } as never);
  editor.moveBy([{ id: dragged, dx: 900, dy: 0 }]);
  editor.undo(); // the drag
  editor.undo(); // my edit
  collaboratorSets(other, { text: 'their edit' });

  editor.redo(); // my edit: overwritten, nothing to put back
  expect(text(other)).toBe('their edit');
  expect(editor.layerOf(dragged)).toBe('editors');
  expect(core.store.elements.has(dragged)).toBe(false);

  editor.redo(); // the drag, whole
  expect(editor.layerOf(dragged)).toBe('shared');
  expect(core.store.layers.editors.elements.has(dragged)).toBe(false);
});

it('cancelling a drag of a sticky a collaborator moved meanwhile keeps my edit to another sticky before it', () => {
  core = setup();
  const editor = core.editor;
  const edited = editor.create({ type: 'sticky', x: 0, y: 0, text: 'mine' } as never);
  const moved = editor.create({ type: 'sticky', x: 500, y: 0 } as never);
  core.store.clearUndo();
  editor.update(edited, { text: 'my edit' } as never);

  editor.beginGesture();
  editor.update(moved, { x: 800 });
  collaboratorSets(moved, { x: 900 });
  editor.cancelGesture(); // Escape: their move stands, nothing of mine before the drag is touched

  expect(editor.getElement(moved)!.x).toBe(900);
  expect(text(edited)).toBe('my edit');
  editor.undo();
  expect(text(edited)).toBe('mine');
});
