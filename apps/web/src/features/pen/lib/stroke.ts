// Pure stroke geometry: capture, simplification, packing, rendering and distance to the ink.
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
/**
 * The highlighter responds to pressure more gently than the pen. Mouse/touch highlighter strokes
 * are captured at a constant 0.5, where thinning has no effect, so they stay even.
 */
export const HIGHLIGHTER_THINNING = 0.3;

export function strokeOptions(width: number, highlighter: boolean, last = true): StrokeOptions {
  return highlighter
    ? { size: width, thinning: HIGHLIGHTER_THINNING, smoothing: 0.5, streamline: 0.45, simulatePressure: false, last }
    : { size: width, thinning: PEN_THINNING, smoothing: 0.55, streamline: 0.35, simulatePressure: false, last };
}

/** Outline radius at pressure p (mirrors perfect-freehand's radius for linear easing). */
export function radiusAt(width: number, highlighter: boolean, p: number): number {
  const thinning = highlighter ? HIGHLIGHTER_THINNING : PEN_THINNING;
  return Math.max(0.5, width * (0.5 - thinning * (0.5 - p)));
}

/**
 * Pressure to record for a captured point. A stylus' real pressure is kept for the pen and the
 * highlighter alike; without one, the pen derives a gentle pressure from speed and the
 * highlighter stays even.
 */
export function capturePressure(
  input: { pressure: number; real: boolean },
  prev: number,
  screenDist: number,
  highlighter: boolean,
): number {
  if (input.real) return Math.max(0.05, Math.min(1, input.pressure));
  if (highlighter) return 0.5;
  return simulatedPressure(prev, screenDist);
}

/** Angle step of a Shift-constrained straight stroke. */
export const STRAIGHT_STEP_DEG = 15;

/**
 * Shift held: the end of a straight stroke from `from` towards `to`, turned to the nearest
 * multiple of `stepDeg` and keeping the pointer's distance.
 */
export function constrainAngle(from: Point, to: Point, stepDeg = STRAIGHT_STEP_DEG): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(from.x + Math.cos(a) * d), y: round(from.y + Math.sin(a) * d) };
}

/**
 * Points of a straight stroke, spaced about `spacing` apart so the outline smoothing treats it
 * like any drawn stroke (two bare points would be streamlined short of the end).
 */
export function straightStroke(from: Point, to: Point, p: number, spacing: number): RawPoint[] {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(spacing, 1e-6)));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n, p }));
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
 * Distance from `local` (element-local, unrotated, in w × h space) to the drawn ink: distance to
 * the centerline minus the outline radius there (<= 0 on the ink). The pen's `distanceTo`, so
 * the engine's hit test and the eraser share it.
 */
export function strokeDistance(el: StrokeShape, local: Point): number {
  const sx = el.w / (el.baseW || 1);
  const sy = el.h / (el.baseH || 1);
  const scale = Math.sqrt(Math.abs(sx * sy)) || 1;
  const pts = el.points;
  if (pts.length < 3) return Infinity;
  const at = (i: number): Point => ({ x: pts[i] * sx, y: pts[i + 1] * sy });
  let prev = at(0);
  let prevR = radiusAt(el.strokeWidth, el.highlighter, pts[2]) * scale;
  if (pts.length === 3) return Math.hypot(local.x - prev.x, local.y - prev.y) - prevR;
  let best = Infinity;
  for (let i = 3; i + 2 < pts.length; i += 3) {
    const cur = at(i);
    const r = radiusAt(el.strokeWidth, el.highlighter, pts[i + 2]) * scale;
    const d = Math.sqrt(segDist2(local, prev, cur)) - Math.max(prevR, r);
    if (d < best) best = d;
    prev = cur;
    prevR = r;
  }
  return best;
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
