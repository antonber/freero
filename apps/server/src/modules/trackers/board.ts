// The board side of a link: reading its items as TrackerSources, the patches that write a
// tracker's change back onto them, the badge record, conflict notes and imported cards. Pure over
// a BoardView (realtime's): writes go through realtime's changeBoard in sync.ts / service.ts.
import {
  estimateNumber,
  isStatusCategory,
  issueValuesFromBoard,
  KANBAN_LAYOUT,
  measureText,
  plainToRichText,
  richTextToPlain,
  TRACKER_PROVIDERS,
  type BoardElement,
  type CardElement,
  type CommentMessageRecord,
  type CommentThreadRecord,
  type ElementDraft,
  type IssueField,
  type IssueValues,
  type KanbanElement,
  type Tag,
  type TrackerIssueRecord,
  type TrackerSource,
} from '@freero/shared';
import type { BoardView } from '../realtime/index';
import type { RemoteIssue, TrackerProvider } from './providers/index';
import type { StoredConnection } from './repo';

/** Items that can stand for (part of) an issue: they hold text. */
export const SENDABLE_TYPES = new Set(['sticky', 'card', 'shape', 'text', 'mindmap']);
const TAGGABLE = new Set(['sticky', 'card']);
const TAG_COLOR = '#5B3FF0';

export const itemUrl = (origin: string, boardId: string, id: string) => `${origin}/board/${encodeURIComponent(boardId)}?item=${encodeURIComponent(id)}`;

const tagsOf = (view: Pick<BoardView, 'collection'>) => view.collection('tags') as ReadonlyMap<string, Tag>;

function textOf(el: BoardElement): string {
  const e = el as unknown as Record<string, unknown>;
  if (el.type === 'card') return richTextToPlain(String((e.description as string) ?? ''));
  return typeof e.text === 'string' ? richTextToPlain(e.text) : '';
}

/** One item as a TrackerSource. `emailOf`: a person's (verified) email by user id. */
export function sourceOf(el: BoardElement, tags: ReadonlyMap<string, Tag>, emailOf: (userId: string) => string | null): TrackerSource {
  const e = el as unknown as Record<string, unknown>;
  const tagNames = Array.isArray(e.tags) ? (e.tags as unknown[]).flatMap((id) => (typeof id === 'string' && tags.get(id)?.name ? [tags.get(id)!.name] : [])) : [];
  if (el.type === 'card') {
    const c = el as CardElement;
    return {
      id: el.id,
      type: el.type,
      title: richTextToPlain(String(c.title ?? '')).trim(),
      text: textOf(el),
      tags: tagNames,
      card: {
        status: isStatusCategory(c.status) ? c.status : null,
        assignee: c.assigneeId ? emailOf(c.assigneeId) : null,
        dueDate: typeof c.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.dueDate) ? c.dueDate.slice(0, 10) : null,
        estimate: estimateNumber(c.estimate),
      },
    };
  }
  const text = textOf(el);
  return {
    id: el.id,
    type: el.type,
    title:
      text
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? '',
    text,
    tags: tagNames,
  };
}

/** How far above a cluster its heading may sit (world units). */
const HEADING_REACH = 120;

/**
 * What a cluster of items is called: the title of the frame they all share, else a heading — a
 * text box just above them that overlaps them sideways (how "Cluster" and people lay groups out).
 */
export function clusterHeading(view: Pick<BoardView, 'elements'>, items: BoardElement[]): string | null {
  if (items.length < 2) return null;
  const f = items[0].frameId;
  if (f && items.every((el) => el.frameId === f)) {
    const frame = view.elements.find((e) => e.el.id === f)?.el as (BoardElement & { title?: unknown }) | undefined;
    if (frame?.type === 'frame' && typeof frame.title === 'string' && frame.title.trim()) return frame.title.trim();
  }
  const ids = new Set(items.map((el) => el.id));
  const left = Math.min(...items.map((el) => el.x));
  const right = Math.max(...items.map((el) => el.x + el.w));
  const top = Math.min(...items.map((el) => el.y));
  let best: { text: string; gap: number } | null = null;
  for (const { el } of view.elements) {
    if (el.type !== 'text' || ids.has(el.id)) continue;
    const gap = top - (el.y + el.h);
    if (gap < -10 || gap > HEADING_REACH || el.x >= right || el.x + el.w <= left) continue;
    const text = textOf(el).split('\n').map((l) => l.trim()).find(Boolean);
    if (text && (!best || gap < best.gap)) best = { text, gap };
  }
  return best?.text ?? null;
}

