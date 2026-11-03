// Focus mode's settings (steps 3a, 3b; design §7): how I arrange a kanban's cards when I open it as
// a page of its own — as a table, a list, a calendar or a timeline; grouped by any field (the
// card's own status and assignee too), compact or comfortable rows, my filter and sort, the fields
// I want as columns, the date fields a calendar or timeline places cards by, a timeline's scale
// and swimlanes. Mine alone, in any role: personal view state (FOCUS_KEY, kept through
// Host.personalViews), never the board doc, so nothing moves on the shared board and nobody
// else's focus mode changes. Steps 2b and 2c kept grouping and density shared on the canvas,
// because there they move the real cards; here they only arrange rows.
import {
  FOCUS_KEY,
  TIMELINE_SCALES,
  boardView,
  calendarDateField,
  cleanFilter,
  cleanSort,
  collectionSchema,
  dateFields,
  groupFieldId,
  groupKeyOf,
  groupKeys,
  groupTitle,
  isProjectionLayout,
  listGroupField,
  projectionGroupFields,
  projectionGroupValue,
  sortCards,
  cardPasses,
  isStackable,
  manualOrderOf,
  timelineFields,
  type CardElement,
  type FieldDef,
  type KanbanElement,
  type ProjectionLayout,
  type ProjectionView,
  type SortRule,
  type TimelineScale,
  type ViewFilter,
} from '@freero/shared';
import type { Editor } from '@engine';
import type { GridEntry } from './Grid';

export type FocusDensity = 'compact' | 'comfortable';

export interface FocusSettings {
  /** How the page draws the cards. */
  layout: ProjectionLayout;
  /** The field rows are grouped by (null: no groups). */
  groupBy: string | null;
  density: FocusDensity;
  filter: ViewFilter | null;
  sort: SortRule[];
  /** Fields shown as columns after the title; null: those the board's cards show. */
  columns: string[] | null;
  /** A calendar's date field. */
  date: string;
  /** A timeline's start and end date fields, scale and swimlanes. */
  start: string;
  end: string;
  scale: TimelineScale;
  lanesBy: string | null;
}

/** Fields focus mode can group by: the kanban's single selects, people and checkboxes, then the card's status and assignee. */
export const focusGroupFields = projectionGroupFields;

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && v !== '__proto__';

/**
 * My focus-mode settings for kanban `k`: what I stored (anything malformed dropped), the rest from
 * the tab I look at (`tab`, as I see it, when it isn't the board: its layout and settings) or else
 * the board — grouped as the board is, its saved filter and sort — and comfortable rows on phones,
 * compact ones elsewhere.
 */
export function focusSettings(k: KanbanElement, raw: unknown, opts: { phone?: boolean; tab?: ProjectionView | null } = {}): FocusSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const board = boardView(k);
  const schema = collectionSchema(k);
  const tab = opts.tab ?? null;
  const fields = focusGroupFields(schema);
  const dates = dateFields(schema);
  const tl = timelineFields(tab?.layout === 'timeline' ? tab : {}, schema);
  const fallbackGroup = tab?.layout === 'list' ? (listGroupField(k, tab, schema)?.id ?? null) : groupFieldId(k);
  const groupBy = r.groupBy === null ? null : isId(r.groupBy) && fields.some((f) => f.id === r.groupBy) ? r.groupBy : fallbackGroup;
  const dateOr = (v: unknown, fallback: string) => (isId(v) && dates.some((f) => f.id === v) ? v : fallback);
  const lanes = r.lanesBy === null ? null : isId(r.lanesBy) && fields.some((f) => f.id === r.lanesBy) ? r.lanesBy : (tl.lanes?.id ?? null);
  const columns = Array.isArray(r.columns) ? r.columns.filter(isId).slice(0, 40) : tab && (tab.layout === 'table' || tab.layout === 'list') && tab.columns ? tab.columns : null;
  return {
    // Phones read a kanban as a list; elsewhere the board opens as a table.
    layout: isProjectionLayout(r.layout) ? r.layout : (tab?.layout ?? (opts.phone ? 'list' : 'table')),
    groupBy,
    density: r.density === 'compact' || r.density === 'comfortable' ? r.density : opts.phone ? 'comfortable' : 'compact',
    filter: Object.hasOwn(r, 'filter') ? cleanFilter(r.filter, { personal: true }) : tab ? (tab.filter ?? null) : (board.filter ?? null),
    sort: Array.isArray(r.sort) ? cleanSort(r.sort) : tab ? (tab.sort ?? []) : (board.sort ?? []),
    columns,
    date: dateOr(r.date, tab?.layout === 'calendar' ? calendarDateField(tab, schema) : '$due'),
    start: dateOr(r.start, tl.start),
    end: dateOr(r.end, tl.end),
    scale: TIMELINE_SCALES.includes(r.scale as TimelineScale) ? (r.scale as TimelineScale) : tl.scale,
    lanesBy: lanes,
  };
}

/** Changes my focus-mode settings of kanban `kid` (any role; only for me). */
export function setFocus(editor: Editor, kid: string, patch: Partial<FocusSettings>) {
  const cur = editor.getPersonalView(kid, FOCUS_KEY) ?? {};
  editor.setPersonalView(kid, FOCUS_KEY, { ...cur, ...patch });
}

/** Back to the board's arrangement (my focus-mode settings dropped). */
export const resetFocus = (editor: Editor, kid: string) => editor.setPersonalView(kid, FOCUS_KEY, null);

/**
 * The rows a grouped projection shows (focus mode, a list tab): the kanban's cards the filter
 * keeps, in the sort (else the board's order), under a header row per group when grouped — groups
 * in the field's order, people in the order the board meets them, empty groups left out. `me`:
 * who "is me" means.
 */
export function focusEntries(
  k: KanbanElement,
  cards: readonly CardElement[],
  s: Pick<FocusSettings, 'groupBy' | 'filter' | 'sort'>,
  ctx: { me: string; personName?: (id: string) => string | undefined },
): { entries: GridEntry[]; shown: number; group: FieldDef | null } {
  const schema = collectionSchema(k);
  const order = new Map(manualOrderOf(k, cards).map((id, i) => [id, i]));
  let rows = [...cards].sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) || (isStackable(a, k.id) ? 0 : 1) - (isStackable(b, k.id) ? 0 : 1));
  if (s.filter) rows = rows.filter((c) => cardPasses(k, c, s.filter, schema, { me: ctx.me }));
  if (s.sort.length) rows = sortCards(k, rows, s.sort, schema);
  const f = s.groupBy ? focusGroupFields(schema).find((x) => x.id === s.groupBy) : undefined;
  if (!f) return { entries: rows.map((card) => ({ kind: 'card', card })), shown: rows.length, group: null };
  const byKey = new Map<string, CardElement[]>();
  for (const c of rows) {
    const key = groupKeyOf(f, projectionGroupValue(k, c, f));
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const entries: GridEntry[] = [];
  for (const key of groupKeys(f, byKey.keys())) {
    const list = byKey.get(key);
    if (!list?.length) continue;
    const color = f.type === 'select' ? f.options?.find((o) => o.id === key)?.color : undefined;
    entries.push({ kind: 'group', key, title: groupTitle(f, key, ctx.personName), count: list.length, ...(color ? { color } : {}) });
    for (const card of list) entries.push({ kind: 'card', card });
  }
  return { entries, shown: rows.length, group: f };
}
