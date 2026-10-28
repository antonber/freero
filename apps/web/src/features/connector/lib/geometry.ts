// Pure connector geometry: anchors on (rotated) elements, endpoint resolution, routing
// (straight / elbow / curved), caps, hit-testing and bounds. No React, no editor.
import type { BoardElement, CapStyle, ConnectorElement, ConnectorRouting } from '@freero/shared';
import type { Point, Rect } from '@engine';
import { routeAround } from './router';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const OPPOSITE: Record<Side, Side> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

/** Gap between an element and the first bend of an elbow route (world units). */
export const ELBOW_MARGIN = 24;
const CORNER_RADIUS = 8;
const CURVE_STEPS = 24;

type Boxy = Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

// ---------------------------------------------------------------------------------- vectors
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export function unit(a: Point): Point {
  const l = len(a);
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}
const perp = (a: Point): Point => ({ x: -a.y, y: a.x });
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

export function rotateVec(v: Point, degrees: number): Point {
  if (!degrees) return v;
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// ---------------------------------------------------------------------------------- boxes
export const centerOf = (el: Boxy): Point => ({ x: el.x + el.w / 2, y: el.y + el.h / 2 });

export function localToWorld(el: Boxy, p: Point): Point {
  const c = centerOf(el);
  return add(c, rotateVec({ x: p.x - el.w / 2, y: p.y - el.h / 2 }, el.rotation || 0));
}

export function worldToLocal(el: Boxy, p: Point): Point {
  const c = centerOf(el);
  const v = rotateVec(sub(p, c), -(el.rotation || 0));
  return { x: v.x + el.w / 2, y: v.y + el.h / 2 };
}

/** Axis-aligned bounds of a possibly rotated element. */
export function aabb(el: Boxy): Rect {
  if (!el.rotation || el.rotation % 360 === 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const pts = [
    { x: 0, y: 0 },
    { x: el.w, y: 0 },
    { x: el.w, y: el.h },
    { x: 0, y: el.h },
  ].map((p) => localToWorld(el, p));
  return boundsOfPoints(pts);
}

export function boundsOfPoints(pts: Point[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const inflate = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

// ---------------------------------------------------------------------------------- anchors
const LOCAL_NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * How an element type draws its outline, from its definition (`anchorPoint`, `outlinePoint`), in
 * element-local coordinates. undefined = the bounding box (edge midpoints, box edge).
 */
export interface Outline {
  anchor?(el: BoardElement, side: Side): Point | undefined;
  toward?(el: BoardElement, local: Point): Point | undefined;
}

export function defaultLocalAnchor(el: Boxy, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: el.w / 2, y: 0 };
    case 'bottom':
      return { x: el.w / 2, y: el.h };
    case 'left':
      return { x: 0, y: el.h / 2 };
    case 'right':
      return { x: el.w, y: el.h / 2 };
  }
}

/** World point of an element's anchor; follows the element's rotation. */
export function anchorWorld(el: BoardElement, side: Side, local?: Outline): Point {
  return localToWorld(el, local?.anchor?.(el, side) ?? defaultLocalAnchor(el, side));
}

/** Where a ray from the box center toward `local` leaves the box (element-local). */
export function boxToward(el: Boxy, local: Point): Point {
  const c = { x: el.w / 2, y: el.h / 2 };
  const d = sub(local, c);
  if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return { x: c.x, y: 0 };
  const tx = d.x ? (d.x > 0 ? el.w - c.x : -c.x) / d.x : Infinity;
  const ty = d.y ? (d.y > 0 ? el.h - c.y : -c.y) / d.y : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + d.x * t, y: c.y + d.y * t };
}

/** The box side a local point on (or near) the outline is closest to; ties go top, right, bottom, left. */
export function sideOfLocal(el: Boxy, p: Point): Side {
  const d: Record<Side, number> = { top: p.y, right: el.w - p.x, bottom: el.h - p.y, left: p.x };
  let best: Side = 'top';
  for (const s of SIDES) if (d[s] < d[best] - 1e-9) best = s;
  return best;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The point of the box's perimeter nearest a local point (inside or outside). */
function nearestOnBox(el: Boxy, p: Point): Point {
  const x = Math.max(0, Math.min(el.w, p.x));
  const y = Math.max(0, Math.min(el.h, p.y));
  const inside = p.x > 0 && p.x < el.w && p.y > 0 && p.y < el.h;
  if (!inside) return { x, y };
  const d = [p.y, el.w - p.x, el.h - p.y, p.x];
  const m = Math.min(...d);
  return m === d[0] ? { x, y: 0 } : m === d[1] ? { x: el.w, y } : m === d[2] ? { x, y: el.h } : { x: 0, y };
}

/** Element-local point of an end attached anywhere (`at`): the drawn outline toward that spot. */
export function outlineLocal(el: BoardElement, at: { u: number; v: number }, local?: Outline): Point {
  const q = { x: at.u * el.w, y: at.v * el.h };
  return local?.toward?.(el, q) ?? boxToward(el, q);
}

/**
 * Attach anywhere: the spot on `el`'s drawn outline toward world point `p`, as the stored `at`
 * fractions, with its nearest side, its world point and how far `p` is from it.
 */
export function attachNear(el: BoardElement, p: Point, local?: Outline): { at: { u: number; v: number }; side: Side; point: Point; dist: number } {
  const l = worldToLocal(el, p);
  const project = (t: Point) => local?.toward?.(el, t) ?? boxToward(el, t);
  // Aiming from the center through the pointer suits curves; aiming at the nearest box edge point
  // suits straight sides (the foot of the perpendicular). Keep whichever lands closer.
  const viaCenter = project(l);
  const viaEdge = project(nearestOnBox(el, l));
  const q = dist(viaEdge, l) < dist(viaCenter, l) - 1e-9 ? viaEdge : viaCenter;
  const at = { u: round4(el.w ? q.x / el.w : 0.5), v: round4(el.h ? q.y / el.h : 0.5) };
  const point = localToWorld(el, q);
  return { at, side: sideOfLocal(el, q), point, dist: dist(point, p) };
}

/** Outward unit normal of a side, in world space. */
export const sideNormal = (el: Boxy, side: Side): Point => rotateVec(LOCAL_NORMAL[side], el.rotation || 0);

/** The side of `el` that faces `toward` (aspect-aware, in the element's own rotated frame). */
export function facingSide(el: Boxy, toward: Point): Side {
  const l = worldToLocal(el, toward);
  const nx = (l.x - el.w / 2) / Math.max(1, el.w / 2);
  const ny = (l.y - el.h / 2) / Math.max(1, el.h / 2);
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left';
  return ny >= 0 ? 'bottom' : 'top';
}

// ---------------------------------------------------------------------------------- endpoints
/** A resolved endpoint: where it is, which way it leaves its element, and that element's box. */
export interface End {
  p: Point;
  /** Outward normal of the attached side (null for a free endpoint). */
  dir: Point | null;
  box: Rect | null;
  side: Side | null;
}

export type Lookup = (id: string) => BoardElement | undefined;

type EndpointLike = Pick<ConnectorElement['start'], 'elementId' | 'anchor' | 'at' | 'x' | 'y'>;
type RouteInput = Pick<ConnectorElement, 'start' | 'end' | 'routing' | 'waypoints'>;

function resolveOne(ep: EndpointLike, el: BoardElement | undefined, ref: Point, local?: Outline): End {
  if (!el) return { p: { x: ep.x, y: ep.y }, dir: null, box: null, side: null };
  if (ep.at) {
    // Attached anywhere: on the outline at that spot, leaving through the nearest side.
    const q = outlineLocal(el, ep.at, local);
    const side = sideOfLocal(el, q);
    return { p: localToWorld(el, q), dir: sideNormal(el, side), box: aabb(el), side };
  }
  const side: Side = ep.anchor && ep.anchor !== 'auto' ? ep.anchor : facingSide(el, ref);
  return { p: anchorWorld(el, side, local), dir: sideNormal(el, side), box: aabb(el), side };
}

/**
 * Resolves both endpoints against the live attached elements. An endpoint whose element is
 * missing (deleted, or not synced yet) falls back to its cached point.
 */
export function resolveEnds(c: RouteInput, lookup: Lookup, local?: Outline): { start: End; end: End } {
  const sEl = c.start.elementId ? lookup(c.start.elementId) : undefined;
  const eEl = c.end.elementId ? lookup(c.end.elementId) : undefined;
  const wps = c.routing === 'straight' ? [] : (c.waypoints ?? []);
  // 'auto' anchors face whatever the line heads to first: a waypoint, the other element or point.
  const sRef = wps[0] ?? (eEl ? centerOf(eEl) : { x: c.end.x, y: c.end.y });
  const eRef = wps[wps.length - 1] ?? (sEl ? centerOf(sEl) : { x: c.start.x, y: c.start.y });
  return { start: resolveOne(c.start, sEl, sRef, local), end: resolveOne(c.end, eEl, eRef, local) };
}

// ---------------------------------------------------------------------------------- routes
export interface Route {
  /** Polyline approximation (flattened curves) from start to end, untrimmed. */
  poly: Point[];
  /** Cubic segments for curved routes ([p0, c1, c2, p1] each); null for polylines. */
  cubics: Array<[Point, Point, Point, Point]> | null;
  /** Unit direction the line travels when it reaches the start / end point (for caps). */
  startTangent: Point;
  endTangent: Point;
}

/**
 * The route between two resolved ends. `obstacles` (other items' boxes, see `routeRegion`) only
 * matter to elbow lines: they detour around them.
 */
export function computeRoute(routing: ConnectorRouting, s: End, e: End, waypoints: Point[] = [], obstacles: Rect[] = []): Route {
  if (routing === 'curved') return curvedRoute(s, e, waypoints);
  const poly = routing === 'elbow' ? elbowRoute(s, e, waypoints, obstacles) : [s.p, e.p];
  return { poly, cubics: null, ...polyTangents(poly) };
}

function polyTangents(poly: Point[]): { startTangent: Point; endTangent: Point } {
  let i = 1;
  while (i < poly.length - 1 && samePoint(poly[i], poly[0])) i++;
  let j = poly.length - 2;
  while (j > 0 && samePoint(poly[j], poly[poly.length - 1])) j--;
  return {
    startTangent: unit(sub(poly[0], poly[Math.min(i, poly.length - 1)])),
    endTangent: unit(sub(poly[poly.length - 1], poly[Math.max(j, 0)])),
  };
}

// ---- curved
function curvedRoute(s: End, e: End, wps: Point[]): Route {
  const pts = [s.p, ...wps, e.p];
  const n = pts.length;
  // Tangent (direction of travel) at each point.
  const tangents = pts.map((p, i) => {
    if (i === 0) return s.dir ?? unit(sub(pts[1], p));
    if (i === n - 1) return e.dir ? mul(e.dir, -1) : unit(sub(p, pts[n - 2]));
    return unit(sub(pts[i + 1], pts[i - 1]));
  });
  const cubics: Array<[Point, Point, Point, Point]> = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = dist(a, b);
    // Attached ends get a longer handle so the line leaves the side perpendicular before bending.
    const ka = i === 0 && s.dir ? Math.min(Math.max(d * 0.45, 24), 260) : d / 3;
    const kb = i === n - 2 && e.dir ? Math.min(Math.max(d * 0.45, 24), 260) : d / 3;
    cubics.push([a, add(a, mul(tangents[i], ka)), sub(b, mul(tangents[i + 1], kb)), b]);
  }
  const poly: Point[] = [pts[0]];
  for (const c of cubics) for (let k = 1; k <= CURVE_STEPS; k++) poly.push(cubicAt(c, k / CURVE_STEPS));
  const first = cubics[0];
  const last = cubics[cubics.length - 1];
  return {
    poly,
    cubics,
    startTangent: samePoint(first[0], first[1]) ? unit(sub(first[0], first[2])) : unit(sub(first[0], first[1])),
    endTangent: samePoint(last[3], last[2]) ? unit(sub(last[3], last[1])) : unit(sub(last[3], last[2])),
  };
}

export function cubicAt([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

// ---- elbow
const axisOf = (v: Point): Point =>
  Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x) || 1, y: 0 } : { x: 0, y: Math.sign(v.y) || 1 };

/** Does an axis-aligned segment pass through the open interior of `r`? */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

/** Drops repeated points and middle points of straight runs. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length && samePoint(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      if (Math.abs(cross) < 1e-6) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * Orthogonal route that leaves/enters attached ends perpendicular to their side, keeps clear of
 * both endpoint elements, and prefers few bends and short length. With a waypoint, the middle
 * segment passes through it.
 */
function elbowRoute(s: End, e: End, wps: Point[], obstacles: Rect[]): Point[] {
  let M = ELBOW_MARGIN;
  // Free ends leave toward the other end along the dominant axis.
  const ds = s.dir ? axisOf(s.dir) : null;
  const de = e.dir ? axisOf(e.dir) : null;
  // Sides facing each other across a gap narrower than two stubs (items packed by Tidy up): the
  // stubs meet in the middle of the gap, so the line crosses it instead of overshooting and
  // looping back around both items.
  if (ds && de && ds.x === -de.x && ds.y === -de.y) {
    const gap = (e.p.x - s.p.x) * ds.x + (e.p.y - s.p.y) * ds.y;
    if (gap > 0 && gap < 2 * M) M = gap / 2;
  }
  // An end attached inside its box (a spot on an ellipse's curve) first leaves the box.
  const A = ds ? add(s.p, mul(ds, M + exitDistance(s, ds))) : s.p;
  const B = de ? add(e.p, mul(de, M + exitDistance(e, de))) : e.p;
  const solid = [s.box, e.box].filter((b): b is Rect => !!b).map((b) => inflate(b, -0.5));
  const near = [s.box, e.box].filter((b): b is Rect => !!b).map((b) => inflate(b, Math.max(0, M - 1)));
  const outer = [s.box, e.box].filter((b): b is Rect => !!b).map((b) => inflate(b, M));

  const mids: Point[][] = [];
  const w = wps[0];
  if (w) {
    mids.push([{ x: A.x, y: w.y }, { x: B.x, y: w.y }], [{ x: w.x, y: A.y }, { x: w.x, y: B.y }]);
  } else {
    mids.push([{ x: B.x, y: A.y }], [{ x: A.x, y: B.y }]);
    const xs = new Set([(A.x + B.x) / 2, A.x, B.x, ...outer.flatMap((r) => [r.x, r.x + r.w])]);
    const ys = new Set([(A.y + B.y) / 2, A.y, B.y, ...outer.flatMap((r) => [r.y, r.y + r.h])]);
    for (const x of xs) mids.push([{ x, y: A.y }, { x, y: B.y }]);
    for (const y of ys) mids.push([{ x: A.x, y }, { x: B.x, y }]);
  }

  let best: Point[] | null = null;
  let bestScore = Infinity;
  for (const mid of mids) {
    const inner = [A, ...mid, B];
    let score = 0;
    for (let i = 0; i < inner.length - 1; i++) {
      const a = inner[i];
      const b = inner[i + 1];
      if (samePoint(a, b)) continue;
      score += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const r of solid) if (segmentHitsRect(a, b, r)) score += 100_000;
      for (const r of near) if (segmentHitsRect(a, b, r)) score += 400;
    }
    // Never double back over the stubs.
    const firstMove = inner.slice(1).find((p) => !samePoint(p, A));
    if (ds && firstMove) {
      const d = unit(sub(firstMove, A));
      if (d.x * ds.x + d.y * ds.y < -0.5) score += 10_000;
    }
    const lastFrom = [...inner].reverse().slice(1).find((p) => !samePoint(p, B));
    if (de && lastFrom) {
      const d = unit(sub(B, lastFrom));
      if (d.x * de.x + d.y * de.y > 0.5) score += 10_000;
    }
    const pts = simplify([s.p, ...inner, e.p]);
    score += (pts.length - 2) * 30;
    if (score < bestScore) {
      bestScore = score;
      best = pts;
    }
  }
  const simple = best ?? [s.p, e.p];
  // Other items in the way (never with a user's bend: that route is theirs): search around them.
  if (w || !obstacles.length) return simple;
  const blocks = obstacles.map((r) => inflate(r, -0.5));
  const crosses = simple.some((p, i) => i > 0 && blocks.some((r) => segmentHitsRect(simple[i - 1], p, r)));
  if (!crosses) return simple;
  const around = routeAround({
    from: A,
    to: B,
    leave: ds,
    arrive: de ? mul(de, -1) : null,
    margin: M,
    ends: [s.box, e.box].filter((b): b is Rect => !!b),
    obstacles,
  });
  return around ? simplify([s.p, ...around, e.p]) : simple;
}

