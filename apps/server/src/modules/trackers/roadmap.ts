// Roadmap mode (KAI-160): tracker issues imported onto a timeline. Each issue becomes a linked task
// card that the timeline draws as a bar (cards keep one writer; dates sync both ways through the
// link like any card's), in a lane per team, epic or label, laid out by the timeline's own shared
// rule (`timelineLayout.planTimeline`) in the same change. Issues without dates go to an
// "Unscheduled" frame under the timeline — skipped in presentations — instead of being dropped;
// dragging one onto the timeline gives it dates there. Pure over a BoardView.
import {
  findFreeSpot,
  frameDraft,
  plainToRichText,
  richTextToPlain,
  rotatedBounds,
  ROADMAP_NO_GROUP,
  roadmapLaneOf,
  timelineLayout as T,
  type ElementDraft,
  type RoadmapGroupBy,
  type TimelineElement,
  type TimelineLane,
} from '@freero/shared';
import type { BoardView } from '../realtime/index';
import type { RemoteIssue } from './providers/index';

export interface RoadmapCard {
  /** The card's id (the link's source). */
  id: string;
  issue: RemoteIssue;
  /** The card as a grid import would make it (importedCard): fields, size. */
  draft: ElementDraft;
}

export interface RoadmapPlan {
  create: ElementDraft[];
  update: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Cards that had no dates (in the Unscheduled frame). */
  unscheduled: number;
}

const GRID_GAP = 24;
const FRAME_PAD = 40;

/** An issue's dates as a bar: start..due; only one of them makes a one-day bar. Null: no dates. */
export function issueSpan(issue: RemoteIssue): { start: string; end: string } | null {
  const s = issue.values.startDate && T.isISODate(issue.values.startDate) ? issue.values.startDate : null;
  const d = issue.values.dueDate && T.isISODate(issue.values.dueDate) ? issue.values.dueDate : null;
  if (!s && !d) return null;
  if (s && d) return s <= d ? { start: s, end: d } : { start: d, end: s };
  return { start: (s ?? d)!, end: (s ?? d)! };
}

/**
 * Puts `cards` onto timeline `t`: lanes by `groupBy` (matched by name, missing ones added), the
 * range grown to hold every date, dated cards laid out at their dates, the rest in a new
 * "Unscheduled" frame below. `today`: a day number (Now / Next / Later).
 */
