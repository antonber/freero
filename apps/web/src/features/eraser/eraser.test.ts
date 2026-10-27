import { describe, expect, it } from 'vitest';
import type { PenElement } from '@freero/shared';
import { sweepTouchesStroke } from './lib/geometry';

/** A ring of radius 100 around (200, 200), drawn 4 units wide. */
function ring(): PenElement {
  const points: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    points.push(110 + Math.cos(a) * 100, 110 + Math.sin(a) * 100, 0.5);
  }
  return {
    id: 'r',
    type: 'pen',
    x: 90,
    y: 90,
    w: 220,
    h: 220,
    baseW: 220,
    baseH: 220,
    rotation: 0,
    z: 1,
    createdBy: 'u',
    createdAt: 0,
    updatedAt: 0,
    points,
    stroke: '#000',
    strokeWidth: 4,
    highlighter: false,
  };
}

/** Horizontal line from (0,0) to (200,0) in a box at (100, 100). */
function bar(rotation = 0): PenElement {
  return { ...ring(), x: 100, y: 95, w: 200, h: 10, baseW: 200, baseH: 10, rotation, points: [0, 5, 0.5, 200, 5, 0.5] };
}

describe('eraser hit-testing', () => {
  it('scrubbing inside a circle’s empty middle erases nothing; touching its ink does', () => {
    expect(sweepTouchesStroke(ring(), { x: 170, y: 200 }, { x: 230, y: 200 }, 8)).toBe(false);
    expect(sweepTouchesStroke(ring(), { x: 294, y: 200 }, { x: 294, y: 210 }, 8)).toBe(true);
  });

  it('a fast flick that jumps over a thin stroke between two pointer events still erases it', () => {
    expect(sweepTouchesStroke(bar(), { x: 200, y: 0 }, { x: 200, y: 200 }, 2)).toBe(true);
  });

  it('erases a rotated stroke where it is shown, not where it would be unrotated', () => {
    const vertical = bar(90); // centered at (200, 100): now spans y 0..200 at x = 200
    expect(sweepTouchesStroke(vertical, { x: 190, y: 30 }, { x: 210, y: 30 }, 3)).toBe(true);
    expect(sweepTouchesStroke(vertical, { x: 120, y: 90 }, { x: 120, y: 110 }, 3)).toBe(false);
  });
});
