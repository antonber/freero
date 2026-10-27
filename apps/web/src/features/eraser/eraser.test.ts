import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { Point } from '@engine';
import { sweepTouches, type DistanceTo } from './lib/sweep';

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
