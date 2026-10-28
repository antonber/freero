// Snapping for moves and resizes: edges and centers against nearby boxes, equal spacing (the gap
// to a neighbour matches a gap already in the row/column), and the board grid.
import type { Rect } from '../api';

/** A guide line in world space. axis 'x' = vertical line at x=pos spanning y in [from, to]. */
export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

/**
 * A distance marker in world space. axis 'x' = a horizontal measure from x=from to x=to at y=at
 * (the gap between two boxes side by side); axis 'y' = a vertical one from y=from to y=to at x=at.
 */
export interface GapGuide {
  axis: 'x' | 'y';
  from: number;
  to: number;
  at: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
  /** Equal-spacing markers: the moving box's matched gap(s) and the existing gaps it matches. */
  gaps: GapGuide[];
}

export interface SnapOptions {
  /** Snap to this grid step (world units) instead of to other boxes. */
  grid?: number;
}

/**
 * The grid step a pointer gesture snaps to, or undefined: the board's snap-to-grid setting,
 * inverted while Ctrl/⌘ is held; Alt disables snapping.
 */
export function gridStepFor(
  settings: { snapToGrid: boolean; gridSize: number },
  mods: { metaKey: boolean; altKey: boolean },
): number | undefined {
  if (mods.altKey) return undefined;
  return settings.snapToGrid !== mods.metaKey ? settings.gridSize : undefined;
}

