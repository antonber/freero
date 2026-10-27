import { describe, expect, it } from 'vitest';
import { gridPositions, nextFreeSlot } from './lib/layout';

describe('Tab / Mod+Enter placement', () => {
  const from = { x: 0, y: 0, w: 200, h: 200 };

  it('places the next sticky right beside the current one when the slot is free', () => {
    expect(nextFreeSlot(from, 'right', [], 24)).toEqual({ x: 224, y: 0 });
  });

  it('skips slots that are already taken instead of stacking stickies on top of each other', () => {
    const taken = [
      { x: 224, y: 0, w: 200, h: 200 },
      { x: 448, y: 10, w: 200, h: 200 }, // slightly offset, still overlapping
    ];
    expect(nextFreeSlot(from, 'right', taken, 24)).toEqual({ x: 672, y: 0 });
    expect(nextFreeSlot(from, 'below', taken, 24)).toEqual({ x: 0, y: 224 });
  });
});

describe('pasting a text list as stickies', () => {
  it('lays the stickies out in a grid centered on the paste point without overlaps', () => {
    const pts = gridPositions(5, 200, 24, { x: 1000, y: 1000 });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs) + 200) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys) + 200) / 2;
    expect(Math.abs(cx - 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - 1000)).toBeLessThanOrEqual(1);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.abs(pts[i].x - pts[j].x) >= 200 || Math.abs(pts[i].y - pts[j].y) >= 200).toBe(true);
  });
});
