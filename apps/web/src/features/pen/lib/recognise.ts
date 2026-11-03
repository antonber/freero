// Smart drawing (#3): what a freehand stroke was meant to be. Plain geometry, no learning, so the
// same stroke always reads the same way:
// - a straight line, or an arrow (a shaft with one or two barbs at one end, drawn in one go);
// - a closed rectangle, ellipse, triangle or diamond: the closed, convex path is compared with
//   each outline in its bounding box (and in its smallest rotated box), and the closest one wins
//   when it is close enough;
// - a scratch-out: a zig-zag of sharp reversals across an area;
// - anything else (handwriting, a signature, a doodle) is nothing: it stays ink.
// Pressure plays no part: only where the pen went.
import type { Point } from '@engine';

export type RecognisedShape = 'rect' | 'ellipse' | 'triangle' | 'diamond';

export type Recognition =
  /** A clean shape: its unrotated box and rotation (degrees clockwise about the box center). */
  | { type: 'shape'; shape: RecognisedShape; x: number; y: number; w: number; h: number; rotation: number }
  /** A straight line, with an arrowhead at `to` when it was drawn with one. */
  | { type: 'line'; from: Point; to: Point; arrow: boolean }
  /** A scratch-out over the area it covers. */
  | { type: 'scribble'; x: number; y: number; w: number; h: number };

