import { afterEach, describe, expect, it } from 'vitest';
import type { EngineCore } from '../runtime/core';
import { click, drag, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const box = (x: number, y: number, extra: Record<string, unknown> = {}) =>
  core.editor.create({ type: 'sticky', x, y, ...extra } as never);

describe('select tool', () => {
  it('a whole drag gesture undoes in exactly one step', () => {
    core = makeCore();
    const id = box(0, 0);
    core.store.undoManager.clear();
    drag(core, { x: 50, y: 50 }, { x: 350, y: 250 }, { steps: 20 });
    expect(core.editor.getElement(id)!.x).toBe(300);
    expect(core.store.undoManager.undoStack.length).toBe(1);
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ x: 0, y: 0 });
  });

  it('two consecutive drags stay two separate undo steps', () => {
    core = makeCore();
    const id = box(0, 0);
    core.store.undoManager.clear();
    drag(core, { x: 50, y: 50 }, { x: 150, y: 50 });
    drag(core, { x: 150, y: 50 }, { x: 250, y: 50 });
    core.editor.undo();
    expect(core.editor.getElement(id)!.x).toBe(100);
  });

  it('snaps a dragged element to the nearest aligned edge within the threshold', () => {
    core = makeCore();
    box(0, 0); // left edge at x=0
    const moving = box(0, 300);
    // drop the moving box so its left edge lands at x=4 (inside the 6px threshold)
    drag(core, { x: 50, y: 350 }, { x: 54, y: 450 });
    expect(core.editor.getElement(moving)!.x).toBe(0);
  });

  it('Alt disables snapping while dragging (and Alt-drag moves a duplicate)', () => {
    core = makeCore();
    box(0, 0);
    const moving = box(0, 300);
    drag(core, { x: 50, y: 350 }, { x: 54, y: 450 }, { alt: true });
    const [copy] = core.editor.getSelection();
    expect(copy).not.toBe(moving);
    expect(core.editor.getElement(copy)!.x).toBe(4); // exactly where dropped: no snap to x=0
    expect(core.editor.getElement(moving)).toMatchObject({ x: 0, y: 300 }); // original stays put
  });

  it('moving a frame moves what was created inside it, but not elements merely overlapping its edge', () => {
    core = makeCore();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 } as never);
    const child = box(50, 50); // made inside the frame: joins it, like a drop would
    const stranger = box(360, 260); // overlaps the frame's corner, center outside: not a child
    core.editor.select([frame]);
    drag(core, { x: 390, y: 20 }, { x: 490, y: 70 });
    expect(core.editor.getElement(frame)).toMatchObject({ x: 100, y: 50 });
    expect(core.editor.getElement(child)).toMatchObject({ x: 150, y: 100 });
    expect(core.editor.getElement(stranger)).toMatchObject({ x: 360, y: 260 });
  });

  it('dropping an element inside a frame makes it a child; dragging it out releases it', () => {
    core = makeCore();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 } as never);
    const id = box(600, 0);
    drag(core, { x: 650, y: 50 }, { x: 150, y: 150 });
    expect(core.editor.getElement(id)!.frameId).toBe(frame);
    drag(core, { x: 150, y: 150 }, { x: 750, y: 150 });
    expect(core.editor.getElement(id)!.frameId ?? null).toBeNull();
  });

  it('locked elements can be selected but not moved', () => {
    core = makeCore();
    const id = box(0, 0, { locked: true });
    drag(core, { x: 50, y: 50 }, { x: 250, y: 50 });
    expect(core.editor.getSelection()).toEqual([id]);
    expect(core.editor.getElement(id)!.x).toBe(0);
  });

  it('shift+corner resize keeps the aspect ratio of a free element', () => {
    core = makeCore();
    const id = box(0, 0, { w: 200, h: 100 });
    core.editor.select([id]);
    drag(core, { x: 200, y: 100 }, { x: 400, y: 120 }, { handle: 'se', shift: true });
    const el = core.editor.getElement(id)!;
    expect(el.w / el.h).toBeCloseTo(2, 5);
    expect(el.w).toBeCloseTo(400, 5);
    expect(el).toMatchObject({ x: 0, y: 0 });
  });

  it('rotation with Shift snaps to 15° steps', () => {
    core = makeCore();
    const id = box(0, 0);
    core.editor.select([id]);
    // pivot = (50,50); start straight below, end at an odd angle
    drag(core, { x: 50, y: 130 }, { x: 0, y: 115 }, { handle: 'rotate', shift: true });
    expect(core.editor.getElement(id)!.rotation % 15).toBe(0);
    expect(core.editor.getElement(id)!.rotation).not.toBe(0);
  });

  it('marquee selects partially covered elements but only fully enclosed frames', () => {
    core = makeCore();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 } as never);
    const inside = box(20, 20, { frameId: frame });
    drag(core, { x: 500, y: 500 }, { x: 60, y: 60 }); // starts on empty canvas, clips the box corner
    expect(core.editor.getSelection()).toEqual([inside]);
  });

  it('shift-click toggles an element out of the selection', () => {
    core = makeCore();
    const a = box(0, 0);
    const b = box(200, 0);
    core.editor.select([a, b]);
    click(core, { x: 250, y: 50 }, { shift: true });
    expect(core.editor.getSelection()).toEqual([a]);
  });
});
