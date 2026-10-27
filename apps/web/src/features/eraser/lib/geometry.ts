// Does an eraser sweep (a segment with a radius) touch a pen stroke? Real segment-to-segment
// distances against the stroke's centerline, in the stroke's local (unrotated, scaled) space.
import type { PenElement } from '@freero/shared';
import type { Point } from '@engine';

type Stroke = Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'points' | 'strokeWidth' | 'highlighter' | 'baseW' | 'baseH'>;

/** Matches the pen's rendering: perfect-freehand outline radius with the pen's thinning. */
function outlineRadius(el: Stroke, p: number): number {
  const thinning = el.highlighter ? 0 : 0.5;
  return Math.max(0.5, el.strokeWidth * (0.5 - thinning * (0.5 - p)));
}

/** World point → element-local unrotated coordinates (origin at the box's top-left). */
export function toLocal(el: Stroke, p: Point): Point {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const a = (-(el.rotation || 0) * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a) + el.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + el.h / 2 };
}

function pointSegDist2(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Squared minimum distance between segments ab and cd (0 when they cross). */
export function segSegDist2(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist2(a, c, d), pointSegDist2(b, c, d), pointSegDist2(c, a, b), pointSegDist2(d, a, b));
}

/**
 * True when the eraser moving from `from` to `to` (world) with `radius` (world units) touches
 * the drawn ink of `el`.
 */
export function sweepTouchesStroke(el: Stroke, from: Point, to: Point, radius: number): boolean {
  const pts = el.points;
  if (pts.length < 3) return false;
  const sx = el.w / (el.baseW || 1);
  const sy = el.h / (el.baseH || 1);
  const scale = Math.sqrt(Math.abs(sx * sy)) || 1;
  const a = toLocal(el, from);
  const b = toLocal(el, to);
  const at = (i: number): Point => ({ x: pts[i] * sx, y: pts[i + 1] * sy });
  let prev = at(0);
  let prevR = outlineRadius(el, pts[2]) * scale;
  if (pts.length === 3) return pointSegDist2(prev, a, b) <= (prevR + radius) ** 2;
  for (let i = 3; i + 2 < pts.length; i += 3) {
    const cur = at(i);
    const r = outlineRadius(el, pts[i + 2]) * scale;
    const lim = Math.max(prevR, r) + radius;
    if (segSegDist2(a, b, prev, cur) <= lim * lim) return true;
    prev = cur;
    prevR = r;
  }
  return false;
}