/** How far an attached end's point lies inside its box along the way it leaves (0 on the edge). */
function exitDistance(end: End, d: Point): number {
  const b = end.box;
  if (!b) return 0;
  const g = d.x > 0 ? b.x + b.w - end.p.x : d.x < 0 ? end.p.x - b.x : d.y > 0 ? b.y + b.h - end.p.y : end.p.y - b.y;
  return g > 0.5 ? g : 0;
}

// ---------------------------------------------------------------------------------- measuring
export function polyLength(poly: Point[]): number {
  let l = 0;
  for (let i = 1; i < poly.length; i++) l += dist(poly[i - 1], poly[i]);
  return l;
}

/** Point at fraction `t` (0..1) of the polyline's length, with the local direction. */
export function pointAlong(poly: Point[], t: number): { p: Point; dir: Point } {
  const total = polyLength(poly);
  let left = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < poly.length; i++) {
    const d = dist(poly[i - 1], poly[i]);
    if (left <= d && d > 0) {
      const k = left / d;
      return {
        p: { x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * k, y: poly[i - 1].y + (poly[i].y - poly[i - 1].y) * k },
        dir: unit(sub(poly[i], poly[i - 1])),
      };
    }
    left -= d;
  }
  return { p: poly[poly.length - 1], dir: { x: 1, y: 0 } };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export function distToPoly(p: Point, poly: Point[]): number {
  let d = Infinity;
  for (let i = 1; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i - 1], poly[i]));
  return poly.length === 1 ? dist(p, poly[0]) : d;
}

