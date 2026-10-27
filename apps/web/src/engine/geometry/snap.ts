// Alignment snapping: edges and centers of a moving box against nearby boxes.
import type { Rect } from '../api';

/** A guide line in world space. axis 'x' = vertical line at x=pos spanning y in [from, to]. */
export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

type Feature = 'start' | 'center' | 'end';
const FEATURES: Feature[] = ['start', 'center', 'end'];

const featureX = (r: Rect, f: Feature) => (f === 'start' ? r.x : f === 'center' ? r.x + r.w / 2 : r.x + r.w);
const featureY = (r: Rect, f: Feature) => (f === 'start' ? r.y : f === 'center' ? r.y + r.h / 2 : r.y + r.h);

function bestOffset(
  moving: Rect,
  others: Rect[],
  threshold: number,
  get: (r: Rect, f: Feature) => number,
  movingFeatures: Feature[],
): number | null {
  let best: number | null = null;
  for (const mf of movingFeatures) {
    const mv = get(moving, mf);
    for (const o of others) {
      for (const of of FEATURES) {
        const d = get(o, of) - mv;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best;
}

function guidesFor(
  moving: Rect,
  others: Rect[],
  axis: 'x' | 'y',
  movingFeatures: Feature[],
): SnapGuide[] {
  const get = axis === 'x' ? featureX : featureY;
  const crossStart = (r: Rect) => (axis === 'x' ? r.y : r.x);
  const crossEnd = (r: Rect) => (axis === 'x' ? r.y + r.h : r.x + r.w);
  const byPos = new Map<number, SnapGuide>();
  for (const mf of movingFeatures) {
    const mv = get(moving, mf);
    for (const o of others) {
      for (const of of FEATURES) {
        if (Math.abs(get(o, of) - mv) > 0.5) continue;
        const key = Math.round(mv * 2) / 2;
        const g = byPos.get(key) ?? { axis, pos: mv, from: crossStart(moving), to: crossEnd(moving) };
        g.from = Math.min(g.from, crossStart(o));
        g.to = Math.max(g.to, crossEnd(o));
        byPos.set(key, g);
      }
    }
  }
  return [...byPos.values()];
}

/**
 * Snaps a moving box to the edges/centers of `others`. `threshold` is in world units
 * (callers pass screenPx / zoom). Returns the correction to add and the guides to draw.
 */
export function snapMove(moving: Rect, others: Rect[], threshold: number): SnapResult {
  const dx = bestOffset(moving, others, threshold, featureX, FEATURES) ?? 0;
  const dy = bestOffset(moving, others, threshold, featureY, FEATURES) ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  return {
    dx,
    dy,
    guides: [...guidesFor(snapped, others, 'x', FEATURES), ...guidesFor(snapped, others, 'y', FEATURES)],
  };
}

/**
 * Snaps only the edges being dragged during a resize. `edges` says which sides move.
 * Returns a corrected rect plus guides.
 */
export function snapResize(
  rect: Rect,
  edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
  others: Rect[],
  threshold: number,
): { rect: Rect; guides: SnapGuide[] } {
  const r = { ...rect };
  const fx: Feature[] = [];
  const fy: Feature[] = [];
  if (edges.left) fx.push('start');
  if (edges.right) fx.push('end');
  if (edges.top) fy.push('start');
  if (edges.bottom) fy.push('end');
  if (fx.length) {
    const d = bestOffset(r, others, threshold, featureX, fx);
    if (d !== null) {
      if (edges.left) { r.x += d; r.w -= d; } else r.w += d;
    }
  }
  if (fy.length) {
    const d = bestOffset(r, others, threshold, featureY, fy);
    if (d !== null) {
      if (edges.top) { r.y += d; r.h -= d; } else r.h += d;
    }
  }
  return { rect: r, guides: [...guidesFor(r, others, 'x', fx), ...guidesFor(r, others, 'y', fy)] };
}
