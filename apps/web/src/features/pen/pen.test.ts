import { describe, expect, it } from 'vitest';
import type { PenElement } from '@freero/shared';
import { buildStroke, hitStroke, rebakeWidth, simplify, unpack, type RawPoint } from './lib/stroke';

const line = (from: { x: number; y: number }, to: { x: number; y: number }, n = 50): RawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / (n - 1), y: from.y + ((to.y - from.y) * i) / (n - 1), p: 0.5 }));

function stroke(points: RawPoint[], width = 4): PenElement {
  return {
    id: 's',
    type: 'pen',
    rotation: 0,
    z: 1,
    createdBy: 'u',
    createdAt: 0,
    updatedAt: 0,
    stroke: '#000',
    strokeWidth: width,
    highlighter: false,
    ...buildStroke(points, width, false),
  };
}

const local = (el: PenElement, world: { x: number; y: number }) => ({ x: world.x - el.x, y: world.y - el.y });

describe('pen stroke hit-testing', () => {
  it('clicking empty space inside a diagonal stroke’s bounding box does not grab the stroke', () => {
    const el = stroke(line({ x: 100, y: 100 }, { x: 300, y: 300 }));
    expect(hitStroke(el, local(el, { x: 200, y: 200 }), 4)).toBe(true);
    // Bottom-left corner of the bbox: inside the box, far from the ink.
    expect(hitStroke(el, local(el, { x: 110, y: 290 }), 4)).toBe(false);
  });

  it('a stretched stroke is hit where it is drawn now, not where it was before the resize', () => {
    const el = stroke(line({ x: 0, y: 0 }, { x: 200, y: 100 }));
    const wide = { ...el, w: el.w * 2 };
    const mid = local(el, { x: 100, y: 50 }); // middle of the line as drawn
    expect(hitStroke(wide, { x: mid.x * 2, y: mid.y }, 2)).toBe(true);
    expect(hitStroke(wide, mid, 2)).toBe(false);
  });
});

describe('stroke simplification', () => {
  it('collapses a long straight drag to its endpoints but keeps the corner of a V', () => {
    expect(simplify(line({ x: 0, y: 0 }, { x: 1000, y: 0 }, 500), 0.5)).toHaveLength(2);
    const v = [...line({ x: 0, y: 0 }, { x: 100, y: 100 }), ...line({ x: 100, y: 100 }, { x: 200, y: 0 })];
    const kept = simplify(v, 0.5);
    expect(kept.length).toBeLessThan(6);
    expect(kept.some((p) => p.x === 100 && p.y === 100)).toBe(true);
  });
});

describe('changing stroke width', () => {
  it('keeps a scaled, rotated stroke in place instead of jumping or snapping back to its original size', () => {
    const el = { ...stroke(line({ x: 0, y: 0 }, { x: 200, y: 100 })), rotation: 30 };
    const scaled = { ...el, w: el.w * 1.5, h: el.h * 1.5 };
    const next = { ...scaled, ...rebakeWidth(scaled, 8) };
    const center = (e: PenElement) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
    expect(Math.abs(center(next).x - center(scaled).x)).toBeLessThanOrEqual(1);
    expect(Math.abs(center(next).y - center(scaled).y)).toBeLessThanOrEqual(1);
    // Scale is baked into the points: the line still spans 1.5× its drawn length.
    const pts = unpack(next.points);
    expect(pts[pts.length - 1].x - pts[0].x).toBeCloseTo(300, 0);
    expect(next.w / next.baseW).toBe(1);
  });
});