/** Closest point on the polyline to p. */
export function nearestOnPoly(p: Point, poly: Point[]): Point {
  let best = poly[0];
  let bd = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const ab = sub(poly[i], a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0;
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Fraction of the polyline's length (0..1) at the point of it closest to p. */
export function tAlong(poly: Point[], p: Point): number {
  const total = polyLength(poly);
  if (poly.length < 2 || total <= 0) return 0.5;
  let bestT = 0;
  let bd = Infinity;
  let walked = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const ab = sub(poly[i], a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const k = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0;
    const d = dist(p, { x: a.x + ab.x * k, y: a.y + ab.y * k });
    const seg = Math.sqrt(l2);
    if (d < bd) {
      bd = d;
      bestT = (walked + seg * k) / total;
    }
    walked += seg;
  }
  return bestT;
}

// ---------------------------------------------------------------------------------- caps
/** Cap length in world units; grows with the stroke so thick lines keep readable arrowheads. */
export const capSize = (strokeWidth: number): number => 7 + strokeWidth * 2.5;

/** How far the stroke must stop short of the tip so it doesn't poke through the cap. */
export function capTrim(cap: CapStyle, strokeWidth: number): number {
  const s = capSize(strokeWidth);
  switch (cap) {
    case 'arrow':
      return strokeWidth * 0.75;
    case 'triangle':
      return s * 0.85;
    case 'circle':
      return s * 0.4;
    case 'diamond':
      return s * 0.6;
    // Hollow ends: the line stops at their back, so it never shows through them.
    case 'triangleOpen':
      return s;
    case 'diamondOpen':
      return s * 1.2;
    case 'circleOpen':
      return s * 0.8;
    // Crow's-foot ends (and unknown ones): the line runs to the item; it is the middle prong.
    default:
      return 0;
  }
}

/**
 * One drawn piece of a line end. `fill: 'paper'` is filled with the board background (hollow
 * marks that hide the line under them); `'ink'` with the line colour.
 */
export type CapShape =
  | { kind: 'polyline'; points: Point[] }
  | { kind: 'polygon'; points: Point[]; fill: 'ink' | 'paper' }
  | { kind: 'circle'; c: Point; r: number; fill: 'ink' | 'paper' }
  | { kind: 'line'; a: Point; b: Point };

/**
 * The pieces of a line end whose tip is `tip`, pointing along `dir` (the direction of travel).
 * Ends this client doesn't know (from a newer one) draw nothing: a plain line end.
 */
export function capShape(cap: CapStyle, tip: Point, dir: Point, strokeWidth: number): CapShape[] {
  const s = capSize(strokeWidth);
  const n = perp(dir);
  const back = (k: number, w: number) => add(sub(tip, mul(dir, s * k)), mul(n, s * w));
  const bar = (k: number): CapShape => ({ kind: 'line', a: back(k, 0.6), b: back(k, -0.6) });
  // Crow's foot: prongs fanning out from a point on the line to the item's edge.
  const foot: CapShape = { kind: 'polyline', points: [back(0, 0.6), back(1.1, 0), back(0, -0.6)] };
  const ring = (k: number): CapShape => ({ kind: 'circle', c: back(k, 0), r: s * 0.32, fill: 'paper' });
  switch (cap) {
    case 'arrow':
      return [{ kind: 'polyline', points: [back(1, 0.55), tip, back(1, -0.55)] }];
    case 'triangle':
      return [{ kind: 'polygon', points: [tip, back(1, 0.5), back(1, -0.5)], fill: 'ink' }];
    case 'circle':
      return [{ kind: 'circle', c: sub(tip, mul(dir, s * 0.4)), r: s * 0.4, fill: 'ink' }];
    case 'diamond':
      return [{ kind: 'polygon', points: [tip, back(0.6, 0.38), back(1.2, 0), back(0.6, -0.38)], fill: 'ink' }];
    case 'bar':
      return [{ kind: 'line', a: back(0, 0.55), b: back(0, -0.55) }];
    case 'triangleOpen':
      return [{ kind: 'polygon', points: [tip, back(1, 0.55), back(1, -0.55)], fill: 'paper' }];
    case 'diamondOpen':
      return [{ kind: 'polygon', points: [tip, back(0.6, 0.38), back(1.2, 0), back(0.6, -0.38)], fill: 'paper' }];
    case 'circleOpen':
      return [{ kind: 'circle', c: sub(tip, mul(dir, s * 0.4)), r: s * 0.4, fill: 'paper' }];
    case 'one':
      return [bar(0.5), bar(0.9)];
    case 'many':
      return [foot];
    case 'zeroOrOne':
      return [bar(0.5), ring(1.25)];
    case 'oneOrMany':
      return [foot, bar(1.45)];
    case 'zeroOrMany':
      return [foot, ring(1.55)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------- svg path
const fmt = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a route, with both ends pulled back by the cap trims. */
export function routePath(route: Route, trimStart: number, trimEnd: number, rounded: boolean): string {
  if (route.cubics) {
    const cs = route.cubics.map((c) => [...c] as [Point, Point, Point, Point]);
    const first = cs[0];
    const last = cs[cs.length - 1];
    if (trimStart) first[0] = sub(first[0], mul(route.startTangent, trimStart));
    if (trimEnd) last[3] = sub(last[3], mul(route.endTangent, trimEnd));
    let d = `M${fmt(first[0].x)} ${fmt(first[0].y)}`;
    for (const [, c1, c2, p] of cs) d += ` C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p.x)} ${fmt(p.y)}`;
    return d;
  }
  const pts = route.poly.map((p) => ({ ...p }));
  const n = pts.length;
  if (trimStart && n >= 2 && dist(pts[0], pts[1]) > trimStart) pts[0] = sub(pts[0], mul(route.startTangent, trimStart));
  if (trimEnd && n >= 2 && dist(pts[n - 1], pts[n - 2]) > trimEnd) pts[n - 1] = sub(pts[n - 1], mul(route.endTangent, trimEnd));
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    if (rounded && i < n - 1) {
      const prev = pts[i - 1];
      const next = pts[i + 1];
      const r = Math.min(CORNER_RADIUS, dist(prev, p) / 2, dist(p, next) / 2);
      if (r > 0.5) {
        const a = sub(p, mul(unit(sub(p, prev)), r));
        const b = add(p, mul(unit(sub(next, p)), r));
        d += ` L${fmt(a.x)} ${fmt(a.y)} Q${fmt(p.x)} ${fmt(p.y)} ${fmt(b.x)} ${fmt(b.y)}`;
        continue;
      }
    }
    d += ` L${fmt(p.x)} ${fmt(p.y)}`;
  }
  return d;
}

// ---------------------------------------------------------------------------------- label + bounds
export const LABEL_FONT = 14;
export const LABEL_LINE = 1.35;

/** Rough label box (world units) for hit-testing and bounds; the DOM sizes the real one. */
export function labelBox(plain: string, at: Point): Rect | null {
  const lines = plain.split('\n');
  if (!plain.trim()) return null;
  const w = Math.min(260, Math.max(...lines.map((l) => l.length)) * LABEL_FONT * 0.58) + 12;
  const h = lines.length * LABEL_FONT * LABEL_LINE + 8;
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** Bounding box stored on the element (x/y/w/h): route + caps + label. */
export function routeBounds(route: Route, strokeWidth: number, label: Rect | null): Rect {
  const pad = capSize(strokeWidth) * 0.6 + strokeWidth + 2;
  let r = inflate(boundsOfPoints(route.poly), pad);
  if (label) r = boundsOfPoints([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: label.x, y: label.y }, { x: label.x + label.w, y: label.y + label.h }]);
  return { x: fmt(r.x), y: fmt(r.y), w: fmt(Math.max(1, r.w)), h: fmt(Math.max(1, r.h)) };
}

export const round2 = fmt;