export function planRoadmapImport(
  view: Pick<BoardView, 'elements'>,
  t: TimelineElement,
  cards: RoadmapCard[],
  ctx: { groupBy: RoadmapGroupBy; today: number; newId(): string; frameIndex: number },
): RoadmapPlan {
  const dated = cards.flatMap((c) => {
    const span = issueSpan(c.issue);
    return span ? [{ c, span }] : [];
  });
  const undated = cards.filter((c) => !issueSpan(c.issue));

  // Lanes: one per group name, matched to existing lanes by their text. An empty timeline's lanes
  // (the starter ones) give way to the groups.
  const empty = !view.elements.some((e) => e.el.frameId === t.id && T.isMemberType(e.el));
  const lanes: TimelineLane[] = empty && ctx.groupBy !== 'none' && dated.length ? [] : [...t.lanes];
  const laneIndex = (name: string | null): number => {
    if (!name) return 0;
    const key = name.trim().toLowerCase();
    const at = lanes.findIndex((l) => richTextToPlain(l.title).trim().toLowerCase() === key);
    if (at >= 0) return at;
    lanes.push({ id: ctx.newId(), title: plainToRichText(name), color: T.LANE_COLORS[lanes.length % T.LANE_COLORS.length], rows: T.MIN_ROWS });
    return lanes.length - 1;
  };
  const laneOfCard = new Map<string, number>();
  for (const { c } of dated) {
    const name = ctx.groupBy === 'none' ? null : (roadmapLaneOf(ctx.groupBy, c.issue.groups, c.issue.values.labels) ?? ROADMAP_NO_GROUP[ctx.groupBy]);
    laneOfCard.set(c.id, laneIndex(name));
  }

  // The range grows to hold every imported date (never past the timeline's cap).
  let start = T.dayOf(t.start);
  let end = T.dayOf(t.end);
  for (const { span } of dated) {
    start = Math.min(start, T.dayOf(span.start));
    end = Math.max(end, T.dayOf(span.end));
  }
  if (end - start + 1 > T.MAX_DAYS) end = start + T.MAX_DAYS - 1;
  const t2: TimelineElement = { ...t, lanes, start: T.isoOf(start), end: T.isoOf(end) };
  const g = T.gridOf(t2);

  // New cards join the timeline in their lane (planTimeline reads the lane from where they are).
  const drafts = new Map<string, Record<string, unknown>>();
  for (const { c, span } of dated) {
    const lane = laneOfCard.get(c.id) ?? 0;
    drafts.set(c.id, {
      ...(c.draft as unknown as Record<string, unknown>),
      startDate: span.start,
      dueDate: span.end,
      frameId: t.id,
      x: t.x + T.LABEL_W,
      y: t.y + g.laneTops[lane] + T.LANE_PAD + (T.ROW_H - T.BAR_H) / 2,
      w: 120,
      h: T.BAR_H,
    });
  }
  const members: T.MemberInput[] = [
    ...view.elements.map((e) => e.el).filter((el) => el.frameId === t.id && T.isMemberType(el)).map((el) => ({ el: el as T.Member, prev: undefined })),
    ...[...drafts.values()].map((d) => ({ el: d as unknown as T.Member, prev: null })),
  ];
  const plan = T.planTimeline(t2, null, members, [], ctx.today);
  const update: RoadmapPlan['update'] = [];
  for (const p of plan.patches) {
    const d = drafts.get(p.id);
    if (d) {
      const { z: _z, ...rest } = p.patch;
      Object.assign(d, rest);
    } else update.push(p);
  }
  const own: Record<string, unknown> = { ...(plan.own ?? {}) };
  if (!own.lanes && (lanes.length !== t.lanes.length || lanes.some((l, i) => l !== t.lanes[i]))) own.lanes = lanes;
  if (t2.start !== t.start) own.start = t2.start;
  if (t2.end !== t.end) own.end = t2.end;
  if (Object.keys(own).length) update.unshift({ id: t.id, patch: own });

  const create: ElementDraft[] = [...drafts.values()] as unknown as ElementDraft[];

  // The Unscheduled tray: a frame under the timeline, its cards in a grid.
  if (undated.length) {
    const cols = Math.min(4, undated.length);
    const heights = undated.map((c) => c.draft.h);
    const rowH = Math.max(...heights) + GRID_GAP;
    const rows = Math.ceil(undated.length / cols);
    const cardW = undated[0].draft.w;
    const size = { w: cols * (cardW + GRID_GAP) - GRID_GAP + FRAME_PAD * 2, h: rows * rowH - GRID_GAP + FRAME_PAD * 2 };
    const timelineH = (own.h as number | undefined) ?? t.h;
    const wanted = { x: t.x, y: t.y + timelineH + 120 };
    const obstacles = view.elements.filter((e) => e.el.id !== t.id && e.el.frameId !== t.id).map((e) => rotatedBounds(e.el));
    const at = findFreeSpot(obstacles, size, { x: wanted.x + size.w / 2, y: wanted.y + size.h / 2 }, 40);
    const frameId = ctx.newId();
    const title = `Unscheduled · ${richTextToPlain(t.title).trim() || 'Roadmap'}`;
    create.push({ ...frameDraft(frameId, { x: at.x, y: at.y, ...size }, title), fill: '#F4F3F8', index: ctx.frameIndex, skip: true } as unknown as ElementDraft);
    undated.forEach((c, n) =>
      create.push({
        ...c.draft,
        frameId,
        x: at.x + FRAME_PAD + (n % cols) * (cardW + GRID_GAP),
        y: at.y + FRAME_PAD + Math.floor(n / cols) * rowH,
      } as ElementDraft),
    );
  }
  return { create, update, unscheduled: undated.length };
}
