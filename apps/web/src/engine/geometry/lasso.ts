// Freeform (lasso) selection (#111): which items a loop drawn around them takes. Pure geometry over
// world points; the loop is closed by joining its last point to its first.
import type { BoardElement } from '@freero/shared';
import type { LassoMode, Point } from '../api';
import { elementAABB, elementCorners, localToWorld, rectsIntersect } from './geometry';
import type { DefLookup } from './spatial';

/** Even-odd rule, so a loop drawn twice around something still holds it. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do segments ab and cd cross or touch? */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

function edgesCross(poly: readonly Point[], quad: readonly Point[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    for (let k = 0; k < quad.length; k++) {
      if (segmentsIntersect(poly[j], poly[i], quad[k], quad[(k + 1) % quad.length])) return true;
    }
  }
  return false;
}

function bounds(poly: readonly Point[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Is `el` taken by the loop? 'touch': its (rotated) box overlaps the loop at all. 'inside': its box
 * lies wholly within the loop, or — given `samples` (world points standing for what is drawn,
 * a pen stroke's ink) — most of those do.
 */
export function elementInLasso(el: BoardElement, poly: readonly Point[], mode: LassoMode, samples?: readonly Point[]): boolean {
  if (poly.length < 3 || !rectsIntersect(elementAABB(el), bounds(poly))) return false;
  const quad = elementCorners(el);
  if (mode === 'touch') {
    if (quad.some((p) => pointInPolygon(p, poly))) return true;
    if (poly.some((p) => pointInPolygon(p, quad))) return true;
    return edgesCross(poly, quad);
  }
  if (samples?.length) {
    let n = 0;
    for (const p of samples) if (pointInPolygon(p, poly)) n++;
    return n * 2 > samples.length;
  }
  return quad.every((p) => pointInPolygon(p, poly)) && !edgesCross(poly, quad);
}

/** Items the loop takes, in render order (containers only when wholly inside it). */
export function elementsInLasso(ordered: readonly BoardElement[], poly: readonly Point[], mode: LassoMode, getDef: DefLookup): BoardElement[] {
  if (poly.length < 3) return [];
  return ordered.filter((el) => {
    const def = getDef(el.type);
    if (def?.container) return elementInLasso(el, poly, 'inside');
    const local = mode === 'inside' ? def?.lassoPoints?.(el) : undefined;
    return elementInLasso(el, poly, mode, local?.map((p) => localToWorld(el, p)));
  });
}
