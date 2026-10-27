import { afterEach, describe, expect, it } from 'vitest';
import type { EngineCore } from '../runtime/core';
import { boxDef, bundle, makeCore } from './harness';
import type { ElementDefinition } from '../api';

let core: EngineCore;
afterEach(() => core?.destroy());

const withFeatures = () =>
  makeCore({
    bundles: [
      bundle('boxes', { elements: [boxDef as ElementDefinition<any>] }),
      { ...bundle('comments'), manifest: { name: 'comments', description: 'c', owns: ['comments'] } },
    ],
  });

describe('collections single-writer guard', () => {
  it('a feature writing another feature’s collection throws the documented error', () => {
    core = withFeatures();
    expect(() => core.scoped('boxes').collection('comments').set('t1', { x: 1 })).toThrowError(
      "Collection 'comments' is owned by feature 'comments'; run one of its commands instead.",
    );
    expect(() => core.editor.collection('comments').delete('t1')).toThrow(/owned by feature 'comments'/);
  });

  it('the owner can write and every scope can read the result', () => {
    core = withFeatures();
    core.scoped('comments').collection<{ x: number }>('comments').set('t1', { x: 1 });
    expect(core.scoped('boxes').collection<{ x: number }>('comments').get('t1')).toEqual({ x: 1 });
  });

  it('startup fails when two features claim the same collection', () => {
    const claim = (name: string) => ({ ...bundle(name), manifest: { name, description: name, owns: ['votes'] } });
    expect(() => makeCore({ bundles: [claim('voting'), claim('polls')] })).toThrow(/votes/);
  });
});

describe('role-disallowed writes never reach the document', () => {
  // The server rejects them and then everything that depends on them, so they must not be sent.
  const countUpdates = (c: EngineCore) => {
    let n = 0;
    c.store.doc.on('update', () => n++);
    return () => n;
  };

  it('viewers: no element, settings or undo writes', () => {
    core = makeCore({ role: 'viewer' });
    const updates = countUpdates(core);
    core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.editor.updateSettings({ grid: 'none' });
    core.editor.undo();
    expect(updates()).toBe(0);
  });

  it('commenters: comments collection only', () => {
    core = makeCore({
      role: 'commenter',
      bundles: [
        bundle('boxes', { elements: [boxDef as ElementDefinition<any>] }),
        { ...bundle('comments'), manifest: { name: 'comments', description: 'c', owns: ['comments'] } },
      ],
    });
    const updates = countUpdates(core);
    core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.editor.paste({ x: 0, y: 0 });
    expect(updates()).toBe(0);
    core.scoped('comments').collection('comments').set('t1', { ok: true });
    expect(updates()).toBe(1);
  });

  it('a live role downgrade (server role message) blocks further writes', () => {
    core = makeCore({ role: 'editor' });
    core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.store.serverRole = 'viewer';
    const updates = countUpdates(core);
    core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    expect(updates()).toBe(0);
  });
});

describe('undo grouping', () => {
  it('an edit session started by a feature-scoped editor and ended by the engine is one step, and later changes are separate', () => {
    // Regression: scoped editors are prototype children; per-instance state used to leave the
    // gesture open forever, merging every later change into one giant undo step.
    core = makeCore();
    const id = core.scoped('boxes').create({ type: 'sticky', x: 0, y: 0 } as never);
    core.store.undoManager.clear();
    core.scoped('boxes').startEditing(id);
    core.editor.update(id, { text: 'a' } as never);
    core.editor.update(id, { text: 'ab' } as never);
    core.editor.stopEditing();
    core.editor.update(id, { x: 500 } as never);
    expect(core.store.undoManager.undoStack.length).toBe(2);
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ x: 0, text: 'ab' });
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ text: '' });
  });

  it('undo reverts only local changes, never another user’s', () => {
    core = makeCore();
    const mine = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    const theirs = { ...core.editor.getElement(mine)!, id: 'remote-1', x: 500 };
    core.store.doc.transact(() => core.store.elements.set('remote-1', theirs), 'remote');
    core.editor.undo();
    expect(core.editor.getElement(mine)).toBeUndefined();
    expect(core.editor.getElement('remote-1')).toBeDefined();
    expect(core.editor.canUndo()).toBe(false);
  });
});

describe('z-order and grouping', () => {
  it('bring to front puts the element above everything else; frames still render first', () => {
    core = makeCore({
      bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, { ...boxDef, type: 'frame', container: true } as ElementDefinition<any>] })],
    });
    const a = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    const b = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    const f = core.editor.create({ type: 'frame', x: 0, y: 0 } as never);
    core.editor.bringToFront([a]);
    expect(core.editor.getElements().map((e) => e.id)).toEqual([f, b, a]);
    expect(core.editor.hitTest({ x: 10, y: 10 })!.id).toBe(a);
  });

  it('deleting a frame deletes its children', () => {
    core = makeCore({
      bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, { ...boxDef, type: 'frame', container: true } as ElementDefinition<any>] })],
    });
    const f = core.editor.create({ type: 'frame', x: 0, y: 0 } as never);
    const child = core.editor.create({ type: 'sticky', x: 0, y: 0, frameId: f } as never);
    const other = core.editor.create({ type: 'sticky', x: 5000, y: 0 } as never);
    core.editor.remove([f]);
    expect(core.editor.getElement(child)).toBeUndefined();
    expect(core.editor.getElement(other)).toBeDefined();
  });

  it('Ctrl+D on an element inside a frame keeps the copy in that frame (it moves and exports with it)', () => {
    core = makeCore({
      bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, { ...boxDef, type: 'frame', container: true } as ElementDefinition<any>] })],
    });
    const f = core.editor.create({ type: 'frame', x: 0, y: 0, w: 1000, h: 1000 } as never);
    const child = core.editor.create({ type: 'sticky', x: 100, y: 100, frameId: f } as never);
    const [copy] = core.editor.duplicate([child]);
    expect(core.editor.getElement(copy)!.frameId).toBe(f);
  });
});

describe('discrete commands', () => {
  it('each discrete command is its own undo step even when issued in quick succession', () => {
    core = makeCore();
    const id = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.editor.select([id]);
    core.editor.update(id, { x: 10 } as never); // nudge
    core.editor.runCommand('engine.lock');
    core.editor.undo();
    expect(core.editor.getElement(id)!.x).toBe(10); // the nudge survives…
    expect(core.editor.getElement(id)!.locked).toBeFalsy(); // …only the lock was undone
  });
});
