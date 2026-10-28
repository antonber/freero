import { afterEach, describe, expect, it } from 'vitest';
import { createTestBoard, type TestBoard } from '@engine';
import { ARRANGE_COMMANDS } from './commands';
import { planAlign, planDistribute, planTidy, type Move, type Unit } from './lib/arrange';

const unit = (id: string, x: number, y: number, w = 100, h = 100, locked = false): Unit => ({ ids: [id], box: { x, y, w, h }, locked });

/** Applies moves to units' boxes: where everything ends up. */
const after = (units: Unit[], moves: Move[]) =>
  Object.fromEntries(
    units.map((u) => {
      const m = moves.find((mv) => mv.ids[0] === u.ids[0]);
      return [u.ids[0], { x: u.box.x + (m?.dx ?? 0), y: u.box.y + (m?.dy ?? 0) }];
    }),
  );

describe('align', () => {
  it('lines unlocked items up with the selection’s edge; a locked item stays put but still sets the edge', () => {
    const units = [unit('a', 50, 0), unit('lock', 10, 300, 100, 100, true), unit('b', 200, 600, 50, 50)];
    const pos = after(units, planAlign(units, 'left'));
    expect(pos).toEqual({ a: { x: 10, y: 0 }, lock: { x: 10, y: 300 }, b: { x: 10, y: 600 } });
    const right = after(units, planAlign(units, 'right'));
    expect(right.a.x + 100).toBe(250); // the selection's right edge (b's)
  });
});

describe('distribute', () => {
  it('keeps the outermost items and evens the gaps between the others, whatever their sizes', () => {
    const units = [unit('a', 0, 0, 100), unit('c', 500, 0, 100), unit('b', 130, 0, 200)];
    const pos = after(units, planDistribute(units, 'horizontal'));
    // span 0..600, widths 400 → two gaps of 100
    expect(pos).toEqual({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, c: { x: 500, y: 0 } });
  });
});

const overlaps = (a: { x: number; y: number }, b: Unit['box'], w = 100, h = 100) =>
  a.x < b.x + b.w && a.x + w > b.x && a.y < b.y + b.h && a.y + h > b.y;

describe('locked items are fixed obstacles', () => {
  it('distribute spreads items on each side of a locked item instead of pushing one onto it', () => {
    const lock = unit('lock', 300, 0, 100, 100, true);
    const units = [unit('a', 0, 0), unit('b', 120, 0), unit('c', 420, 30), unit('d', 900, 0), lock];
    const pos = after(units, planDistribute(units, 'horizontal'));
    for (const id of ['a', 'b', 'c', 'd']) expect(overlaps(pos[id], lock.box)).toBe(false);
    expect(pos.lock).toEqual({ x: 300, y: 0 });
    // a | b | lock: one even gap; lock | c | d: another.
    expect(pos.b.x - (pos.a.x + 100)).toBeCloseTo(300 - (pos.b.x + 100));
    expect(pos.c.x - 400).toBeCloseTo(900 - (pos.c.x + 100));
  });

  it('tidy up lays the grid out around a locked item instead of stacking an item on it', () => {
    const lock = unit('lock', 230, 0, 100, 100, true);
    const units = [unit('a', 0, 0), unit('b', 600, 10), unit('c', 900, 0), lock];
    const pos = after(units, planTidy(units));
    for (const id of ['a', 'b', 'c']) expect(overlaps(pos[id], lock.box)).toBe(false);
    expect(pos.lock).toEqual({ x: 230, y: 0 });
    // Still a tidy grid: rows share a top, columns a left edge.
    expect(pos.b.y).toBe(pos.a.y);
    expect(pos.c.x).toBe(pos.a.x);
  });
});

describe('tidy up', () => {
  it('turns a rough two-column layout into an even two-column grid in reading order', () => {
    const units = [unit('a', 3, 0), unit('b', 160, 12), unit('c', 0, 170), unit('d', 140, 150), unit('e', 9, 330)];
    const pos = after(units, planTidy(units));
    const gap = pos.b.x - (pos.a.x + 100);
    expect(gap).toBeGreaterThan(0);
    expect(pos).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 100 + gap, y: 0 },
      c: { x: 0, y: 100 + gap },
      d: { x: 100 + gap, y: 100 + gap },
      e: { x: 0, y: 200 + 2 * gap },
    });
  });
});

describe('arrange commands', () => {
  let board: TestBoard;
  afterEach(() => board?.destroy());

  it('each action is its own undo step, even right after another one', () => {
    board = createTestBoard({
      users: ['ann'],
      features: [{ manifest: { name: 'arrange', description: '' }, elements: [], tools: [], formats: [], panels: [], commands: ARRANGE_COMMANDS }],
    });
    const [ed] = board.editors('arrange');
    const ids = ed.createMany([
      { type: 'sticky', x: 0, y: 0, w: 100, h: 100 },
      { type: 'sticky', x: 300, y: 80, w: 100, h: 100 },
    ] as never);
    ed.select(ids);
    ed.runCommand('arrange.alignLeft');
    ed.runCommand('arrange.alignTop');
    expect(ed.getElement(ids[1])).toMatchObject({ x: 0, y: 0 });
    ed.undo();
    expect(ed.getElement(ids[1])).toMatchObject({ x: 0, y: 80 });
  });
});
