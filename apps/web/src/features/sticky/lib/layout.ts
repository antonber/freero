// Pure placement helpers (unit-tested).
import type { Point, Rect } from '@engine';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The first slot next to `from` (right of it or below it) that doesn't overlap anything in
 * `occupied`, stepping one sticky-width at a time.
 */
export function nextFreeSlot(from: Rect, dir: 'right' | 'below', occupied: Rect[], gap: number, maxSteps = 40): Point {
  const step = dir === 'right' ? { x: from.w + gap, y: 0 } : { x: 0, y: from.h + gap };
  let candidate = { x: from.x + step.x, y: from.y + step.y, w: from.w, h: from.h };
  for (let i = 0; i < maxSteps && occupied.some((r) => overlaps(r, candidate)); i++) {
    candidate = { ...candidate, x: candidate.x + step.x, y: candidate.y + step.y };
  }
  return { x: candidate.x, y: candidate.y };
}

/** Top-left positions for `count` squares of `size` in a near-square grid centered on `center`. */
export function gridPositions(count: number, size: number, gap: number, center: Point): Point[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const totalW = cols * size + (cols - 1) * gap;
  const totalH = rows * size + (rows - 1) * gap;
  const x0 = center.x - totalW / 2;
  const y0 = center.y - totalH / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(x0 + (i % cols) * (size + gap)),
    y: Math.round(y0 + Math.floor(i / cols) * (size + gap)),
  }));
}
