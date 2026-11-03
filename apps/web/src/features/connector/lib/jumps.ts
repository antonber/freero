// Line jumps (#115): where two connectors cross, the one drawn on top hops over the one beneath
// in a small arc, so readers can tell the lines apart. Pure geometry: which crossings get a hop,
// and where along the route each hop runs. The element draws the hops into its own path, so the
// canvas, the selection halo and every export show them.
import type { Point } from '@engine';

/** A hop on segment `seg` of a route (poly[seg] → poly[seg + 1]), from / to distances along it, `r` high. */
export interface Hop {
  seg: number;
  from: number;
  to: number;
  r: number;
}

/** Half the width of a hop for a line `strokeWidth` wide (world units). */
export const jumpRadius = (strokeWidth: number) => 5 + strokeWidth * 1.5;

/** No hop this near either line's ends: lines leaving the same item fan out of one spot. */
const END_CLEAR = 14;
/** Room kept between a hop and a bend (elbow corners are rounded by up to 8). */
const BEND_CLEAR = 10;
/** Crossing at a shallower angle than this (its sine) is running alongside, not across. */
const MIN_SINE = 0.25;
/** Hops closer than this merge into one longer hop. */
const MERGE_GAP = 4;

/** A route's bounds, worked out once per route (routes are kept per line version). */
const boxes = new WeakMap<Point[], { x0: number; y0: number; x1: number; y1: number }>();
function boxOf(line: Point[]) {
  let b = boxes.get(line);
  if (!b) {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of line) {
      if (p.x < b.x0) b.x0 = p.x;
      if (p.x > b.x1) b.x1 = p.x;
      if (p.y < b.y0) b.y0 = p.y;
      if (p.y > b.y1) b.y1 = p.y;
    }
    boxes.set(line, b);
  }
  return b;
}

/** Whether line `a` is drawn above line `b` (the canvas's order among lines: z, then id). */
export const drawnAbove = (a: { z: number; id: string }, b: { z: number; id: string }) => (a.z !== b.z ? a.z > b.z : a.id > b.id);

/**
 * The hops `route` draws over the lines `beneath` (their routes): one per real crossing, none
 * where the lines meet at or near an end (a shared endpoint), run along each other (overlapping
 * or nearly parallel), or cross too near a bend of `route` to fit a hop. `clear` is how much of
 * each end of `route` stays straight (its line ends' marks). Sorted along the route.
 */
export function lineJumps(route: Point[], beneath: Point[][], radius: number, clear: { start: number; end: number } = { start: 0, end: 0 }): Hop[] {
  if (route.length < 2 || !beneath.length) return [];
  const clearSq = (END_CLEAR + radius) ** 2;
  // Hot loop (every pair of segments near each other): plain numbers, no allocations.
  const nearEnd = (px: number, py: number, line: Point[]) => {
    const s = line[0];
    const e = line[line.length - 1];
    return (px - s.x) ** 2 + (py - s.y) ** 2 < clearSq || (px - e.x) ** 2 + (py - e.y) ** 2 < clearSq;
  };
  const hops: Hop[] = [];
  const last = route.length - 2;
  for (let i = 0; i <= last; i++) {
    const a = route[i];
    const b = route[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len = Math.hypot(abx, aby);
    if (len < 2 * radius) continue;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const at: number[] = [];
    for (const other of beneath) {
      if (other.length < 2) continue;
      const ob = boxOf(other);
      if (ob.x1 < minX || ob.x0 > maxX || ob.y1 < minY || ob.y0 > maxY) continue;
      for (let j = 0; j < other.length - 1; j++) {
        const c = other[j];
        const d = other[j + 1];
        if ((c.x < minX && d.x < minX) || (c.x > maxX && d.x > maxX) || (c.y < minY && d.y < minY) || (c.y > maxY && d.y > maxY)) continue;
        const cdx = d.x - c.x;
        const cdy = d.y - c.y;
        const den = abx * cdy - aby * cdx;
        const cdLen = Math.hypot(cdx, cdy);
        if (!cdLen || Math.abs(den) < MIN_SINE * len * cdLen) continue;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const s = (acx * cdy - acy * cdx) / den;
        const t = (acx * aby - acy * abx) / den;
        if (s <= 0 || s >= 1 || t <= 0 || t >= 1) continue;
        const px = a.x + abx * s;
        const py = a.y + aby * s;
        if (nearEnd(px, py, route) || nearEnd(px, py, other)) continue;
        at.push(s * len);
      }
    }
    if (!at.length) continue;
    at.sort((x, y) => x - y);
    const lo = (i === 0 ? clear.start : BEND_CLEAR) + radius;
    const hi = len - (i === last ? clear.end : BEND_CLEAR) - radius;
    let open: Hop | null = null;
    for (const d of at) {
      if (d < lo || d > hi) continue;
      if (open && d - radius <= open.to + MERGE_GAP) open.to = d + radius;
      else {
        open = { seg: i, from: d - radius, to: d + radius, r: radius };
        hops.push(open);
      }
    }
  }
  return hops;
}

/** Same hops (renderers redraw only when this is false). */
export const sameHops = (a: Hop[], b: Hop[]) => a.length === b.length && a.every((h, i) => h.seg === b[i].seg && h.from === b[i].from && h.to === b[i].to);