/** What the board's items say about the issue, in this tracker's terms (its fields, its labels). */
export function boardValues(provider: TrackerProvider, sources: TrackerSource[], ctx: { heading: string | null; itemUrl(id: string): string }): IssueValues {
  const all = issueValuesFromBoard(sources, {
    heading: ctx.heading,
    itemUrl: ctx.itemUrl,
  });
  const out: IssueValues = {};
  for (const f of provider.fields) if (all[f] !== undefined) (out as Record<string, unknown>)[f] = all[f];
  if (out.labels) out.labels = [...new Set(out.labels.map(provider.label).filter(Boolean))];
  return out;
}

/** Fields the preview lists as not carried over (the tracker has no such field, or the value doesn't map). */
export function unmappedOf(provider: TrackerProvider, sources: TrackerSource[]): string[] {
  const out: string[] = [];
  const card = sources.find((s) => s.card)?.card;
  const name = TRACKER_PROVIDERS[provider.kind];
  const has = (f: IssueField) => provider.fields.includes(f);
  if (card) {
    if (card.assignee && !has('assignee')) out.push(`Assignee (${name} issues aren’t assigned from Freero)`);
    if (card.dueDate && !has('dueDate')) out.push(`Due date (${name} has no due date Freero can set)`);
    if (card.estimate !== null && !has('estimate')) out.push(`Estimate (${name} has no estimate Freero can set)`);
  }
  if (sources.length > 1 && sources.filter((s) => s.card).length > 1) out.push('Status, assignee, due date and estimate come from the first card only');
  return out;
}

// ---- writing the tracker's changes back ----

export interface PullPlan {
  update: Array<{ id: string; patch: Record<string, unknown> }>;
  /** New tags the tracker's labels need (the `tags` collection). */
  tags: Record<string, Tag>;
  notes: string[];
}

/** Where a card goes in a kanban: the bottom of the first column with that status, or null. */
function kanbanSpot(view: Pick<BoardView, 'elements'>, card: BoardElement, status: string, moving: Set<string>): { x: number; y: number } | null {
  if (!card.frameId) return null;
  const k = view.elements.find((e) => e.el.id === card.frameId)?.el as KanbanElement | undefined;
  if (!k || k.type !== 'kanban' || !Array.isArray(k.columns)) return null;
  const col = k.columns.findIndex((c) => c.status === status);
  if (col < 0) return null;
  const { gap, pad, itemGap, headerH, colHeadH } = KANBAN_LAYOUT;
  const left = k.x + gap + col * (k.colW + gap);
  const inCol = (el: BoardElement) => el.frameId === k.id && el.id !== card.id && !moving.has(el.id) && el.x + el.w / 2 >= left && el.x + el.w / 2 < left + k.colW;
  const now = Math.floor((card.x + card.w / 2 - k.x - gap / 2) / (k.colW + gap));
  if (now === col) return null;
  const bottom = view.elements
    .map((e) => e.el)
    .filter(inCol)
    .reduce((m, el) => Math.max(m, el.y + el.h), k.y + headerH + colHeadH + pad - itemGap);
  return { x: left + pad, y: bottom + itemGap };
}

/**
 * The patches that write `pull` (the tracker's values) onto the link's items, as `fields` allows:
 * a card's or a single item's title and description, every card's task fields (a card in a kanban
 * moves to the column of its new status), and labels as tag changes on every tagged item.
 */
