import { afterEach, describe, expect, it } from 'vitest';
import { snapMove } from '../geometry/snap';
import { toolGhostAt } from '../interaction/toolDispatch';
import type { ElementDefinition, ToolDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { boxDef, bundle, click, drag, makeCore } from './harness';

describe('equal-spacing snapping', () => {
  // A row: [0..100] gap 40 [140..240]. The moving box is 100 wide, in the same row.
  const row = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 140, y: 0, w: 100, h: 100 },
  ];

  it('snaps a box dragged after a row so its gap repeats the row’s gap, and marks both gaps', () => {
    const r = snapMove({ x: 283, y: 20, w: 100, h: 60 }, row, 6); // gap 43 → 40
    expect(r.dx).toBe(-3);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps.map((g) => [g.from, g.to]).sort((a, b) => a[0] - b[0])).toEqual([
      [100, 140],
      [240, 280],
    ]);
  });

  it('centers a box dropped between two neighbours (equal gaps both sides)', () => {
    const wide = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 400, y: 0, w: 100, h: 100 },
    ];
    const r = snapMove({ x: 197, y: 0, w: 50, h: 100 }, wide, 6); // centered would be x=225
    expect(r.dx).toBe(0); // 28 away: out of reach, nothing invented
    const near = snapMove({ x: 222, y: 30, w: 50, h: 40 }, wide, 6);
    expect(near.dx).toBe(3);
    expect(near.gaps.map((g) => g.to - g.from)).toEqual([125, 125]);
  });

  it('ignores boxes outside the dragged box’s row', () => {
    const r = snapMove({ x: 283, y: 300, w: 100, h: 60 }, row, 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toEqual([]);
  });

  it('with a grid, puts the box’s corner on the grid instead of on a nearby edge', () => {
    const r = snapMove({ x: 98, y: 37, w: 50, h: 50 }, [{ x: 101, y: 500, w: 10, h: 10 }], 6, { grid: 24 });
    expect([98 + r.dx, 37 + r.dy]).toEqual([96, 48]);
  });
});

describe('grid snapping while dragging', () => {
  let core: EngineCore;
  afterEach(() => core?.destroy());

  it('follows the board setting, and Ctrl/⌘ held during the drag inverts it', () => {
    core = makeCore();
    core.editor.updateSettings({ snapToGrid: true, gridSize: 20 });
    const id = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    drag(core, { x: 50, y: 50 }, { x: 57, y: 83 });
    expect(core.editor.getElement(id)).toMatchObject({ x: 0, y: 40 });
    const tool = core.registry.toolsById.get('select')!.def;
    // Same drag with Ctrl/⌘ held: free placement.
    core.editor.beginGesture();
    const ev = (p: { x: number; y: number }) =>
      ({ editor: core.editor, point: p, screen: p, shiftKey: false, altKey: false, metaKey: true, button: 0, buttons: 1, pressure: 0.5, pointerType: 'mouse', target: core.editor.hitTest(p) }) as never;
    tool.onPointerDown!(ev({ x: 50, y: 90 }));
    tool.onPointerMove!(ev({ x: 53, y: 95 }));
    tool.onPointerMove!(ev({ x: 57, y: 97 }));
    tool.onPointerUp!(ev({ x: 57, y: 97 }));
    core.editor.endGesture();
    expect(core.editor.getElement(id)).toMatchObject({ x: 7, y: 47 });
  });
});

describe('grid snapping for creation tools', () => {
  let core: EngineCore;
  afterEach(() => core?.destroy());

  // A click tool placing a 100×100 sticky centered on the click, a drag tool drawing a box from
  // press to pointer, and a freehand tool (opted out) dropping one at the exact pointer.
  let drawing: string | null = null;
  const tools: ToolDefinition[] = [
    {
      id: 'place', label: 'Place', icon: () => null, order: 10, placement: 'main',
      onPointerDown: ({ editor, point }) => void editor.create({ type: 'sticky', x: point.x - 50, y: point.y - 50 } as never),
    },
    {
      id: 'draw', label: 'Draw', icon: () => null, order: 11, placement: 'main',
      onPointerDown: ({ editor, point }) => void (drawing = editor.create({ type: 'sticky', x: point.x, y: point.y, w: 1, h: 1 } as never)),
      onPointerMove: ({ editor, point }) => {
        const el = editor.getElement(drawing!)!;
        editor.update(drawing!, { w: point.x - el.x, h: point.y - el.y });
      },
    },
    {
      id: 'ink', label: 'Ink', icon: () => null, order: 12, placement: 'main', snapToGrid: false,
      onPointerDown: ({ editor, point }) => void editor.create({ type: 'sticky', x: point.x, y: point.y } as never),
    },
  ];
  const setup = () => {
    core = makeCore({ bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>], tools })] });
    core.editor.updateSettings({ snapToGrid: true, gridSize: 20 });
  };
  const last = () => core.editor.getElements().at(-1)!;

  it('new items land on the grid; freehand tools and Alt place exactly at the pointer', () => {
    setup();
    click(core, { x: 57, y: 83 }, { tool: 'place' });
    expect([last().x % 20, last().y % 20]).toEqual([0, 0]);
    drag(core, { x: 23, y: 218 }, { x: 167, y: 331 }, { tool: 'draw' });
    expect(last()).toMatchObject({ x: 20, y: 220, w: 140, h: 120 });
    click(core, { x: 57, y: 83 }, { tool: 'ink' });
    expect(last()).toMatchObject({ x: 57, y: 83 });
    click(core, { x: 57, y: 83 }, { tool: 'place', alt: true });
    expect(last()).toMatchObject({ x: 7, y: 33 });
  });

  it("a creation tool's hover ghost sits exactly where the click puts the item, with and without Alt", () => {
    setup();
    core.editor.setTool('place');
    for (const altKey of [false, true]) {
      core.pointer.setState({ world: { x: 57, y: 83 }, inside: true, mods: { metaKey: false, altKey } });
      const ghost = toolGhostAt(core, { w: 100, h: 100 });
      click(core, { x: 57, y: 83 }, { tool: 'place', alt: altKey });
      expect(ghost).toEqual({ x: last().x, y: last().y });
    }
  });
});
