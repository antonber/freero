import { describe, expect, it } from 'vitest';
import type { BoardElement, PenElement } from '@freero/shared';
import { createTestBoard, defineElement, type Point } from '@engine';
import { sweepTouches, type DistanceTo } from './lib/sweep';
import { cutStroke } from './lib/cut';
import { eraseSweep } from './lib/erase';

// Stand-in for the pen's distanceTo: ink is the horizontal centerline of the box, 2 units thick.
const toCenterline: DistanceTo = (el, p: Point) => {
  const x = Math.max(0, Math.min(el.w, p.x));
  return Math.hypot(p.x - x, p.y - el.h / 2) - 1;
};

/** A 200 × 10 box at (100, 95): ink from (100, 100) to (300, 100), optionally rotated. */
const bar = (rotation = 0) => ({ id: 'b', type: 'pen', x: 100, y: 95, w: 200, h: 10, rotation }) as BoardElement;

describe('eraser sweeps', () => {
  it('a fast flick that jumps over a thin stroke between two pointer events still erases it', () => {
    expect(sweepTouches(toCenterline, bar(), { x: 200, y: 0 }, { x: 200, y: 200 }, 2)).toBe(true);
    expect(sweepTouches(toCenterline, bar(), { x: 200, y: 0 }, { x: 200, y: 80 }, 2)).toBe(false);
  });

  it('erases a rotated stroke where it is shown, not where it would be unrotated', () => {
    const vertical = bar(90); // centered at (200, 100): now spans y 0..200 at x = 200
    expect(sweepTouches(toCenterline, vertical, { x: 190, y: 30 }, { x: 210, y: 30 }, 3)).toBe(true);
    expect(sweepTouches(toCenterline, vertical, { x: 120, y: 90 }, { x: 120, y: 110 }, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Partial erase
// ---------------------------------------------------------------------------------------------

/** A straight stroke from (0, 50) to (200, 50) in a 200 × 100 box at (x, y), points every 50. */
function line(x = 100, y = 100, extra: Partial<PenElement> = {}): PenElement {
  return {
    id: 'p', type: 'pen', x, y, w: 200, h: 100, rotation: 0, z: 3, createdBy: 'u', createdAt: 0, updatedAt: 0,
    points: [0, 50, 0.5, 50, 50, 0.5, 100, 50, 0.5, 150, 50, 0.5, 200, 50, 0.5],
    stroke: '#000', strokeWidth: 4, highlighter: false, baseW: 200, baseH: 100,
    ...extra,
  };
}

/** World positions of a stroke's first and last centerline points. */
function ends(el: Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'points' | 'baseW' | 'baseH'>): Point[] {
  const sx = el.w / el.baseW;
  const sy = el.h / el.baseH;
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const r = ((el.rotation || 0) * Math.PI) / 180;
  const world = (i: number) => {
    const lx = el.points[i] * sx - el.w / 2;
    const ly = el.points[i + 1] * sy - el.h / 2;
    return { x: c.x + lx * Math.cos(r) - ly * Math.sin(r), y: c.y + lx * Math.sin(r) + ly * Math.cos(r) };
  };
  return [world(0), world(el.points.length - 3)];
}

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.6;

describe('cutting through pen strokes', () => {
  it('a sweep across the middle leaves two pieces whose ink stays where it was drawn', () => {
    // The stroke runs (100, 150) → (300, 150); erase a vertical swipe at x = 200.
    const pieces = cutStroke(line(), { x: 200, y: 100 }, { x: 200, y: 200 }, 10)!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces.map((p) => ends({ ...p, rotation: 0 }));
    expect(near(left[0], { x: 100, y: 150 })).toBe(true);
    expect(left[1].x).toBeLessThan(190);
    expect(left[1].x).toBeGreaterThan(180);
    expect(right[0].x).toBeGreaterThan(210);
    expect(near(right[1], { x: 300, y: 150 })).toBe(true);
  });

  it('cuts a rotated, resized stroke where it is shown and keeps its pieces in place', () => {
    // Scaled ×2 horizontally and rotated 90°: centered at (300, 200), now vertical from y 0 to 400.
    const el = line(100, 150, { w: 400, rotation: 90 });
    const pieces = cutStroke(el, { x: 250, y: 200 }, { x: 350, y: 200 }, 10)!;
    expect(pieces).toHaveLength(2);
    const [top, bottom] = pieces.map((p) => ends({ ...p, rotation: 90 }));
    expect(near(top[0], { x: 300, y: 0 })).toBe(true);
    expect(near(bottom[1], { x: 300, y: 400 })).toBe(true);
  });

  it('leaves strokes the eraser misses untouched', () => {
    expect(cutStroke(line(), { x: 200, y: 0 }, { x: 200, y: 120 }, 10)).toBeNull();
  });

  it('a whole drag that cuts several strokes is one undo step that brings every stroke back', () => {
    const penDef = defineElement({
      type: 'pen',
      Component: () => null,
      resize: 'free',
      defaults: () => ({ type: 'pen', w: 1, h: 1, points: [], stroke: '#000', strokeWidth: 4, highlighter: false, baseW: 1, baseH: 1 }),
    });
    const board = createTestBoard({ users: ['ann'], features: [{ manifest: { name: 'pen', description: 'pen' }, elements: [penDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ann] = board.editors('eraser');
      const { id: _a, ...a } = line();
      const { id: _b, ...b } = line(100, 300);
      ann.createMany([a, b] as never);
      const before = ann.getElements().map((e) => e.id).sort();
      ann.beginGesture(); // the engine does this around every tool pointer-down → up
      eraseSweep(ann, { x: 180, y: 100 }, { x: 180, y: 400 }, 8, 'partial');
      eraseSweep(ann, { x: 250, y: 100 }, { x: 250, y: 400 }, 8, 'partial');
      ann.endGesture();
      expect(ann.getElements().filter((e) => e.type === 'pen')).toHaveLength(6);
      ann.undo();
      expect(ann.getElements().map((e) => e.id).sort()).toEqual(before);
    } finally {
      board.destroy();
    }
  });
});
