// Pure stroke geometry: capture, simplification, packing, rendering and hit-testing.
// Points are stored flat [x0, y0, p0, x1, y1, p1, …] relative to the element's (x, y), in the
// "base" space the stroke was drawn in (baseW × baseH). Rendering and hit-testing scale that
// base space to the element's current w × h, so resizing scales the stroke.
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { PenElement } from '@freero/shared';
import type { Point } from '@engine';

export interface RawPoint {
  x: number;
  y: number;
  /** Pressure 0..1. */
  p: number;
}

type StrokeShape = Pick<PenElement, 'points' | 'strokeWidth' | 'highlighter' | 'w' | 'h' | 'baseW' | 'baseH'>;

export const PEN_THINNING = 0.5;

export function strokeOptions(width: number, highlighter: boolean, last = true): StrokeOptions {
  return highlighter
    ? { size: width, thinning: 0, smoothing: 0.5, streamline: 0.45, simulatePressure: false, last }
    : { size: width, thinning: PEN_THINNING, smoothing: 0.55, streamline: 0.35, simulatePressure: false, last };
}

/** Outline radius at pressure p (mirrors perfect-freehand's radius for linear easing). */
export function radiusAt(width: number, highlighter: boolean, p: number): number {
  const thinning = highlighter ? 0 : PEN_THINNING;
  return Math.max(0.5, width * (0.5 - thinning * (0.5 - p)));
}

/**
 * Mouse/touch have no pressure: derive a gentle one from pointer speed (fast = thinner),
 * eased so the line breathes instead of flickering. `screenDist` is in screen px so the feel
 * doesn't depend on zoom.
 */
export function simulatedPressure(prev: number, screenDist: number): number {
  const target = 0.72 - Math.min(1, screenDist / 28) * 0.36;
  return prev + (target - prev) * 0.3;
}

/** Ramer–Douglas–Peucker on x/y (pressure rides along). Keeps first and last points. */
export function simplify(points: RawPoint[], tolerance: number): RawPoint[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Packs world-space points into an element: bounding box padded by the widest outline radius,
 * points relative to it, base size = current size.
 */
export function buildStroke(
  points: RawPoint[],
  width: number,
  highlighter: boolean,
): Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'points' | 'baseW' | 'baseH'> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
    maxR = Math.max(maxR, radiusAt(width, highlighter, pt.p));
  }
  const pad = Math.ceil(maxR + 1);
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  const w = Math.ceil(maxX + pad) - x;
  const h = Math.ceil(maxY + pad) - y;
  const flat: number[] = [];
  for (const pt of points) flat.push(round1(pt.x - x), round1(pt.y - y), round2(pt.p));
  return { x, y, w, h, points: flat, baseW: w, baseH: h };
}

export function unpack(flat: readonly number[]): RawPoint[] {
  const out: RawPoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1], p: flat[i + 2] });
  return out;
}

/** SVG path of the filled outline for points in any space. */
export function strokePath(points: RawPoint[], width: number, highlighter: boolean, last = true): string {
  if (!points.length) return '';
  const outline = getStroke(
    points.map((pt) => [pt.x, pt.y, pt.p]),
    strokeOptions(width, highlighter, last),
  );
  return outlineToPath(outline);
}

/** Closed smooth path through outline points (quadratic curves through edge midpoints). */
export function outlineToPath(outline: number[][]): string {
  const n = outline.length;
  if (n < 2) return '';
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  const mid = (i: number) => {
    const a = outline[i % n];
    const b = outline[(i + 1) % n];
    return `${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  };
  let d = `M${mid(0)}`;
  for (let i = 1; i <= n; i++) d += ` Q${f(outline[i % n][0])} ${f(outline[i % n][1])} ${mid(i)}`;
  return `${d} Z`;
}

function segDist2(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

/**
 * True when `local` (element-local, unrotated, in w × h space) is on the drawn stroke: within the
 * outline radius of a centerline segment, plus `tolerance` so thin lines stay clickable.
 */
export function hitStroke(el: StrokeShape, local: Point, tolerance: number): boolean {
  const sx = el.w / (el.baseW || 1);
  const sy = el.h / (el.baseH || 1);
  const scale = Math.sqrt(Math.abs(sx * sy)) || 1;
  const pts = el.points;
  if (pts.length < 3) return false;
  const at = (i: number): Point => ({ x: pts[i] * sx, y: pts[i + 1] * sy });
  let prev = at(0);
  let prevR = radiusAt(el.strokeWidth, el.highlighter, pts[2]) * scale;
  if (pts.length === 3) return Math.hypot(local.x - prev.x, local.y - prev.y) <= prevR + tolerance;
  for (let i = 3; i + 2 < pts.length; i += 3) {
    const cur = at(i);
    const r = radiusAt(el.strokeWidth, el.highlighter, pts[i + 2]) * scale;
    const lim = Math.max(prevR, r) + tolerance;
    if (segDist2(local, prev, cur) <= lim * lim) return true;
    prev = cur;
    prevR = r;
  }
  return false;
}

/**
 * New geometry for a stroke whose width changes: bakes the current scale into the points and
 * re-pads the box for the new width. The center stays put, so rotated strokes don't jump.
 */
export function rebakeWidth(
  el: StrokeShape & Pick<PenElement, 'x' | 'y'>,
  width: number,
): Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'points' | 'baseW' | 'baseH' | 'strokeWidth'> {
  const sx = el.w / (el.baseW || 1);
  const sy = el.h / (el.baseH || 1);
  const world = unpack(el.points).map((pt) => ({ x: el.x + pt.x * sx, y: el.y + pt.y * sy, p: pt.p }));
  return { ...buildStroke(world, width, el.highlighter), strokeWidth: width };
}
