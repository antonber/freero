import { afterEach, describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { applyExact } from '../editor/exact';
import { localToWorld } from '../geometry/geometry';
import { boxDef, bundle, makeCore } from './harness';

// A picture-like type: resize handles keep its aspect ratio.
const photoDef = { ...boxDef, type: 'image', resize: 'aspect', textField: undefined } as unknown as ElementDefinition<any>;

let core: EngineCore;
afterEach(() => core?.destroy());

describe('typed size and position', () => {
  it('W = 200 resizes every selected item in one undo step: locked ones stay, a picture keeps its aspect ratio', () => {
    core = makeCore({ bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, photoDef] })] });
    const ed = core.editor;
    const a = ed.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 100 } as never);
    const b = ed.create({ type: 'sticky', x: 300, y: 0, w: 120, h: 80 } as never);
    const locked = ed.create({ type: 'sticky', x: 600, y: 0, w: 100, h: 100, locked: true } as never);
    const photo = ed.create({ type: 'image', x: 0, y: 300, w: 100, h: 50 } as never);
    const els = () => [a, b, locked, photo].map((id) => ed.getElement(id)!);

    applyExact(ed, els(), 'w', 200);
    expect(els().map((el) => [el.w, el.h])).toEqual([
      [200, 100],
      [200, 80],
      [100, 100],
      [200, 100],
    ]);
    ed.undo();
    expect(els().map((el) => el.w)).toEqual([100, 120, 100, 100]);
  });

  it('a rotated item grows from its own top-left corner, as its resize handle would', () => {
    core = makeCore();
    const id = core.editor.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 30 } as never);
    const corner = (el: BoardElement) => localToWorld(el, { x: 0, y: 0 });
    const before = corner(core.editor.getElement(id)!);
    applyExact(core.editor, [core.editor.getElement(id)!], 'h', 160);
    const after = core.editor.getElement(id)!;
    expect(after.h).toBe(160);
    expect(corner(after).x).toBeCloseTo(before.x);
    expect(corner(after).y).toBeCloseTo(before.y);
  });
});
