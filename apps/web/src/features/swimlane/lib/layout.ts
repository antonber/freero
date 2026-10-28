// Swimlane geometry and the plans its actions and arrange pass apply. Pure: unit-tested without an
// editor. Lanes run along the "lane axis" (y for rows, x when the pool is vertical), phases along
// the other one; every band (lane or phase) is a [start, start + size) slice of its axis.
import type { BoardElement, SwimlaneBand, SwimlaneElement } from '@freero/shared';
import type { Rect } from '@engine';

/** Pool title band, across the top. */
export const TITLE_H = 44;
/** Rows: the lane header column (titles read left to right). */
export const LANE_HEAD_W = 150;
/** Columns: the lane header row. */
export const LANE_HEAD_H = 40;
/** Rows: the phase header row (only with two or more phases). */
export const PHASE_HEAD_H = 36;
/** Columns: the phase header column. */
export const PHASE_HEAD_W = 120;
export const MIN_BAND = 60;
/** Room kept between an item and the far edge of its lane when the lane grows to fit it. */
export const FIT_PAD = 16;
export const DEFAULT_LANE = 200;
export const DEFAULT_PHASE = 900;
export const DEFAULT_COLUMN_LANE = 280;
export const DEFAULT_ROW_PHASE = 260;

export type Axis = 'x' | 'y';
type Pool = Pick<SwimlaneElement, 'vertical' | 'lanes' | 'phases'>;

export interface Grid {
  laneAxis: Axis;
  phaseAxis: Axis;
  /** Local start of each lane along the lane axis, then of each phase along the phase axis. */
  laneStarts: number[];
  phaseStarts: number[];
  laneEnd: number;
  phaseEnd: number;
  w: number;
  h: number;
}

export const showsPhases = (p: Pick<SwimlaneElement, 'phases'>) => p.phases.length > 1;

function starts(bands: SwimlaneBand[], from: number): { starts: number[]; end: number } {
  let s = from;
  const out = bands.map((b) => {
    const v = s;
    s += b.size;
    return v;
  });
  return { starts: out, end: s };
}

/** Where everything is, element-local. */
export function gridOf(p: Pool): Grid {
  const ph = showsPhases(p);
  const laneFrom = p.vertical ? (ph ? PHASE_HEAD_W : 0) : TITLE_H + (ph ? PHASE_HEAD_H : 0);
  const phaseFrom = p.vertical ? TITLE_H + LANE_HEAD_H : LANE_HEAD_W;
  const lanes = starts(p.lanes, laneFrom);
  const phases = starts(p.phases, phaseFrom);
  return {
    laneAxis: p.vertical ? 'x' : 'y',
    phaseAxis: p.vertical ? 'y' : 'x',
    laneStarts: lanes.starts,
    phaseStarts: phases.starts,
    laneEnd: lanes.end,
    phaseEnd: phases.end,
    w: p.vertical ? lanes.end : phases.end,
    h: p.vertical ? phases.end : lanes.end,
  };
}

/** The pool's size from its bands. */
export const sizeOf = (p: Pool) => {
  const g = gridOf(p);
  return { w: g.w, h: g.h };
};

/** Index of the band under local coordinate `v` (clamped to the first / last band). */
export function bandAt(bandStarts: number[], v: number): number {
  let i = 0;
  while (i + 1 < bandStarts.length && v >= bandStarts[i + 1]) i++;
  return i;
}

/** Box (element-local) of lane i's body across every phase. */
export function laneRect(p: Pool, i: number): Rect {
  const g = gridOf(p);
  const s = g.laneStarts[i];
  const size = p.lanes[i].size;
  const ps = g.phaseStarts[0];
  return g.laneAxis === 'y' ? { x: ps, y: s, w: g.phaseEnd - ps, h: size } : { x: s, y: ps, w: size, h: g.phaseEnd - ps };
}

/** Items a pool holds: its direct children, except lines (they follow their ends). */
export const membersOf = (p: Pick<SwimlaneElement, 'id'>, all: readonly BoardElement[]) =>
  all.filter((el) => el.frameId === p.id && el.type !== 'connector');