/** Points the path is resampled to before it is measured. */
const SAMPLES = 96;
/** A line is at least this straight: chord / path length. */
const LINE_STRAIGHTNESS = 0.95;
/** …and wanders at most this far off its chord (fraction of its length). */
const LINE_DEVIATION = 0.06;
/** A line within this many degrees of horizontal, vertical or a diagonal is laid exactly on it. */
const LINE_SNAP_DEG = 4;
/** A path whose ends are this close (fraction of its size) is closed. */
const CLOSE_GAP = 0.2;
/** A closed path at most this much longer than its convex hull goes once around a convex shape. */
const HULL_SLACK = 1.25;
/** …and covers at least this much of its hull (not a figure eight or a concave doodle). */
const HULL_FILL = 0.8;
/** Thinner closed paths than this (short side / long side) are a line drawn back and forth. */
const MIN_ASPECT = 0.08;
/** The closest outline must be within this mean distance (fraction of the shape's half size). */
const FIT_LIMIT = 0.085;
/** A rotated reading must beat the upright one by this factor (diagrams are mostly upright). */
const ROTATED_PENALTY = 1.25;
/** Rotations closer to upright than this (degrees) are read upright. */
const MIN_ROTATION = 10;
/** An ellipse this close to round is a circle. */
const CIRCLE_ASPECT = 0.87;
/** A turn sharper than this (degrees) is a reversal of a scribble. */
const REVERSAL_DEG = 140;
/** Reversals that make a scribble. */
const MIN_REVERSALS = 4;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (v: Point) => Math.hypot(v.x, v.y);
const rotate = (p: Point, rad: number): Point => ({
  x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
  y: p.x * Math.sin(rad) + p.y * Math.cos(rad),
});

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(points: readonly Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pathLength(points: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

/** `n` points evenly spaced along the path (by length). */
export function resample(points: readonly Point[], n: number): Point[] {
  const total = pathLength(points);
  if (points.length < 2 || total === 0) return points.slice(0, 1);
  const step = total / (n - 1);
  const out: Point[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length && out.length < n; i++) {
    let a = points[i - 1];
    const b = points[i];
    let seg = dist(a, b);
    while (carried + seg >= step && out.length < n) {
      const t = (step - carried) / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a = p;
      seg = dist(a, b);
      carried = 0;
    }
    carried += seg;
  }
  while (out.length < n) out.push(points[points.length - 1]);
  return out;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** Ramer–Douglas–Peucker: the corners of a path, within `tolerance`. */
function corners(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (at >= 0 && best > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Convex hull (monotone chain), counter-clockwise in y-down screen terms is irrelevant here. */
function hull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function area(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}

const perimeter = (poly: readonly Point[]) => pathLength(poly) + (poly.length > 1 ? dist(poly[poly.length - 1], poly[0]) : 0);

function polygonDistance(p: Point, poly: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segmentDistance(p, poly[j], poly[i]));
  return best;
}

/** Distance from `p` to the ellipse inscribed in `b`, measured along the ray from its center. */
function ellipseDistance(p: Point, b: Box): number {
  const rx = b.w / 2 || 1e-9;
  const ry = b.h / 2 || 1e-9;
  const v = { x: p.x - (b.x + rx), y: p.y - (b.y + ry) };
  const r = Math.hypot(v.x / rx, v.y / ry);
  return r === 0 ? Math.min(rx, ry) : len(v) * Math.abs(1 - 1 / r);
}

type Orientation = 0 | 90 | 180 | 270;

/** The outline of each candidate in box `b` (a triangle points its apex the given way). */
function outline(shape: 'rect' | 'diamond' | 'triangle', b: Box, apex: Orientation = 0): Point[] {
  const { x, y, w, h } = b;
  if (shape === 'rect') return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (shape === 'diamond') return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
  switch (apex) {
    case 0:
      return [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    case 180:
      return [{ x, y }, { x: x + w, y }, { x: x + w / 2, y: y + h }];
    case 90:
      return [{ x, y }, { x: x + w, y: y + h / 2 }, { x, y: y + h }];
    case 270:
      return [{ x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h / 2 }];
  }
}

const mean = (points: readonly Point[], f: (p: Point) => number) => points.reduce((s, p) => s + f(p), 0) / points.length;

/** The biggest triangle on the hull's corners: how a three-cornered path reads, whatever its angles. */
function largestTriangle(h: readonly Point[]): Point[] | null {
  if (h.length < 3) return null;
  let best = -1;
  let tri: Point[] | null = null;
  for (let i = 0; i < h.length; i++)
    for (let j = i + 1; j < h.length; j++)
      for (let k = j + 1; k < h.length; k++) {
        const a = area([h[i], h[j], h[k]]);
        if (a > best) {
          best = a;
          tri = [h[i], h[j], h[k]];
        }
      }
  return tri;
}

/** The hull's smallest-area enclosing box angle (radians, in (-π/4, π/4]). */
function minAreaAngle(h: readonly Point[]): number {
  let bestArea = Infinity;
  let best = 0;
  for (let i = 0; i < h.length; i++) {
    const e = sub(h[(i + 1) % h.length], h[i]);
    if (!len(e)) continue;
    const a = Math.atan2(e.y, e.x);
    const b = boxOf(h.map((p) => rotate(p, -a)));
    if (b.w * b.h < bestArea - 1e-9) {
      bestArea = b.w * b.h;
      best = a;
    }
  }
  const quarter = Math.PI / 2;
  let a = ((best % quarter) + quarter) % quarter;
  if (a > quarter / 2) a -= quarter;
  return a;
}

/** Straight line? Then where it starts and ends (laid on an axis or diagonal when nearly on one). */
function asLine(pts: readonly Point[], total: number): Recognition | null {
  const from = pts[0];
  const end = pts[pts.length - 1];
  const chord = dist(from, end);
  if (chord / total < LINE_STRAIGHTNESS) return null;
  if (pts.some((p) => segmentDistance(p, from, end) > LINE_DEVIATION * chord)) return null;
  return { type: 'line', from, to: snapAngle(from, end), arrow: false };
}

function snapAngle(from: Point, to: Point): Point {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const step = Math.PI / 4;
  const snapped = Math.round(a / step) * step;
  if (Math.abs(a - snapped) > (LINE_SNAP_DEG * Math.PI) / 180) return to;
  const d = dist(from, to);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(from.x + Math.cos(snapped) * d), y: r(from.y + Math.sin(snapped) * d) };
}

/**
 * An arrow in one stroke: a straight shaft, then a short head at its far end whose barbs point
 * back along the shaft (tail → tip → barb, or tail → tip → barb → tip → barb). Drawn the other way
 * round (head first) it reads the same.
 */
function asArrow(pts: readonly Point[], size: number): Recognition | null {
  for (const path of [pts, [...pts].reverse()]) {
    // The tip is where the stroke first gets (about) furthest from where it began; the barbs come
    // back from it. A second barb drawn from the tip again may pass a hair further: not the tip.
    const tail = path[0];
    const far = Math.max(...path.map((p) => dist(p, tail)));
    let at = path.findIndex((p) => dist(p, tail) >= 0.97 * far);
    while (at + 1 < path.length && dist(path[at + 1], tail) > dist(path[at], tail)) at++;
    const tip = path[at];
    const shaft = dist(tail, tip);
    if (shaft < 0.5 * size || at === path.length - 1) continue;
    if (path.slice(0, at + 1).some((p) => segmentDistance(p, tail, tip) > LINE_DEVIATION * shaft)) continue;
    const rest = path.slice(at);
    const reach = Math.max(...rest.map((p) => dist(p, tip)));
    // Heads are small next to their shaft, but not specks (a pen flick at the end of a line).
    if (reach < 0.04 * shaft || reach > 0.45 * shaft || pathLength(rest) > 1.3 * shaft) continue;
    const head = corners(rest, 0.12 * reach);
    const back = { x: (tail.x - tip.x) / shaft, y: (tail.y - tip.y) / shaft };
    let barbs = 0;
    let ok = true;
    for (const p of head.slice(1)) {
      const v = sub(p, tip);
      const l = len(v);
      if (l < 0.4 * reach) continue; // back at the tip between two barbs
      const cos = dot(v, back) / l;
      // Pointing back along the shaft, but not straight back down it (that's a retraced line).
      if (cos < Math.cos((75 * Math.PI) / 180) || cos > Math.cos((10 * Math.PI) / 180)) {
        ok = false;
        break;
      }
      barbs++;
    }
    if (!ok || !barbs) continue;
    return { type: 'line', from: tail, to: snapAngle(tail, tip), arrow: true };
  }
  return null;
}

/** Back-and-forth zig-zag: most corners are sharp reversals and the passes span the area. */
function asScribble(pts: readonly Point[], size: number): Recognition | null {
  const c = corners(pts, 0.03 * size);
  if (c.length < MIN_REVERSALS + 2) return null;
  let reversals = 0;
  for (let i = 1; i < c.length - 1; i++) {
    const a = sub(c[i], c[i - 1]);
    const b = sub(c[i + 1], c[i]);
    const cos = dot(a, b) / (len(a) * len(b) || 1);
    if (cos < Math.cos((REVERSAL_DEG * Math.PI) / 180)) reversals++;
  }
  const interior = c.length - 2;
  if (reversals < MIN_REVERSALS || reversals < 0.6 * interior) return null;
  if (pathLength(c) / (c.length - 1) < 0.4 * size) return null;
  const b = boxOf(pts);
  return { type: 'scribble', ...b };
}

/** Cuts an overshoot off a closed path's end (and start), or null when the path is open. */
function closeLoop(pts: readonly Point[], size: number): Point[] | null {
  const n = pts.length;
  let end = n - 1;
  for (let i = Math.floor(n * 0.6); i < n; i++) if (dist(pts[i], pts[0]) < dist(pts[end], pts[0])) end = i;
  let start = 0;
  for (let j = 0; j < Math.floor(n * 0.25); j++) if (dist(pts[j], pts[end]) < dist(pts[start], pts[end])) start = j;
  if (dist(pts[start], pts[end]) > CLOSE_GAP * size) return null;
  if (end - start < n * 0.6) return null;
  return pts.slice(start, end + 1);
}

interface Candidate {
  shape: RecognisedShape;
  error: number;
  box: Box;
  /** Radians the box is turned by (clockwise). */
  angle: number;
  apex: Orientation;
}

function asShape(pts: readonly Point[], size: number): Recognition | null {
  const loop = closeLoop(pts, size);
  if (!loop) return null;
  const ring = resample([...loop, loop[0]], 64).slice(0, -1);
  const h = hull(ring);
  if (h.length < 3) return null;
  if (perimeter(ring) > HULL_SLACK * perimeter(h)) return null;
  if (area(ring) < HULL_FILL * area(h)) return null;

  const candidates: Candidate[] = [];
  const read = (angle: number, penalty: number) => {
    const local = ring.map((p) => rotate(p, -angle));
    const b = boxOf(local);
    if (Math.min(b.w, b.h) < MIN_ASPECT * Math.max(b.w, b.h)) return;
    const half = (b.w + b.h) / 4;
    const score = (f: (p: Point) => number) => (mean(local, f) / half) * penalty;
    candidates.push({ shape: 'rect', error: score((p) => polygonDistance(p, outline('rect', b))), box: b, angle, apex: 0 });
    candidates.push({ shape: 'ellipse', error: score((p) => ellipseDistance(p, b)), box: b, angle, apex: 0 });
    if (angle !== 0) return;
    candidates.push({ shape: 'diamond', error: score((p) => polygonDistance(p, outline('diamond', b))), box: b, angle, apex: 0 });
    // Three corners of any angles read as a triangle; it is drawn pointing its apex where the
    // upright template that fits best points.
    const tri = largestTriangle(hull(local));
    if (tri) {
      const apex = ([0, 90, 180, 270] as const).reduce((best, o) =>
        mean(local, (p) => polygonDistance(p, outline('triangle', b, o))) < mean(local, (p) => polygonDistance(p, outline('triangle', b, best))) ? o : best,
      );
      candidates.push({ shape: 'triangle', error: score((p) => polygonDistance(p, tri)), box: b, angle, apex });
    }
  };
  read(0, 1);
  const turned = minAreaAngle(h);
  if (Math.abs(turned) > (MIN_ROTATION * Math.PI) / 180) read(turned, ROTATED_PENALTY);
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.error < a.error ? b : a));
  if (best.error > FIT_LIMIT) return null;
  return place(best);
}

/** The shape element's box for a reading: unrotated, about the same center. */
function place(c: Candidate): Recognition {
  let { w, h } = c.box;
  const center = rotate({ x: c.box.x + w / 2, y: c.box.y + h / 2 }, c.angle);
  let rotation = (c.angle * 180) / Math.PI;
  if (c.shape === 'ellipse' && Math.min(w, h) >= CIRCLE_ASPECT * Math.max(w, h)) {
    // A circle: round, and upright (turning it changes nothing).
    w = h = (w + h) / 2;
    rotation = 0;
  }
  if (c.shape === 'triangle') {
    rotation = c.apex;
    // The template points up; turned a quarter, its width runs along the drawn box's height.
    if (c.apex === 90 || c.apex === 270) [w, h] = [h, w];
  }
  const r = (n: number) => Math.round(n);
  return {
    type: 'shape',
    shape: c.shape,
    x: r(center.x - w / 2),
    y: r(center.y - h / 2),
    w: Math.max(1, r(w)),
    h: Math.max(1, r(h)),
    rotation: Math.round(rotation * 10) / 10,
  };
}

/**
 * What `points` (world units, in drawing order) were meant to be, or null to keep them as ink.
 * Strokes smaller than `minSize` (world units) are left alone: a dot or a tick is ink.
 */
export function recognise(points: readonly Point[], minSize = 0): Recognition | null {
  const raw = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (raw.length < 2) return null;
  const b = boxOf(raw);
  const size = Math.hypot(b.w, b.h);
  if (size < Math.max(minSize, 1e-6)) return null;
  const total = pathLength(raw);
  const pts = resample(raw, SAMPLES);
  return asLine(pts, total) ?? asScribble(pts, size) ?? asArrow(pts, size) ?? asShape(pts, size);
}
