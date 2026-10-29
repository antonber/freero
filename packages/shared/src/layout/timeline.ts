// Timeline geometry, dates and layout (KAI-122, KAI-160), shared so the server lays a timeline out
// exactly as the timeline feature does: a tracker's date change (modules/trackers) moves the bar in
// the same transaction, so open browsers see it at its new dates without a client re-laying it.
// Pure. Exported from the package root as the `timelineLayout` namespace (generic names inside).
import type { BoardElement, CardElement, TimelineBarElement, TimelineElement, TimelineLane, TimelineScale } from '../elements';

// ---------------------------------------------------------------------------- dates
// Calendar dates as whole day numbers. Dates are stored as local calendar dates 'YYYY-MM-DD' (no
// time zone, like card due dates); the arithmetic runs in UTC so a day is always one day long.

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isISODate = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Day number of an ISO date (days since 1970-01-01). */
export function dayOf(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (iso: string, n: number): string => isoOf(dayOf(iso) + n);

/** This device's calendar date of a moment (the server's clock, for "today"). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day-of-week, Monday = 0. */
export const weekday = (day: number): number => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;

export const mondayOf = (day: number): number => day - weekday(day);

/** ISO-8601 week number. */
export function isoWeek(day: number): number {
  const thursday = day - weekday(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(year, 0, 4) / DAY_MS);
  return 1 + Math.round((thursday - (jan4 - weekday(jan4) + 3)) / 7);
}

const parts = (day: number) => {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const dayFromParts = (y: number, m: number, d = 1) => Math.round(Date.UTC(y, m, d) / DAY_MS);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A labelled span of days on the axis (one header cell), `to` exclusive. */
export interface Tick {
  from: number;
  to: number;
  label: string;
}

function spans(from: number, to: number, next: (day: number) => number, label: (day: number) => string): Tick[] {
  const out: Tick[] = [];
  for (let at = from; at < to && out.length < 2000; ) {
    const end = Math.min(to, next(at));
    out.push({ from: at, to: end, label: label(at) });
    at = end;
  }
  return out;
}

const nextMonth = (day: number) => {
  const p = parts(day);
  return dayFromParts(p.y, p.m + 1);
};
const nextQuarter = (day: number) => {
  const p = parts(day);
  return dayFromParts(p.y, p.m - (p.m % 3) + 3);
};
const nextYear = (day: number) => dayFromParts(parts(day).y + 1, 0);

/**
 * The two header rows for days `from`..`to` (inclusive) at a scale: the coarse row (months or
 * years) above the unit row (days, weeks, months, quarters).
 */
export function axisTicks(scale: TimelineScale, from: number, to: number): { top: Tick[]; units: Tick[] } {
  const end = to + 1;
  const month = (d: number) => `${MONTHS[parts(d).m]} ${parts(d).y}`;
  const year = (d: number) => String(parts(d).y);
  switch (scale) {
    case 'day':
      return { top: spans(from, end, nextMonth, month), units: spans(from, end, (d) => d + 1, (d) => String(parts(d).d)) };
    case 'week':
      return { top: spans(from, end, nextMonth, month), units: spans(from, end, (d) => mondayOf(d) + 7, (d) => `W${isoWeek(d)}`) };
    case 'month':
      return { top: spans(from, end, nextYear, year), units: spans(from, end, nextMonth, (d) => MONTHS[parts(d).m]) };
    case 'quarter':
      return { top: spans(from, end, nextYear, year), units: spans(from, end, nextQuarter, (d) => `Q${Math.floor(parts(d).m / 3) + 1}`) };
  }
}

/** "Oct 26 – Nov 6" for a bar's tooltip and the outline. */
export function formatRange(start: string, end: string): string {
  const a = parts(dayOf(start));
  const b = parts(dayOf(end));
  const one = (p: { m: number; d: number }) => `${MONTHS[p.m]} ${p.d}`;
  if (start === end) return `${one(a)}, ${a.y}`;
  return a.y === b.y ? `${one(a)} – ${one(b)}, ${b.y}` : `${one(a)}, ${a.y} – ${one(b)}, ${b.y}`;
}

// ---------------------------------------------------------------------------- layout
// Timeline geometry and layout (KAI-122). Pure: the element's `arrange` calls `planTimeline` and
// applies what it returns. DATES ARE THE TRUTH: every bar's box is derived from its dates, its lane
// and its row — except right after someone moved or resized a bar, when the move is read back as
// dates (by whole days). So a range or scale change re-lays every bar at its dates, a collaborator's
// change arrives already laid out, and laying out twice changes nothing.

export const LABEL_W = 168;
export const HEAD_H = 56;
export const ROW_H = 40;
export const BAR_H = 30;
export const LANE_PAD = 6;
export const MIN_ROWS = 2;
/** A bar whose dates are entirely outside the range shows as a stub at that edge (never lost). */
export const STUB_W = 10;
const GAP = 4;
export const MIN_DAYS = 7;
export const MAX_DAYS = 1500;

export const PX_PER_DAY: Record<TimelineScale, number> = { day: 36, week: 14, month: 4.5, quarter: 1.6 };
/** Length of a new bar (and of a card that had no dates), in days. */
export const DEFAULT_DAYS: Record<TimelineScale, number> = { day: 3, week: 5, month: 14, quarter: 30 };
/** The shortest range that still reads at a scale (switching scale extends a shorter one). */
export const MIN_RANGE: Record<TimelineScale, number> = { day: 7, week: 28, month: 92, quarter: 365 };
/** Width a card gets back when it leaves a timeline (it then lays its own height out again). */
export const CARD_BACK = { w: 280, h: 100 };
/** Lane header tints, in the order new lanes take them (the timeline feature and roadmap imports). */
export const LANE_COLORS = ['#E9E4FF', '#DDF0FF', '#DDF6EA', '#FFF1D6', '#FFE3E0', '#F1F0F5'];
/** Now / Next / Later view (KAI-160): each column's width, and the room around a bar in it. */
export const HORIZON_W = 300;
export const HORIZON_PAD = 10;
export const HORIZON_LABELS = ['Now', 'Next', 'Later'] as const;

/**
 * The Now / Next / Later columns for `today` (a day number): Now is the period holding today — a
 * month on a day or week scale, a quarter on a month or quarter scale — Next the period after it,
 * Later everything from then on. `starts` are the first days of Next and Later.
 */
export function horizonsOf(scale: TimelineScale, today: number): { now: number; next: number; later: number; labels: [string, string, string] } {
  const p = parts(today);
  const quarter = scale === 'month' || scale === 'quarter';
  const step = quarter ? 3 : 1;
  const m0 = quarter ? p.m - (p.m % 3) : p.m;
  const now = dayFromParts(p.y, m0);
  const next = dayFromParts(p.y, m0 + step);
  const later = dayFromParts(p.y, m0 + step * 2);
  const name = (day: number) => {
    const q = parts(day);
    return quarter ? `Q${Math.floor(q.m / 3) + 1} ${q.y}` : `${MONTHS[q.m]} ${q.y}`;
  };
  return { now, next, later, labels: [name(now), name(next), `from ${name(later)}`] };
}

/** The column (0 Now, 1 Next, 2 Later) a bar starting on `start` sits in. */
export const horizonOf = (h: { next: number; later: number }, start: number): 0 | 1 | 2 => (start < h.next ? 0 : start < h.later ? 1 : 2);

/** The column under element-local x in the horizons view. */
export const horizonAt = (x: number): 0 | 1 | 2 => Math.max(0, Math.min(2, Math.floor((x - LABEL_W) / HORIZON_W))) as 0 | 1 | 2;

/** The first day a bar moved into a column gets: today for Now, else the column's first day. */
export const horizonStart = (h: { next: number; later: number }, col: 0 | 1 | 2, today: number): number => (col === 0 ? today : col === 1 ? h.next : h.later);

export type Member = TimelineBarElement | CardElement;
export const isMemberType = (el: BoardElement): el is Member => el.type === 'timelinebar' || el.type === 'card';

const r2 = (v: number) => Math.round(v * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

export interface Grid {
  ppd: number;
  startDay: number;
  endDay: number;
  w: number;
  h: number;
  /** Lane tops / heights, element-local. */
  laneTops: number[];
  laneHeights: number[];
}

export const laneRows = (lane: TimelineLane): number => Math.max(MIN_ROWS, Math.floor(lane.rows ?? MIN_ROWS));
export const laneHeight = (lane: TimelineLane): number => LANE_PAD * 2 + laneRows(lane) * ROW_H;

export function gridOf(t: Pick<TimelineElement, 'start' | 'end' | 'scale' | 'lanes'> & { view?: TimelineElement['view'] }): Grid {
  const ppd = PX_PER_DAY[t.scale] ?? PX_PER_DAY.week;
  const startDay = dayOf(t.start);
  const endDay = Math.max(startDay, dayOf(t.end));
  const laneTops: number[] = [];
  const laneHeights: number[] = [];
  let y = HEAD_H;
  for (const lane of t.lanes) {
    laneTops.push(y);
    const h = laneHeight(lane);
    laneHeights.push(h);
    y += h;
  }
  const w = t.view === 'horizons' ? LABEL_W + 3 * HORIZON_W : r2(LABEL_W + (endDay - startDay + 1) * ppd);
  return { ppd, startDay, endDay, w, h: y, laneTops, laneHeights };
}

/** Element-local x of the START of `day`. */
export const dayX = (g: Grid, day: number): number => LABEL_W + (day - g.startDay) * g.ppd;
/** The day under element-local x. */
export const dayAt = (g: Grid, x: number): number => g.startDay + Math.floor((x - LABEL_W) / g.ppd);

/** Lane index under element-local y (clamped to the first / last lane). */
export function laneAt(g: Grid, y: number): number {
  for (let i = g.laneTops.length - 1; i >= 0; i--) if (y >= g.laneTops[i]) return i;
  return 0;
}

/** The box of a bar with these dates, element-local x / w: clipped to the range, a stub when outside. */
export function barSpan(g: Grid, start: number, end: number, milestone: boolean): { x: number; w: number; clipped: 'start' | 'end' | 'both' | null } {
  if (milestone) {
    const cx = dayX(g, start) + g.ppd / 2;
    if (start < g.startDay) return { x: LABEL_W, w: STUB_W, clipped: 'start' };
    if (start > g.endDay) return { x: r2(g.w - STUB_W), w: STUB_W, clipped: 'end' };
    return { x: r2(cx - BAR_H / 2), w: BAR_H, clipped: null };
  }
  if (end < g.startDay) return { x: LABEL_W, w: STUB_W, clipped: 'start' };
  if (start > g.endDay) return { x: r2(g.w - STUB_W), w: STUB_W, clipped: 'end' };
  const a = Math.max(start, g.startDay);
  const b = Math.min(end, g.endDay);
  const clipped = start < g.startDay && end > g.endDay ? 'both' : start < g.startDay ? 'start' : end > g.endDay ? 'end' : null;
  return { x: r2(dayX(g, a)), w: r2((b - a + 1) * g.ppd), clipped };
}

/** A member's dates (a card's: its start / due dates), or null when it has none yet. */
export function datesOf(el: Member, scale: TimelineScale): { start: string; end: string } | null {
  if (el.type === 'timelinebar') return isISODate(el.start) && isISODate(el.end) ? { start: el.start, end: el.end } : null;
  if (!isISODate(el.dueDate)) return null;
  const start = isISODate(el.startDate) && el.startDate <= el.dueDate ? el.startDate : addDays(el.dueDate, -(DEFAULT_DAYS[scale] - 1));
  return { start, end: el.dueDate };
}

const isMilestone = (el: Member) => el.type === 'timelinebar' && !!el.milestone;

export interface MemberInput {
  el: Member;
  /** As it was before the local change: undefined = untouched, null = created by it. */
  prev: BoardElement | null | undefined;
}

export interface TimelinePlan {
  /** The timeline's own fields to rewrite (range, size, lane rows), or null. */
  own: Partial<TimelineElement> | null;
  /** Member boxes (and a bar's dates) to rewrite. */
  patches: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Card dates to set through the card feature (`card.setDates`): cards keep one writer. */
  cardDates: Array<{ id: string; startDate: string; dueDate: string }>;
}

/**
 * The timeline as resized by its handles: a left-edge drag moves the start, a right-edge drag the
 * end, by whole days; anything else (a move, a height drag) keeps the range.
 */
function rangeAfterResize(t: TimelineElement, prevT: TimelineElement | null): { start: string; end: string; x: number } {
  const same = { start: t.start, end: t.end, x: t.x };
  if (!prevT || prevT.start !== t.start || prevT.end !== t.end || prevT.scale !== t.scale || near(prevT.w, t.w)) return same;
  const ppd = PX_PER_DAY[t.scale];
  const dl = t.x - prevT.x;
  const dr = t.x + t.w - (prevT.x + prevT.w);
  let start = dayOf(prevT.start);
  let end = dayOf(prevT.end);
  if (!near(dl, 0)) start += Math.round(dl / ppd);
  if (!near(dr, 0)) end += Math.round(dr / ppd);
  // Never shorter than a week, never longer than the cap; the edge that was dragged gives way.
  if (end - start + 1 < MIN_DAYS) {
    if (!near(dl, 0)) start = end - MIN_DAYS + 1;
    else end = start + MIN_DAYS - 1;
  }
  if (end - start + 1 > MAX_DAYS) {
    if (!near(dl, 0)) start = end - MAX_DAYS + 1;
    else end = start + MAX_DAYS - 1;
  }
  return { start: isoOf(start), end: isoOf(end), x: r2(prevT.x + (start - dayOf(prevT.start)) * ppd) };
}

/**
 * Lays timeline `t` out. `prevT`: the timeline before the local change (null: untouched or new).
 * Members are its bars and cards (`frameId` = t.id); `left` are members that just left it.
 */
export function planTimeline(t: TimelineElement, prevT: TimelineElement | null, members: MemberInput[], left: Member[] = [], today?: number): TimelinePlan {
  const horizons = t.view === 'horizons';
  // Switching views lays every bar out afresh (rows by date); otherwise bars keep their rows.
  const switched = !!prevT && (prevT.view ?? 'dates') !== (t.view ?? 'dates');
  const hz = horizonsOf(t.scale, today ?? dayOf(t.start));
  const range = horizons ? { start: t.start, end: t.end, x: t.x } : rangeAfterResize(t, prevT);
  const lanes = t.lanes.length ? t.lanes : [{ id: 'lane', title: '', color: '#F1F0F5' }];
  const g = gridOf({ ...t, ...range, lanes });
  // Where untouched members were: against the timeline as it was (lanes reordered, added, removed).
  const before = prevT ?? t;
  const gp = gridOf({ ...before, lanes: before.lanes.length ? before.lanes : lanes });
  const cardDates: TimelinePlan['cardDates'] = [];
  const scale = t.scale;

  interface Placed {
    m: Member;
    start: number;
    end: number;
    lane: number;
    row: number;
    x: number;
    w: number;
    moved: boolean;
  }
  const placed: Placed[] = [];
  for (const { el, prev } of members) {
    const joined = prev === null || (prev !== undefined && prev.frameId !== t.id);
    const was = prev && !joined ? (prev as Member) : null;
    let dates = datesOf(el, scale);
    const relX = el.x - range.x;
    const relY = el.y + el.h / 2 - t.y;
    if (joined && !dates) {
      // A card with no dates lands as a bar centered on the day it was dropped at.
      const n = DEFAULT_DAYS[scale];
      const s = horizons ? horizonStart(hz, horizonAt(relX + el.w / 2), today ?? hz.now) : dayAt(g, relX + el.w / 2) - Math.floor(n / 2);
      dates = { start: isoOf(s), end: isoOf(s + n - 1) };
    }
    if (!dates) continue;
    let start = dayOf(dates.start);
    let end = dayOf(dates.end);
    let movedY = joined;
    if (was) {
      const prevDates = datesOf(was, scale);
      const datesEdited = !prevDates || prevDates.start !== dates.start || prevDates.end !== dates.end;
      const wasX = was.x - (prevT ?? t).x;
      const dl = relX - wasX;
      const dr = relX + el.w - (wasX + was.w);
      // The person moved or resized the bar: read the change back as whole days (horizons: a
      // move into another column starts it there, same length; within a column nothing changes).
      if (horizons && !switched) {
        const to = horizonAt(relX + el.w / 2);
        if (!datesEdited && !near(dl, 0) && to !== horizonOf(hz, start)) {
          const shift = horizonStart(hz, to, today ?? hz.now) - start;
          start += shift;
          end += shift;
        }
      } else if (!datesEdited && !switched && (!near(dl, 0) || !near(dr, 0))) {
        if (isMilestone(el) || near(el.w, was.w)) {
          const shift = Math.round(dl / g.ppd);
          start += shift;
          end += shift;
        } else {
          start += Math.round(dl / g.ppd);
          end += Math.round(dr / g.ppd);
          if (start > end) [start, end] = near(dl, 0) ? [start, start] : [end, end];
        }
      }
      movedY = !near(el.y + el.h / 2 - t.y, was.y + was.h / 2 - (prevT ?? t).y);
    }
    if (isMilestone(el)) end = start;
    // Lane and row: where it was dropped, or where it was before the change.
    let lane: number;
    let row: number;
    if (movedY) {
      lane = laneAt(g, relY);
      row = Math.floor((relY - g.laneTops[lane] - LANE_PAD) / ROW_H);
    } else {
      const wasRelY = was ? was.y + was.h / 2 - (prevT ?? t).y : relY;
      const i = laneAt(gp, wasRelY);
      const id = before.lanes[i]?.id;
      const j = lanes.findIndex((l) => l.id === id);
      lane = j >= 0 ? j : Math.min(i, lanes.length - 1);
      row = Math.floor((wasRelY - gp.laneTops[i] - LANE_PAD) / ROW_H);
    }
    const span = horizons ? horizonSpan(horizonOf(hz, start), isMilestone(el)) : barSpan(g, start, end, isMilestone(el));
    placed.push({ m: el, start, end, lane, row: switched ? 0 : Math.max(0, row), x: span.x, w: span.w, moved: movedY && !switched });
  }

  // Rows: members that stayed keep theirs; a dropped one takes the nearest free row to where it
  // was dropped. Deterministic order, so every client plans the same.
  const order = [...placed].sort((a, b) => Number(a.moved) - Number(b.moved) || a.lane - b.lane || a.row - b.row || a.x - b.x || a.start - b.start || (a.m.id < b.m.id ? -1 : 1));
  const taken = new Map<string, Array<[number, number]>>();
  const free = (lane: number, row: number, x: number, w: number) => !(taken.get(`${lane}:${row}`) ?? []).some(([a, b]) => x < b + GAP && a < x + w + GAP);
  for (const p of order) {
    let row = p.row;
    if (!free(p.lane, row, p.x, p.w))
      for (let d = 1; d < 500; d++) {
        if (free(p.lane, p.row + d, p.x, p.w)) {
          row = p.row + d;
          break;
        }
        if (p.row - d >= 0 && free(p.lane, p.row - d, p.x, p.w)) {
          row = p.row - d;
          break;
        }
      }
    p.row = row;
    const key = `${p.lane}:${row}`;
    taken.set(key, [...(taken.get(key) ?? []), [p.x, p.x + p.w]]);
  }

  if (horizons) {
    // A column is a list: its bars stack from the top in their order (a dropped one where it was dropped).
    const cols = new Map<string, Placed[]>();
    for (const p of placed) {
      const key = `${p.lane}:${p.x}`;
      cols.set(key, [...(cols.get(key) ?? []), p]);
    }
    for (const list of cols.values()) list.sort((a, b) => a.row - b.row || a.start - b.start || (a.m.id < b.m.id ? -1 : 1)).forEach((p, i) => (p.row = i));
  }

  const nextLanes = lanes.map((lane, i) => {
    const used = placed.filter((p) => p.lane === i).reduce((m, p) => Math.max(m, p.row + 1), 0);
    const rows = Math.max(MIN_ROWS, used);
    return rows === lane.rows ? lane : { ...lane, rows };
  });
  const g2 = gridOf({ ...t, ...range, lanes: nextLanes });

  const own: Partial<TimelineElement> = {};
  if (range.start !== t.start) own.start = range.start;
  if (range.end !== t.end) own.end = range.end;
  if (!near(range.x, t.x)) own.x = range.x;
  if (!near(g2.w, t.w)) own.w = g2.w;
  if (!near(g2.h, t.h)) own.h = g2.h;
  if (nextLanes.some((l, i) => l !== t.lanes[i]) || nextLanes.length !== t.lanes.length) own.lanes = nextLanes;

  const patches: TimelinePlan['patches'] = [];
  for (const p of placed) {
    const x = r2(range.x + p.x);
    const y = r2(t.y + g2.laneTops[p.lane] + LANE_PAD + p.row * ROW_H + (ROW_H - BAR_H) / 2);
    const patch: Record<string, unknown> = {};
    if (!near(p.m.x, x)) patch.x = x;
    if (!near(p.m.y, y)) patch.y = y;
    if (!near(p.m.w, p.w)) patch.w = p.w;
    if (!near(p.m.h, BAR_H)) patch.h = BAR_H;
    const startDate = isoOf(p.start);
    const endDate = isoOf(p.end);
    if (p.m.type === 'timelinebar') {
      if (p.m.start !== startDate) patch.start = startDate;
      if (p.m.end !== endDate) patch.end = endDate;
    } else if (p.m.startDate !== startDate || p.m.dueDate !== endDate) {
      cardDates.push({ id: p.m.id, startDate, dueDate: endDate });
    }
    if (p.m.z <= t.z) patch.z = t.z + 1 + placed.indexOf(p) / 1000;
    if (Object.keys(patch).length) patches.push({ id: p.m.id, patch });
  }
  // A card leaving the timeline becomes a card again: card-wide, its height its own.
  for (const c of left) if (c.type === 'card' && c.h < 48) patches.push({ id: c.id, patch: { w: CARD_BACK.w, h: CARD_BACK.h } });

  return { own: Object.keys(own).length ? own : null, patches, cardDates };
}

/** A bar's box in the horizons view (element-local x / w): the column, less its padding. */
function horizonSpan(col: 0 | 1 | 2, milestone: boolean): { x: number; w: number } {
  const x = LABEL_W + col * HORIZON_W + HORIZON_PAD;
  return { x, w: milestone ? BAR_H : HORIZON_W - HORIZON_PAD * 2 };
}

/** Days of a timeline at a scale, extended so the range still reads (switching to a coarser scale). */
export function rangeFor(scale: TimelineScale, start: string, end: string): { start: string; end: string } {
  const s = dayOf(start);
  const e = Math.max(dayOf(end), s + MIN_RANGE[scale] - 1);
  return { start, end: isoOf(Math.min(e, s + MAX_DAYS - 1)) };
}