/** Axis-aligned box of a possibly rotated element. */
export function boxOf(el: Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Rect {
  if (!el.rotation || el.rotation % 360 === 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const r = (el.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = el.w * c + el.h * s;
  const h = el.w * s + el.h * c;
  return { x: el.x + el.w / 2 - w / 2, y: el.y + el.h / 2 - h / 2, w, h };
}

const along = (r: Rect, axis: Axis): [number, number] => (axis === 'x' ? [r.x, r.x + r.w] : [r.y, r.y + r.h]);

export interface Placement {
  el: BoardElement;
  lane: number;
  phase: number;
  /** Offsets of the item's top-left from its lane / phase start. */
  laneOffset: number;
  phaseOffset: number;
}

/** Which lane and phase each item is in (by its center), and where in them. */
export function placements(p: SwimlaneElement, all: readonly BoardElement[]): Placement[] {
  const g = gridOf(p);
  return membersOf(p, all).map((el) => {
    const b = boxOf(el);
    const local = { x: b.x - p.x, y: b.y - p.y, w: b.w, h: b.h };
    const [l0, l1] = along(local, g.laneAxis);
    const [p0, p1] = along(local, g.phaseAxis);
    const lane = bandAt(g.laneStarts, (l0 + l1) / 2);
    const phase = bandAt(g.phaseStarts, (p0 + p1) / 2);
    const own = g.laneAxis === 'x' ? { l: el.x - p.x, p: el.y - p.y } : { l: el.y - p.y, p: el.x - p.x };
    return { el, lane, phase, laneOffset: own.l - g.laneStarts[lane], phaseOffset: own.p - g.phaseStarts[phase] };
  });
}

export interface FitPlan {
  lanes: SwimlaneBand[];
  phases: SwimlaneBand[];
  /** The pool's own move (it grows backwards when an item sticks out before its first lane). */
  dx: number;
  dy: number;
  /** World moves of the items in later bands. */
  moves: Array<{ id: string; dx: number; dy: number }>;
}

/**
 * "Lanes grow to fit what is in them": the band sizes that hold every item with FIT_PAD to
 * spare, and the moves that keep the items of the bands after a grown one in their band. Never
 * shrinks a band. null when everything fits (idempotent: the arrange pass runs after every
 * change). Deterministic: the same board gives the same plan on every client.
 */
export function planFit(p: SwimlaneElement, all: readonly BoardElement[]): FitPlan | null {
  const g = gridOf(p);
  const laneNeed = p.lanes.map((b) => b.size);
  const phaseNeed = p.phases.map((b) => b.size);
  let laneBefore = 0;
  let phaseBefore = 0;
  for (const el of membersOf(p, all)) {
    const b = boxOf(el);
    const local = { x: b.x - p.x, y: b.y - p.y, w: b.w, h: b.h };
    const [l0, l1] = along(local, g.laneAxis);
    const [p0, p1] = along(local, g.phaseAxis);
    const lane = bandAt(g.laneStarts, (l0 + l1) / 2);
    const phase = bandAt(g.phaseStarts, (p0 + p1) / 2);
    laneNeed[lane] = Math.max(laneNeed[lane], l1 - g.laneStarts[lane] + FIT_PAD);
    phaseNeed[phase] = Math.max(phaseNeed[phase], p1 - g.phaseStarts[phase] + FIT_PAD);
    // Sticking out before the first band (the pool was shrunk from its start edge): grow back.
    if (lane === 0 && l0 < g.laneStarts[0]) laneBefore = Math.max(laneBefore, g.laneStarts[0] - l0 + FIT_PAD);
    if (phase === 0 && p0 < g.phaseStarts[0]) phaseBefore = Math.max(phaseBefore, g.phaseStarts[0] - p0 + FIT_PAD);
  }
  const laneGrow = laneNeed.map((n, i) => Math.ceil(n - p.lanes[i].size));
  const phaseGrow = phaseNeed.map((n, i) => Math.ceil(n - p.phases[i].size));
  laneBefore = Math.ceil(laneBefore);
  phaseBefore = Math.ceil(phaseBefore);
  if (!laneGrow.some((d) => d > 0) && !phaseGrow.some((d) => d > 0) && !laneBefore && !phaseBefore) return null;

  const grow = (bands: SwimlaneBand[], d: number[], before: number) =>
    bands.map((b, i) => (d[i] > 0 || (i === 0 && before) ? { ...b, size: b.size + Math.max(0, d[i]) + (i === 0 ? before : 0) } : b));
  // Shift of each band's start in the world: the far-end growth of the bands before it.
  const shifts = (d: number[]) => {
    let s = 0;
    return d.map((v) => {
      const cur = s;
      s += Math.max(0, v);
      return cur;
    });
  };
  const laneShift = shifts(laneGrow);
  const phaseShift = shifts(phaseGrow);
  const moves: FitPlan['moves'] = [];
  for (const pl of placements(p, all)) {
    const l = laneShift[pl.lane];
    const ph = phaseShift[pl.phase];
    if (!l && !ph) continue;
    moves.push(g.laneAxis === 'y' ? { id: pl.el.id, dx: ph, dy: l } : { id: pl.el.id, dx: l, dy: ph });
  }
  const back = g.laneAxis === 'y' ? { dx: -phaseBefore, dy: -laneBefore } : { dx: -laneBefore, dy: -phaseBefore };
  return { lanes: grow(p.lanes, laneGrow, laneBefore), phases: grow(p.phases, phaseGrow, phaseBefore), ...back, moves };
}

/**
 * Moves that keep every item in its band when the bands change (resized, added, removed,
 * reordered, the pool turned): each item keeps its offsets inside its lane and phase. Items of a
 * removed band go to `fallback` (a band id of the same kind), or stay where they are.
 */
export function reflow(
  before: SwimlaneElement,
  after: Pool,
  all: readonly BoardElement[],
  fallback: { lane?: string | null; phase?: string | null } = {},
): Array<{ id: string; dx: number; dy: number }> {
  const g = gridOf(after);
  const out: Array<{ id: string; dx: number; dy: number }> = [];
  for (const pl of placements(before, all)) {
    const laneId = before.lanes[pl.lane].id;
    const phaseId = before.phases[pl.phase].id;
    let li = after.lanes.findIndex((b) => b.id === laneId);
    if (li < 0 && fallback.lane) li = after.lanes.findIndex((b) => b.id === fallback.lane);
    let pi = after.phases.findIndex((b) => b.id === phaseId);
    if (pi < 0 && fallback.phase) pi = after.phases.findIndex((b) => b.id === fallback.phase);
    if (li < 0 || pi < 0) continue;
    const l = g.laneStarts[li] + pl.laneOffset;
    const ph = g.phaseStarts[pi] + pl.phaseOffset;
    const local = g.laneAxis === 'y' ? { x: ph, y: l } : { x: l, y: ph };
    const dx = before.x + local.x - pl.el.x;
    const dy = before.y + local.y - pl.el.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) out.push({ id: pl.el.id, dx, dy });
  }
  return out;
}

/**
 * A pool resized with its handles keeps its bands' proportions where it can: the band at the
 * edge being dragged absorbs the change (the first band when the start edge moved, else the
 * last), never below MIN_BAND. Returns the bands and the size that results.
 */
export function absorbResize(next: SwimlaneElement, prev: SwimlaneElement): Pick<SwimlaneElement, 'lanes' | 'phases' | 'x' | 'y' | 'w' | 'h'> {
  const g = gridOf(prev);
  const fit = (bands: SwimlaneBand[], delta: number, fromStart: boolean): SwimlaneBand[] => {
    if (!delta) return bands;
    const i = fromStart ? 0 : bands.length - 1;
    return bands.map((b, k) => (k === i ? { ...b, size: Math.max(MIN_BAND, Math.round(b.size + delta)) } : b));
  };
  const dW = next.w - prev.w;
  const dH = next.h - prev.h;
  const xMoved = Math.abs(next.x - prev.x) > 0.01;
  const yMoved = Math.abs(next.y - prev.y) > 0.01;
  const laneDelta = g.laneAxis === 'y' ? dH : dW;
  const phaseDelta = g.laneAxis === 'y' ? dW : dH;
  const laneFromStart = g.laneAxis === 'y' ? yMoved : xMoved;
  const phaseFromStart = g.laneAxis === 'y' ? xMoved : yMoved;
  const lanes = fit(next.lanes, laneDelta, laneFromStart);
  const phases = fit(next.phases, phaseDelta, phaseFromStart);
  const size = sizeOf({ ...next, lanes, phases });
  // A clamped start-edge drag keeps the far edge where it was.
  const x = xMoved ? prev.x + prev.w - size.w : next.x;
  const y = yMoved ? prev.y + prev.h - size.h : next.y;
  return { lanes, phases, x, y, w: size.w, h: size.h };
}