export function planPull(
  view: Pick<BoardView, 'elements' | 'collection'>,
  items: BoardElement[],
  pull: IssueValues,
  ctx: {
    fields: Set<IssueField>;
    provider: TrackerProvider;
    /** The labels the tracker had before (to tell which were added or removed there). */
    previousLabels: string[];
    userIdOf(email: string): string | null;
    newId(): string;
  },
): PullPlan {
  const patches = new Map<string, Record<string, unknown>>();
  const patch = (id: string, p: Record<string, unknown>) => patches.set(id, { ...(patches.get(id) ?? {}), ...p });
  const notes: string[] = [];
  const name = TRACKER_PROVIDERS[ctx.provider.kind];
  const cards = items.filter((el) => el.type === 'card');
  const single = items.length === 1 ? items[0] : null;

  if (pull.title !== undefined && ctx.fields.has('title') && single) {
    if (single.type === 'card') patch(single.id, { title: plainToRichText(pull.title) });
    else patch(single.id, { text: plainToRichText(pull.title) });
  }
  if (pull.description !== undefined && ctx.fields.has('description') && single?.type === 'card') patch(single.id, { description: plainToRichText(pull.description) });
  if (pull.status !== undefined && ctx.fields.has('status') && pull.status) {
    const moving = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      patch(c.id, { status: pull.status });
      const spot = kanbanSpot(view, c, pull.status, moving);
      if (spot) patch(c.id, spot);
    }
  }
  if (pull.assignee !== undefined && ctx.fields.has('assignee')) {
    if (pull.assignee === null) for (const c of cards) patch(c.id, { assigneeId: null });
    else {
      const userId = pull.assignee.startsWith('~') ? null : ctx.userIdOf(pull.assignee);
      if (userId) for (const c of cards) patch(c.id, { assigneeId: userId });
      else notes.push(`The ${name} assignee isn’t someone on this board${pull.assignee.startsWith('~') ? '' : ` (${pull.assignee})`}, so the card’s assignee stayed.`);
    }
  }
  if (pull.dueDate !== undefined && ctx.fields.has('dueDate')) for (const c of cards) patch(c.id, { dueDate: pull.dueDate });
  if (pull.estimate !== undefined && ctx.fields.has('estimate'))
    for (const c of cards)
      patch(c.id, {
        estimate: pull.estimate === null ? null : String(pull.estimate),
      });

  const tags: Record<string, Tag> = {};
  if (pull.labels !== undefined && ctx.fields.has('labels')) {
    const key = (l: string) => ctx.provider.label(l).toLowerCase();
    const before = new Set(ctx.previousLabels.map(key));
    const after = new Set(pull.labels.map(key));
    const added = pull.labels.filter((l) => !before.has(key(l)));
    const removed = new Set([...before].filter((l) => !after.has(l)));
    const all = tagsOf(view);
    const idFor = (label: string): string => {
      for (const [id, t] of all) if (t?.name && key(t.name) === key(label)) return id;
      for (const [id, t] of Object.entries(tags)) if (key(t.name) === key(label)) return id;
      const id = ctx.newId();
      tags[id] = { id, name: label, color: TAG_COLOR };
      return id;
    };
    for (const el of items) {
      if (!TAGGABLE.has(el.type)) continue;
      const cur = Array.isArray((el as { tags?: unknown }).tags) ? (el as { tags: string[] }).tags : [];
      const kept = cur.filter((id) => !(all.get(id)?.name && removed.has(key(all.get(id)!.name))));
      const next = [...kept];
      for (const l of added) {
        const id = idFor(l);
        if (!next.includes(id)) next.push(id);
      }
      if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) patch(el.id, { tags: next });
    }
  }
  return {
    update: [...patches].map(([id, p]) => ({ id, patch: p })),
    tags,
    notes,
  };
}

/** The items as they will be once `plan` is applied (to read the board's values after a pull). */
export function applied(items: BoardElement[], plan: PullPlan): BoardElement[] {
  const byId = new Map(plan.update.map((u) => [u.id, u.patch]));
  return items.map((el) => (byId.has(el.id) ? ({ ...el, ...byId.get(el.id) } as BoardElement) : el));
}

