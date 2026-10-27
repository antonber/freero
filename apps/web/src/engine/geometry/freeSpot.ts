// Where to insert new content without covering what's already there. Pure; unit-tested.
import type { Point, Rect } from '../api';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Top-left of a `size` box that stays `gap` clear of every obstacle, as close as possible to
 * having its center on `near`. Candidates sit on a grid of half-box steps around `near`, tried
 * nearest first — those fully inside `prefer` (the visible area) before any other; beyond that
 * range it goes just right of everything (always free).
 */
export function findFreeSpot(obstacles: Rect[], size: { w: number; h: number }, near: Point, gap: number, prefer?: Rect, range = 24): Point {
  const w = Math.max(1, size.w);
  const h = Math.max(1, size.h);
  const x0 = near.x - w / 2;
  const y0 = near.y - h / 2;
  const sx = Math.max(16, (w + gap) / 2);
  const sy = Math.max(16, (h + gap) / 2);
  // Only obstacles that can touch the search area matter.
  const area = { x: x0 - range * sx - gap, y: y0 - range * sy - gap, w: w + 2 * (range * sx + gap), h: h + 2 * (range * sy + gap) };
  const near_ = obstacles.filter((o) => overlaps(o, area));
  const free = (x: number, y: number) => {
    const r = { x: x - gap, y: y - gap, w: w + 2 * gap, h: h + 2 * gap };
    return !near_.some((o) => overlaps(r, o));
  };
  if (free(x0, y0)) return { x: Math.round(x0), y: Math.round(y0) };
  const outside = (x: number, y: number) =>
    prefer && (x < prefer.x || y < prefer.y || x + w > prefer.x + prefer.w || y + h > prefer.y + prefer.h) ? 1 : 0;
  const candidates: Array<{ i: number; j: number; d: number; out: number }> = [];
  for (let i = -range; i <= range; i++)
    for (let j = -range; j <= range; j++)
      candidates.push({ i, j, d: (i * sx) ** 2 + (j * sy) ** 2, out: outside(x0 + i * sx, y0 + j * sy) });
  candidates.sort((a, b) => a.out - b.out || a.d - b.d);
  for (const { i, j } of candidates) {
    const x = x0 + i * sx;
    const y = y0 + j * sy;
    if (free(x, y)) return { x: Math.round(x), y: Math.round(y) };
  }
  const right = Math.max(...obstacles.map((o) => o.x + o.w));
  return { x: Math.ceil(right + gap), y: Math.round(y0) };
}
