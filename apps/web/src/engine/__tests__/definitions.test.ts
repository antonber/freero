// @vitest-environment jsdom
// Element-definition hooks the engine honours for every feature: reads inside transactions,
// cancelled gestures, cascading deletes, hidden elements, per-type keys, font re-measuring.
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { installKeyboard } from '../interaction/keyboard';
import { fitFontSize } from '../text/autofit';
import { boxDef, bundle, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

type Node = BoardElement & { parentId?: string | null; collapsed?: boolean };

/** A toy tree: 'mindmap' nodes with parentId; children of a collapsed node are hidden. */
function treeDef(extra: Partial<ElementDefinition<'mindmap'>> = {}): ElementDefinition<'mindmap'> {
  const kids = (editor: { getElements(): BoardElement[] }, id: string) =>
    editor.getElements().filter((n) => (n as Node).parentId === id).map((n) => n.id);
  return {
    type: 'mindmap',
    Component: () => null,
    resize: 'none',
    defaults: () => ({ type: 'mindmap', w: 100, h: 40, text: '', parentId: null, rootId: '', color: '#000' }),
    removeWith: (el, editor) => kids(editor, el.id),
    hidden: (el, editor) => {
      let p = (el as Node).parentId;
      while (p) {
        const parent = editor.getElement<Node>(p);
        if (!parent) return true;
        if (parent.collapsed) return true;
        p = parent.parentId;
      }
      return false;
    },
    ...extra,
  };
}

function setup(extra: Partial<ElementDefinition<'mindmap'>> = {}) {
  core = makeCore({ bundles: [bundle('tree', { elements: [boxDef as ElementDefinition<any>, treeDef(extra) as ElementDefinition<any>] })] });
  const node = (id: string, x: number, parentId: string | null = null) =>
    core.editor.create({ type: 'mindmap', id, x, y: 0, parentId } as never);
  node('root', 0);
  node('a', 200, 'root');
  node('a1', 400, 'a');
  node('b', 200, 'root');
  core.store.undoManager.clear();
}

describe('reads inside editor.transact', () => {
  it('see writes made earlier in the same transaction (lists and single reads alike)', () => {
    core = makeCore();
    let seen: BoardElement[] = [];
    core.editor.transact(() => {
      const id = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
      expect(core.editor.getElements()).toHaveLength(1);
      core.editor.update(id, { x: 50 });
      seen = core.editor.getElements();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].x).toBe(50);
  });
});

describe('cancelGesture (Escape mid-drag)', () => {
  it('puts everything back and leaves nothing to undo, while earlier steps stay undoable', () => {
    core = makeCore();
    const id = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.editor.update(id, { x: 10 }); // an earlier, separate step
    const before = core.store.undoManager.undoStack.length;
    core.editor.beginGesture();
    core.editor.update(id, { x: 300 });
    const extra = core.editor.create({ type: 'sticky', x: 500, y: 0 } as never);
    core.editor.cancelGesture();
    expect(core.editor.getElement(id)!.x).toBe(10);
    expect(core.editor.getElement(extra)).toBeUndefined();
    expect(core.store.undoManager.undoStack.length).toBe(before);
    expect(core.editor.canRedo()).toBe(false);
    core.editor.undo();
    expect(core.editor.getElement(id)!.x).toBe(0);
  });
});

describe('removeWith (deleting a node takes its subtree along)', () => {
  it('leaves no orphans, and one undo brings the whole subtree back', () => {
    setup();
    core.editor.remove(['a']); // context menu delete / cut / Delete all end up here
    expect(core.editor.getElement('a1')).toBeUndefined();
    expect(core.editor.getElement('b')).toBeDefined();
    core.editor.undo();
    expect(['a', 'a1'].every((id) => core.editor.getElement(id))).toBe(true);
    expect(core.editor.canUndo()).toBe(false);
  });
});

describe('hidden elements (collapsed branches)', () => {
  it('cannot be clicked, marquee-selected, selected or counted in bounds', () => {
    setup();
    core.editor.update('a', { collapsed: true } as never);
    expect(core.editor.hitTest({ x: 450, y: 20 })).toBeNull();
    expect(core.editor.elementsInRect({ x: -10, y: -10, w: 1000, h: 100 }).map((e) => e.id)).not.toContain('a1');
    core.editor.select(['a1', 'b']);
    expect(core.editor.getSelection()).toEqual(['b']);
    expect(core.editor.getBounds()!.w).toBe(300); // root..a/b, not a1 at x 400..500
  });

  it('drop out of the selection when their branch collapses', () => {
    setup();
    core.editor.select(['a1']);
    core.editor.update('a', { collapsed: true } as never);
    expect(core.editor.getSelection()).toEqual([]);
  });
});

describe('per-type keys', () => {
  it('a selected type that handles Delete itself wins over the engine’s delete', () => {
    let handled = 0;
    setup({ onKeyDown: (e) => e.key === 'Delete' && ++handled > 0 });
    const off = installKeyboard(core);
    core.editor.select(['b']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    off();
    expect(handled).toBe(1);
    expect(core.editor.getElement('b')).toBeDefined();
  });
});

describe('re-measuring once web fonts load', () => {
  it('re-measures only what this client measured, writes no undo step, and never touches remote elements', () => {
    let glyph = 10; // stand-in for a font metric that changes when the web font arrives
    const sized: ElementDefinition<'sticky'> = {
      ...boxDef,
      normalize: (el) => (el.w !== el.text.length * glyph ? { w: el.text.length * glyph } : null),
    };
    core = makeCore({ bundles: [bundle('boxes', { elements: [sized as ElementDefinition<any>] })] });
    const mine = core.editor.create({ type: 'sticky', x: 0, y: 0, text: 'hello' } as never);
    // A collaborator's element, as it arrives over the network (measured on their machine).
    core.store.doc.transact(() => {
      core.store.elements.set('theirs', { ...core.editor.getElement(mine)!, id: 'theirs', text: 'hey', w: 31 });
    }, 'remote');
    const undoDepth = core.store.undoManager.undoStack.length;
    glyph = 12;
    core.editor.renormalizeMeasured();
    expect(core.editor.getElement(mine)!.w).toBe(60);
    expect(core.editor.getElement('theirs')!.w).toBe(31);
    expect(core.store.undoManager.undoStack.length).toBe(undoDepth);
  });
});

describe('auto-fit text', () => {
  it('gives neighbouring boxes with similar text the same font size', () => {
    const sizes = new Set(
      // Raw fits differ (one long word each: 11 vs 12 letters); the stickies shouldn't.
      ['Roadmapping', 'Prioritizing', 'Roadmappings'].map((t) => fitFontSize(t, 'sans', 176, 176, { max: 47 })),
    );
    expect(sizes.size).toBe(1);
  });
});