/** Nearest grid point. */
export function snapPointToGrid(p: { x: number; y: number }, step: number): { x: number; y: number } {
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/**
 * Arrow-key nudge along one axis with the grid on: the distance from the box's left/top `pos` to
 * the `steps`-th grid line in direction `dir` (an off-grid box first lands on the next line, so a
 * nudge always ends on the grid, like a snapped drag).
 */
export function gridNudge(pos: number, dir: -1 | 1, step: number, steps: number): number {
  const eps = 1e-6;
  const next = dir > 0 ? Math.floor(pos / step + eps) * step + step : Math.ceil(pos / step - eps) * step - step;
  return next + dir * (steps - 1) * step - pos;
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

// ---------------------------------------------------------------- equal spacing
/** One axis seen as intervals: 'x' looks at boxes side by side (a row), 'y' at a column. */
interface Axis {
  start(r: Rect): number;
  size(r: Rect): number;
  crossStart(r: Rect): number;
  crossSize(r: Rect): number;
}
const AXES: Record<'x' | 'y', Axis> = {
  x: { start: (r) => r.x, size: (r) => r.w, crossStart: (r) => r.y, crossSize: (r) => r.h },
  y: { start: (r) => r.y, size: (r) => r.h, crossStart: (r) => r.x, crossSize: (r) => r.w },
};
const endOf = (a: Axis, r: Rect) => a.start(r) + a.size(r);
const crossOverlap = (a: Axis, p: Rect, q: Rect) =>
  a.crossStart(p) < a.crossStart(q) + a.crossSize(q) && a.crossStart(q) < a.crossStart(p) + a.crossSize(p);
/** Middle of the cross-axis range two boxes share (where the marker between them is drawn). */
const sharedMid = (a: Axis, p: Rect, q: Rect) =>
  (Math.max(a.crossStart(p), a.crossStart(q)) +
    Math.min(a.crossStart(p) + a.crossSize(p), a.crossStart(q) + a.crossSize(q))) /
  2;

interface Pair {
  a: Rect;
  b: Rect;
  gap: number;
}

/** Each box in `row` with its nearest neighbour after it along the axis (sharing cross range). */
function neighbourPairs(axis: Axis, row: Rect[]): Pair[] {
  const out: Pair[] = [];
  for (const a of row) {
    let best: Rect | null = null;
    for (const b of row) {
      if (b === a || axis.start(b) < endOf(axis, a) || !crossOverlap(axis, a, b)) continue;
      if (!best || axis.start(b) < axis.start(best)) best = b;
    }
    if (best) out.push({ a, b: best, gap: axis.start(best) - endOf(axis, a) });
  }
  return out;
}

/** The moving box's nearest neighbours before/after it along the axis, among `row`. */
function sidesOf(axis: Axis, m: Rect, row: Rect[], slack: number) {
  let before: Rect | null = null;
  let after: Rect | null = null;
  for (const o of row) {
    if (endOf(axis, o) <= axis.start(m) + slack && (!before || endOf(axis, o) > endOf(axis, before))) before = o;
    if (axis.start(o) >= endOf(axis, m) - slack && (!after || axis.start(o) < axis.start(after))) after = o;
  }
  return { before, after };
}

/**
 * Offset along one axis that makes a gap next to the moving box equal to an existing gap in its
 * row (or centers it between its two neighbours), within `threshold`; null when none is close.
 */
function gapOffset(axisName: 'x' | 'y', m: Rect, others: Rect[], threshold: number): number | null {
  const axis = AXES[axisName];
  const row = others.filter((o) => crossOverlap(axis, m, o));
  if (!row.length) return null;
  const { before, after } = sidesOf(axis, m, row, threshold);
  if (!before && !after) return null;
  const targets: number[] = [];
  for (const { gap } of neighbourPairs(axis, row)) {
    if (gap <= 0.5) continue;
    if (before) targets.push(endOf(axis, before) + gap);
    if (after) targets.push(axis.start(after) - gap - axis.size(m));
  }
  if (before && after && axis.start(after) - endOf(axis, before) > axis.size(m)) {
    targets.push((endOf(axis, before) + axis.start(after) - axis.size(m)) / 2);
  }
  let best: number | null = null;
  for (const t of targets) {
    const d = t - axis.start(m);
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** Markers for the gaps next to the (already snapped) moving box that equal another gap in its row. */
function gapGuidesFor(axisName: 'x' | 'y', m: Rect, others: Rect[]): GapGuide[] {
  const axis = AXES[axisName];
  const row = others.filter((o) => crossOverlap(axis, m, o));
  if (!row.length) return [];
  const { before, after } = sidesOf(axis, m, row, 0.5);
  const mine: Pair[] = [];
  if (before) mine.push({ a: before, b: m, gap: axis.start(m) - endOf(axis, before) });
  if (after) mine.push({ a: m, b: after, gap: axis.start(after) - endOf(axis, m) });
  const theirs = neighbourPairs(axis, row);
  const out: GapGuide[] = [];
  const shown = new Set<Pair>();
  const show = (p: Pair) => {
    if (shown.has(p)) return;
    shown.add(p);
    out.push({ axis: axisName, from: endOf(axis, p.a), to: axis.start(p.b), at: sharedMid(axis, p.a, p.b) });
  };
  for (const p of mine) {
    if (p.gap <= 0.5) continue;
    const same = [...mine.filter((q) => q !== p), ...theirs].filter((q) => Math.abs(q.gap - p.gap) < 0.5);
    if (!same.length) continue;
    show(p);
    same.forEach(show);
  }
  return out;
}

/** Signed offset from `v` to the nearest multiple of `step`. */
const toGrid = (v: number, step: number) => Math.round(v / step) * step - v;

/**
 * Snaps a moving box to the edges/centers of `others`, or to equal spacing with its neighbours,
 * whichever is closer per axis. `threshold` is in world units (callers pass screenPx / zoom).
 * With `opts.grid`, the box's top-left snaps to the grid instead. Returns the correction to add,
 * the alignment guides and the equal-spacing markers to draw.
 */
export function snapMove(moving: Rect, others: Rect[], threshold: number, opts: SnapOptions = {}): SnapResult {
  if (opts.grid && opts.grid > 0) {
    const dx = toGrid(moving.x, opts.grid);
    const dy = toGrid(moving.y, opts.grid);
    const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
    return { dx, dy, guides: [...guidesFor(snapped, others, 'x', FEATURES), ...guidesFor(snapped, others, 'y', FEATURES)], gaps: [] };
  }
  const closer = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.abs(b) < Math.abs(a) ? b : a);
  const dx = closer(bestOffset(moving, others, threshold, featureX, FEATURES), gapOffset('x', moving, others, threshold)) ?? 0;
  const dy = closer(bestOffset(moving, others, threshold, featureY, FEATURES), gapOffset('y', moving, others, threshold)) ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  return {
    dx,
    dy,
    guides: [...guidesFor(snapped, others, 'x', FEATURES), ...guidesFor(snapped, others, 'y', FEATURES)],
    gaps: [...gapGuidesFor('x', snapped, others), ...gapGuidesFor('y', snapped, others)],
  };
}

/**
 * Snaps only the edges being dragged during a resize. `edges` says which sides move.
 * Returns a corrected rect plus guides. With `opts.grid`, the dragged edges snap to the grid.
 */
export function snapResize(
  rect: Rect,
  edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
  others: Rect[],
  threshold: number,
  opts: SnapOptions = {},
): { rect: Rect; guides: SnapGuide[] } {
  const r = { ...rect };
  if (opts.grid && opts.grid > 0) {
    const g = opts.grid;
    if (edges.left) {
      const d = toGrid(r.x, g);
      r.x += d;
      r.w -= d;
    } else if (edges.right) r.w += toGrid(r.x + r.w, g);
    if (edges.top) {
      const d = toGrid(r.y, g);
      r.y += d;
      r.h -= d;
    } else if (edges.bottom) r.h += toGrid(r.y + r.h, g);
    return { rect: r, guides: [] };
  }
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
