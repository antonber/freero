// Pure geometry helpers. World units, rotation in degrees clockwise around the box center.
import type { BoardElement } from '@freero/shared';
import type { Point, Rect } from '../api';

export const EPS = 1e-6;
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function rotatePoint(p: Point, c: Point, degrees: number): Point {
  if (!degrees) return { x: p.x, y: p.y };
  const a = rad(degrees);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectUnion(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

export const rectContainsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.h <= outer.y + outer.h + EPS;

export const rectContainsPoint = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const expandRect = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

export const elementRect = (el: Pick<BoardElement, 'x' | 'y' | 'w' | 'h'>): Rect => ({ x: el.x, y: el.y, w: el.w, h: el.h });

type Boxy = Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

/** Corners nw, ne, se, sw in world space (rotation applied). */
export function elementCorners(el: Boxy): [Point, Point, Point, Point] {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const r = el.rotation || 0;
  return [
    rotatePoint({ x: el.x, y: el.y }, c, r),
    rotatePoint({ x: el.x + el.w, y: el.y }, c, r),
    rotatePoint({ x: el.x + el.w, y: el.y + el.h }, c, r),
    rotatePoint({ x: el.x, y: el.y + el.h }, c, r),
  ];
}

/** Axis-aligned bounds of a possibly rotated element. */
export function elementAABB(el: Boxy): Rect {
  if (!el.rotation || el.rotation % 360 === 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const pts = elementCorners(el);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * AABB of what an element DRAWS: its box grown by a definition's visualOutset (a frame title
 * above its top edge), rotation applied.
 */
export function visualAABB(el: Boxy, outset?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>> | null): Rect {
  if (!outset) return elementAABB(el);
  const t = outset.top ?? 0, r = outset.right ?? 0, b = outset.bottom ?? 0, l = outset.left ?? 0;
  if (!t && !r && !b && !l) return elementAABB(el);
  // Grow the box around the same center of rotation (the element's own center).
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const corners = [
    { x: el.x - l, y: el.y - t },
    { x: el.x + el.w + r, y: el.y - t },
    { x: el.x + el.w + r, y: el.y + el.h + b },
    { x: el.x - l, y: el.y + el.h + b },
  ].map((p) => rotatePoint(p, c, el.rotation || 0));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** World point → element-local unrotated coordinates relative to its top-left. */
export function worldToLocal(el: Boxy, p: Point): Point {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const q = rotatePoint(p, c, -(el.rotation || 0));
  return { x: q.x - el.x, y: q.y - el.y };
}

/** Element-local point (relative to top-left, unrotated) → world. */
export function localToWorld(el: Boxy, p: Point): Point {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  return rotatePoint({ x: el.x + p.x, y: el.y + p.y }, c, el.rotation || 0);
}

export function boundsOf(els: Boxy[]): Rect | null {
  return rectUnion(els.map(elementAABB));
}

/** Separating-axis test: does a (possibly rotated) element intersect an axis-aligned rect? */
export function elementIntersectsRect(el: Boxy, r: Rect): boolean {
  const aabb = elementAABB(el);
  if (!rectsIntersect(aabb, r)) return false;
  if (!el.rotation || el.rotation % 90 === 0) return true;
  const quad = elementCorners(el);
  const rect: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  const a = rad(el.rotation);
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(a), y: Math.sin(a) },
    { x: -Math.sin(a), y: Math.cos(a) },
  ];
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of quad) {
      const d = p.x * ax.x + p.y * ax.y;
      a0 = Math.min(a0, d); a1 = Math.max(a1, d);
    }
    for (const p of rect) {
      const d = p.x * ax.x + p.y * ax.y;
      b0 = Math.min(b0, d); b1 = Math.max(b1, d);
    }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

export function elementInsideRect(el: Boxy, r: Rect): boolean {
  return rectContainsRect(r, elementAABB(el));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Normalizes an angle to [0, 360). */
export function normAngle(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Rounds `angle` to the nearest multiple of `step`. */
export function snapAngle(angle: number, step: number): number {
  return normAngle(Math.round(angle / step) * step);
}
