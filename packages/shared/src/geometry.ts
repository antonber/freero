// Plain geometry shared by the web engine and the server (placement of inserted content).

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Axis-aligned bounds of a box rotated by `rotation` degrees around its center. */
export function rotatedBounds(el: Rect & { rotation?: number }): Rect {
  const r = el.rotation ?? 0;
  if (!r || r % 360 === 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const a = (r * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = el.w * cos + el.h * sin;
  const h = el.w * sin + el.h * cos;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Smallest rect containing all `rects` (null for none). */
export function unionRects(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

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
  const near_ = obstacles.filter((o) => rectsOverlap(o, area));
  const free = (x: number, y: number) => {
    const r = { x: x - gap, y: y - gap, w: w + 2 * gap, h: h + 2 * gap };
    return !near_.some((o) => rectsOverlap(r, o));
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