export function tagsWith(view: Pick<BoardView, 'collection'>, extra: Record<string, Tag>): ReadonlyMap<string, Tag> {
  return new Map([...tagsOf(view), ...Object.entries(extra)]);
}

// ---- the badge ----

export function badgeOf(
  conn: Pick<StoredConnection, 'provider' | 'name'>,
  link: { key: string; url: string; sources: string[] },
  issue: RemoteIssue | null,
  state: TrackerIssueRecord['state'],
  note: string | null,
  previous?: TrackerIssueRecord | null,
): TrackerIssueRecord {
  return {
    provider: conn.provider,
    connection: conn.name,
    key: issue?.key ?? link.key,
    url: issue?.url ?? link.url,
    title: issue?.values.title ?? previous?.title ?? '',
    status: issue ? (issue.values.statusName ?? null) : (previous?.status ?? null),
    statusCategory: issue ? (issue.values.status ?? null) : (previous?.statusCategory ?? null),
    assignee: issue ? issue.assigneeName : (previous?.assignee ?? null),
    sources: link.sources,
    state,
    note,
    syncedAt: Date.now(),
  };
}

/** Same badge apart from when it was written (no board write needed). */
export const sameBadge = (a: TrackerIssueRecord | null | undefined, b: TrackerIssueRecord): boolean =>
  !!a && JSON.stringify({ ...a, syncedAt: 0 }) === JSON.stringify({ ...b, syncedAt: 0 });

// ---- notes ----

/** A comment thread pinned to `el` with one message: what the sync couldn't do, in Freero's words. */
export function noteThread(
  el: BoardElement,
  author: { id: string; name: string; color?: string },
  text: string,
  ids: { thread: string; message: string },
  now = Date.now(),
): Record<string, CommentThreadRecord | CommentMessageRecord> {
  const thread: CommentThreadRecord = {
    kind: 'thread',
    id: ids.thread,
    x: 0,
    y: 0,
    elementId: el.id,
    corner: 'top-right',
    origin: { x: el.x + el.w, y: el.y },
    createdAt: now,
    createdBy: author.id,
  };
  const message: CommentMessageRecord = {
    kind: 'message',
    threadId: ids.thread,
    id: ids.message,
    authorId: author.id,
    authorName: author.name,
    ...(author.color ? { authorColor: author.color } : {}),
    text,
    createdAt: now,
  };
  return {
    [`t:${ids.thread}`]: thread,
    [`m:${ids.thread}:${ids.message}`]: message,
  };
}

// ---- imported cards ----

export const CARD_W = 300;

export function cardHeight(title: string, description: string): number {
  const t = measureText(title || ' ', {
    fontSize: 16,
    maxWidth: CARD_W - 40,
    bold: true,
    lineHeight: 1.35,
  }).h;
  const dh = description
    ? Math.min(
        66,
        measureText(description, {
          fontSize: 14,
          maxWidth: CARD_W - 40,
          lineHeight: 1.4,
        }).h,
      ) + 8
    : 0;
  return Math.round(18 + t + dh + 12 + 28 + 14);
}

/** A task card for an imported issue, linked to it. */
export function importedCard(
  id: string,
  at: { x: number; y: number },
  issue: RemoteIssue,
  ctx: {
    linkId: string;
    assigneeId: string | null;
    tagIds: string[];
    h: number;
  },
): ElementDraft {
  return {
    id,
    type: 'card',
    x: at.x,
    y: at.y,
    w: CARD_W,
    h: ctx.h,
    rotation: 0,
    title: plainToRichText(issue.values.title || issue.key),
    description: plainToRichText(issue.values.description.slice(0, 5000)),
    color: TAG_COLOR,
    status: issue.values.status ?? 'todo',
    dueDate: issue.values.dueDate ?? null,
    assigneeId: ctx.assigneeId,
    estimate: issue.values.estimate === null || issue.values.estimate === undefined ? null : String(issue.values.estimate),
    tags: ctx.tagIds,
    trackerLink: ctx.linkId,
  } as unknown as ElementDraft;
}
