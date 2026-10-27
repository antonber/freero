import { afterEach, describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { boxDef, bundle, drag, makeCore } from './harness';

// A toy follower: a "connector" whose x mirrors the x of the sticky named in start.elementId,
// and which forgets the sticky when it is deleted.
const followerDef: ElementDefinition<'connector'> = {
  type: 'connector',
  Component: () => null,
  resize: 'none',
  defaults: () => ({
    type: 'connector', w: 10, h: 10, start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, routing: 'straight',
    stroke: '#000', strokeWidth: 2, strokeStyle: 'solid', startCap: 'none', endCap: 'none', label: '',
  }),
  follow(el, { editor, changed, removed }) {
    const id = el.start.elementId;
    if (!id) return null;
    if (removed.has(id)) return { start: { x: el.start.x, y: el.start.y } };
    if (!changed.has(id)) return null;
    return { x: editor.getElement(id)!.x };
  },
};

let core: EngineCore;
afterEach(() => core?.destroy());

function setup() {
  core = makeCore({ bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, followerDef as ElementDefinition<any>] })] });
  const box = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
  const link = core.editor.create({ type: 'connector', x: 0, y: 500, start: { elementId: box, x: 0, y: 0 } } as never);
  core.store.undoManager.clear();
  const get = (id: string) => core.editor.getElement(id) as BoardElement & { start: { elementId?: string | null } };
  return { box, link, get };
}

describe('element followers (connector endpoints follow what they are attached to)', () => {
  it('a dependent refresh lands in the same undo step as the move that caused it', () => {
    const { box, link, get } = setup();
    drag(core, { x: 50, y: 50 }, { x: 250, y: 50 });
    expect(get(link).x).toBe(200);
    core.editor.updateMany([{ id: box, patch: { x: 400 } }]); // keyboard/command style write
    expect(get(link).x).toBe(400);
    core.editor.undo();
    expect([get(box).x, get(link).x]).toEqual([200, 200]);
    core.editor.undo();
    expect([get(box).x, get(link).x]).toEqual([0, 0]);
  });

  it('deleting the target detaches the dependent in the same step, and undo re-attaches it', () => {
    const { box, link, get } = setup();
    core.editor.remove([box]);
    expect(get(link).start.elementId).toBeUndefined();
    core.editor.undo();
    expect(get(box)).toBeDefined();
    expect(get(link).start.elementId).toBe(box);
  });

  it("a collaborator's change never makes this client rewrite dependents (no write storms)", () => {
    const { box, link, get } = setup();
    const moved = { ...get(box), x: 300 };
    core.store.doc.transact(() => core.store.elements.set(box, moved), 'remote');
    expect(get(box).x).toBe(300);
    expect(get(link).x).toBe(0);
  });
});
