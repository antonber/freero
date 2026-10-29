// Timeline edits. Each writes the timeline (or creates a bar) in one step; the timeline's arrange
// pass then lays every bar out again at its dates, lanes and rows (lib/layout.ts).
import { nanoid } from 'nanoid';
import type { TimelineBarElement, TimelineElement, TimelineLane, TimelineScale } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { addDays, dayOf, isISODate, isoOf, localDay, mondayOf } from './dates';
import { BAR_H, DEFAULT_DAYS, HORIZON_PAD, HORIZON_W, LABEL_W, LANE_COLORS, LANE_PAD, ROW_H, barSpan, dayAt, gridOf, horizonAt, horizonStart, horizonsOf, laneAt, rangeFor } from './layout';

/** Lane header tints, in the order new lanes take them (shared with roadmap imports on the server). */
export { LANE_COLORS };
/** Bar colours (Freero's accents). */
export const BAR_COLORS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#F5A524', '#F97316', '#E5484D', '#E64DA6', '#8A89A3'];

const lane = (title: string, i: number): TimelineLane => ({ id: nanoid(8), title, color: LANE_COLORS[i % LANE_COLORS.length], rows: 2 });

/** A new timeline centered on `at`: eight weeks from this week's Monday, by week, three lanes. */
export function newTimeline(at: Point, nowMs: number): NewElement<'timeline'> {
  const start = isoOf(mondayOf(dayOf(localDay(nowMs))));
  const fields = { title: 'Roadmap', start, end: addDays(start, 8 * 7 - 1), scale: 'week' as const, lanes: ['Planning', 'Build', 'Launch'].map(lane) };
  const { w, h } = gridOf(fields);
  return { type: 'timeline', ...fields, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h };
}

function fresh(editor: Editor, id: string): TimelineElement | null {
  const el = editor.getElement<TimelineElement>(id);
  return el && el.type === 'timeline' && !el.locked ? el : null;
}

export function setScale(editor: Editor, id: string, scale: TimelineScale): void {
  const t = fresh(editor, id);
  if (!t || t.scale === scale) return;
  editor.update<TimelineElement>(id, { scale, ...rangeFor(scale, t.start, t.end) });
}

/** Moves the range's first or last day (the other stays); bars stay at their dates. */
export function setRange(editor: Editor, id: string, patch: { start?: string; end?: string }): void {
  const t = fresh(editor, id);
  if (!t) return;
  const start = patch.start && isISODate(patch.start) ? patch.start : t.start;
  const end = patch.end && isISODate(patch.end) ? patch.end : t.end;
  if (end < start) return;
  editor.update<TimelineElement>(id, rangeFor(t.scale, start, end));
}

export function addLane(editor: Editor, id: string, index?: number): string | null {
  const t = fresh(editor, id);
  if (!t) return null;
  const at = Math.max(0, Math.min(t.lanes.length, index ?? t.lanes.length));
  const l = lane('New lane', t.lanes.length);
  editor.update<TimelineElement>(id, { lanes: [...t.lanes.slice(0, at), l, ...t.lanes.slice(at)] });
  return l.id;
}

/** Removes a lane; its bars move into the lane before it (or after it, for the first). */
export function removeLane(editor: Editor, id: string, laneId: string): void {
  const t = fresh(editor, id);
  if (!t || t.lanes.length < 2) return;
  editor.update<TimelineElement>(id, { lanes: t.lanes.filter((l) => l.id !== laneId) });
}

export function moveLane(editor: Editor, id: string, laneId: string, dir: -1 | 1): void {
  const t = fresh(editor, id);
  if (!t) return;
  const list = [...t.lanes];
  const i = list.findIndex((l) => l.id === laneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  editor.update<TimelineElement>(id, { lanes: list });
}

export function patchLane(editor: Editor, id: string, laneId: string, patch: Partial<Omit<TimelineLane, 'id'>>): void {
  const t = fresh(editor, id);
  if (!t) return;
  editor.update<TimelineElement>(id, { lanes: t.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)) });
}

export const lanePart = (laneId: string) => `lane:${laneId}`;
export const parseLanePart = (part: string | null): string | null => part?.match(/^lane:(.+)$/)?.[1] ?? null;

export function renameLane(editor: Editor, id: string, laneId: string): void {
  editor.select([id]);
  editor.startEditing(id, { part: lanePart(laneId), selectAll: true });
}

/**
 * A new bar (or milestone) on timeline `id`: in the lane and on the day under `at` (world point),
 * else in the first lane from the range's start (or today, when that is in range). The timeline
 * lays it out; the title is ready to type.
 */
export function addBar(editor: Editor, id: string, opts: { at?: Point; milestone?: boolean; color?: string } = {}): string | null {
  const t = fresh(editor, id);
  if (!t || !editor.mayAdd('timelinebar')) return null;
  const g = gridOf(t);
  const today = dayOf(localDay(editor.host.serverNow()));
  const local = opts.at ? { x: opts.at.x - t.x, y: opts.at.y - t.y } : null;
  const horizons = t.view === 'horizons';
  const hz = horizonsOf(t.scale, today);
  const day = horizons
    ? horizonStart(hz, local ? horizonAt(local.x) : 0, today)
    : local
      ? dayAt(g, local.x)
      : today >= g.startDay && today <= g.endDay
        ? today
        : g.startDay;
  const laneIndex = local ? laneAt(g, local.y) : 0;
  const n = opts.milestone ? 1 : DEFAULT_DAYS[t.scale];
  const startDay = horizons ? day : Math.max(g.startDay, Math.min(day, g.endDay - n + 1));
  const span = horizons ? { x: LABEL_W + horizonAt(local?.x ?? LABEL_W) * HORIZON_W + HORIZON_PAD, w: HORIZON_W - HORIZON_PAD * 2 } : barSpan(g, startDay, startDay + n - 1, !!opts.milestone);
  const rowY = local ? local.y - BAR_H / 2 : g.laneTops[laneIndex] + LANE_PAD + (ROW_H - BAR_H) / 2;
  const bar: NewElement<'timelinebar'> = {
    type: 'timelinebar',
    title: '',
    start: isoOf(startDay),
    end: isoOf(startDay + n - 1),
    color: opts.color ?? BAR_COLORS[0],
    ...(opts.milestone ? { milestone: true } : {}),
    x: t.x + span.x,
    y: t.y + rowY,
    w: span.w,
    h: BAR_H,
    frameId: t.id,
  };
  const barId = editor.create<'timelinebar'>(bar, { select: true });
  if (barId) editor.startEditing(barId);
  return barId;
}

export function patchBars(editor: Editor, bars: TimelineBarElement[], patch: Partial<TimelineBarElement>): void {
  editor.updateMany(bars.map((b) => ({ id: b.id, patch })));
}

/** Dates on an axis, or the roadmap's Now / Next / Later columns (KAI-160). One undo step. */
export function setView(editor: Editor, id: string, view: 'dates' | 'horizons'): void {
  const t = fresh(editor, id);
  if (!t || (t.view ?? 'dates') === view) return;
  editor.update<TimelineElement>(id, { view });
}
