// A kanban's view tabs (docs/design/kanban-fields-and-views.md, steps 3a and 3b): the same cards
// seen as a board, a table, a list, a calendar or a timeline. A kanban keeps its saved tabs in
// `views` (the board view of views.ts and any number of projection views) and the tab everyone
// starts on in `activeView`. Only the BOARD tab places the real cards; every other tab is a
// projection that draws the cards itself, from the live elements, and never moves them (its edits
// go through card.setValues like any other).
//
// Saved vs personal (owner decision 2): which tab a person looks at, and a projection's settings
// (filter, sort, columns, grouping, its date fields, scale, swimlanes), are theirs (personal view
// state, never in the doc) until an editor presses "Save for everyone"; then they become the saved
// tab and settings everyone starts from. A projection's filter really leaves cards out (a
// projection moves no shared geometry, so nothing to keep in place for anyone), unlike a person's
// own filter on the board, which only fades cards.
//
// Read-time and deterministic like the rest of the views: a kanban without `views` has one tab,
// "Board"; malformed entries are skipped; entries of layouts this code doesn't know (a later
// step's gallery) are kept as they are when the tabs are written, and so is `activeView` when it
// names one of them. Older clients read only the layouts they know (3a: board and table;
// `storedBoardView` before it: the board) and keep the other entries when they save theirs, so
// they never lose a tab.
//
// Pure: the kanban feature, the outline and the server's configure_view / query_cards read tabs
// only through here.
import type { BoardElement, CardElement, KanbanElement, TimelineScale } from './elements';
import { STATUS_OPTIONS, builtinValue, cardValue, collectionSchema, groupFieldId, isGroupable, isMember, type FieldDef, type FieldValue } from './fields';
import { manualOrderOf } from './layout/kanban';
import { cardPasses, cleanFilter, cleanSort, sameFilter, sortCards, type SortRule, type ViewFilter } from './query';
import { BOARD_VIEW_ID, VIEW_LIMITS, boardView, type ViewConfig } from './views';

export type ViewLayout = 'board' | 'table' | 'list' | 'calendar' | 'timeline';
/** The layouts that draw the cards themselves (every tab but the board). */
export type ProjectionLayout = Exclude<ViewLayout, 'board'>;
export const PROJECTION_LAYOUTS: readonly ProjectionLayout[] = ['table', 'list', 'calendar', 'timeline'];
export const isProjectionLayout = (v: unknown): v is ProjectionLayout => typeof v === 'string' && (PROJECTION_LAYOUTS as readonly string[]).includes(v);
/** A tab's name when it has none, and what "+ View" offers. */
export const LAYOUT_NAMES: Record<ViewLayout, string> = { board: 'Board', table: 'Table', list: 'List', calendar: 'Calendar', timeline: 'Timeline' };

interface ProjectionBase {
  id: string;
  name: string;
  /** Which cards it shows (the others are left out of this tab only; the board is untouched). */
  filter?: ViewFilter | null;
  /** Their order (a table's rows, a list's within each group, a day's cards, a timeline's rows); empty: the board's order (a timeline: by start). */
  sort?: SortRule[];
  /** Locked by an editor: nobody else changes the saved tab (their own settings still work). */
  locked?: { by: string } | null;
}

/** A saved table tab: the kanban's cards as rows, one column per field. */
export interface TableViewConfig extends ProjectionBase {
  layout: 'table';
  /** Fields shown as columns after the title, in order (custom or built-in ids); absent: `defaultTableColumns`. */
  columns?: string[];
}

/** A list tab (3b): compact rows (the title and a few fields), grouped by a field. */
export interface ListViewConfig extends ProjectionBase {
  layout: 'list';
  /** Fields shown after the title; absent: those the board's cards show. */
  columns?: string[];
  /** The field rows are grouped by (any single select, person or checkbox, the card's status or assignee); absent: as the board; null: no groups. */
  groupBy?: string | null;
}

/** A calendar tab (3b): a month (or week) of days, each card on the day its date field says. */
export interface CalendarViewConfig extends ProjectionBase {
  layout: 'calendar';
  /** The date field cards sit on: '$due' (default), '$start' or a custom date field. */
  date?: string;
}

/** A timeline tab (3b): a bar per card from its start to its end date, on a scale, optionally in swimlanes. */
export interface TimelineViewConfig extends ProjectionBase {
  layout: 'timeline';
  /** Where a bar starts: '$start' (default) or a date field. */
  start?: string;
  /** Where it ends: '$due' (default) or a date field. */
  end?: string;
  scale?: TimelineScale;
  /** Swimlanes by this field (single select, person, checkbox, status or assignee); absent / null: none. */
  lanesBy?: string | null;
}

export type ProjectionView = TableViewConfig | ListViewConfig | CalendarViewConfig | TimelineViewConfig;

/** One stored entry of `KanbanElement.views`. */
export type SavedView = ViewConfig | ProjectionView;

export interface ViewTab {
  id: string;
  name: string;
  layout: ViewLayout;
}

/** A person's own changes to a projection tab (personal view state, under the tab's id): any of its settings. */
export interface ProjectionOverride {
  columns?: string[];
  filter?: ViewFilter | null;
  sort?: SortRule[];
  groupBy?: string | null;
  date?: string;
  start?: string;
  end?: string;
  scale?: TimelineScale;
  lanesBy?: string | null;
}
/** A person's own changes to a table tab. */
export type TableOverride = Pick<ProjectionOverride, 'columns' | 'filter' | 'sort'>;

/** The settings each layout has (what a person may change for themselves, and what "Save for everyone" saves). */
export const LAYOUT_SETTINGS: Record<ProjectionLayout, ReadonlyArray<keyof ProjectionOverride>> = {
  table: ['columns', 'filter', 'sort'],
  list: ['columns', 'groupBy', 'filter', 'sort'],
  calendar: ['date', 'filter', 'sort'],
  timeline: ['start', 'end', 'scale', 'lanesBy', 'filter', 'sort'],
};

/**
 * Personal view state keys a kanban uses besides its tabs' ids (`Editor.getPersonalView(kanbanId,
 * key)`): which tab I look at (`{ tab }`), and my focus-mode settings. Tab ids never start with "_".
 */
export const MY_TAB_KEY = '_tab';
export const FOCUS_KEY = '_focus';

/** Fields a table shows when its tab names none: the kanban's own fields, then the assignee and due date. */
export const DEFAULT_TABLE_BUILTINS: readonly string[] = ['$assignee', '$due'];

export const TIMELINE_SCALES: readonly TimelineScale[] = ['day', 'week', 'month', 'quarter'];
const isTabId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= VIEW_LIMITS.id && v !== '__proto__' && !v.startsWith('_');
const isFieldId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= VIEW_LIMITS.id && v !== '__proto__';
const cleanName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, VIEW_LIMITS.name) : fallback);
const cleanIds = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= VIEW_LIMITS.id && x !== '__proto__'))].slice(0, VIEW_LIMITS.show) : undefined;
const cleanLock = (raw: unknown): { by: string } | undefined => {
  const by = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).by : undefined;
  return typeof by === 'string' && by.length > 0 && by.length <= VIEW_LIMITS.id ? { by } : undefined;
};

type TabSource = Pick<KanbanElement, 'views' | 'activeView' | 'colorCards' | 'columns'> & { fields?: unknown };

/**
 * Layout `layout`'s settings from `r` (anything malformed dropped). Field ids are only checked for
 * shape here: a field deleted later is read past (`calendarDateField`, `timelineFields`, …).
 * `keepEmpty`: an emptied filter or sort is kept (a person's "no filter" over a saved one).
 */
function cleanSettings(layout: ProjectionLayout, r: Record<string, unknown>, opts: { personal?: boolean; keepEmpty?: boolean } = {}): ProjectionOverride {
  const out: ProjectionOverride = {};
  for (const key of LAYOUT_SETTINGS[layout]) {
    if (!Object.hasOwn(r, key)) continue;
    const v = r[key];
    switch (key) {
      case 'columns': {
        const ids = cleanIds(v);
        if (ids) out.columns = ids;
        break;
      }
      case 'filter': {
        // A person's own filter may say "is me": a projection leaves cards out for them only.
        const f = cleanFilter(v, { personal: opts.personal });
        if (f || opts.keepEmpty) out.filter = f;
        break;
      }
      case 'sort': {
        const sort = Array.isArray(v) ? cleanSort(v) : [];
        if (sort.length || (opts.keepEmpty && Array.isArray(v))) out.sort = sort;
        break;
      }
      case 'groupBy':
      case 'lanesBy':
        if (v === null) out[key] = null;
        else if (isFieldId(v)) out[key] = v;
        break;
      case 'date':
      case 'start':
      case 'end':
        if (isFieldId(v)) out[key] = v;
        break;
      case 'scale':
        if (TIMELINE_SCALES.includes(v as TimelineScale)) out.scale = v as TimelineScale;
        break;
    }
  }
  return out;
}

/** A stored projection entry (table, list, calendar, timeline) as a projection view (anything malformed dropped); null when it isn't one. */
export function cleanProjection(raw: unknown): ProjectionView | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || !isProjectionLayout(r.layout) || !isTabId(r.id)) return null;
  const layout = r.layout;
  const locked = cleanLock(r.locked);
  return {
    id: r.id,
    name: cleanName(r.name, LAYOUT_NAMES[layout]),
    layout,
    ...cleanSettings(layout, r),
    ...(locked ? { locked } : {}),
  } as ProjectionView;
}

/** A stored table entry as a table view; null when it isn't one. */
export function cleanTableView(raw: unknown): TableViewConfig | null {
  const v = cleanProjection(raw);
  return v && v.layout === 'table' ? v : null;
}

const tabsCache = new WeakMap<object, ViewTab[]>();

/**
 * The kanban's tabs, in order: the board tab (always one; first when none is stored) and its
 * projection tabs. Tabs of layouts this code doesn't know are left out (they stay stored).
 */
export function viewTabs(k: TabSource): ViewTab[] {
  const cached = tabsCache.get(k);
  if (cached) return cached;
  const board = boardView(k);
  const out: ViewTab[] = [];
  const seen = new Set<string>();
  let hasBoard = false;
  for (const raw of Array.isArray(k.views) ? (k.views as unknown[]) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (r.layout === 'board') {
      // The board view the kanban lays its cards out by (views.ts); any other board entry is skipped.
      const id = typeof r.id === 'string' && r.id ? r.id : BOARD_VIEW_ID;
      if (hasBoard || id !== board.id) continue;
      hasBoard = true;
      seen.add(board.id);
      out.push({ id: board.id, name: board.name, layout: 'board' });
      continue;
    }
    const t = cleanProjection(r);
    if (!t || seen.has(t.id) || t.id === board.id) continue;
    seen.add(t.id);
    out.push({ id: t.id, name: t.name, layout: t.layout });
    if (out.length >= VIEW_LIMITS.views) break;
  }
  if (!hasBoard) out.unshift({ id: board.id, name: board.name, layout: 'board' });
  tabsCache.set(k, out);
  return out;
}

/** The tab everyone starts on: `activeView` when it names a tab, else the board tab. */
export function savedTabId(k: TabSource): string {
  const tabs = viewTabs(k);
  return tabs.find((t) => t.id === k.activeView)?.id ?? tabs.find((t) => t.layout === 'board')!.id;
}

/** The tab this person looks at: their own choice (`{ tab }` under MY_TAB_KEY) while it is still a tab, else the saved one. */
export function shownTabId(k: TabSource, mine: unknown): string {
  const want = mine && typeof mine === 'object' ? (mine as Record<string, unknown>).tab : undefined;
  return typeof want === 'string' && viewTabs(k).some((t) => t.id === want) ? want : savedTabId(k);
}

/** A tab by id, or by name (case and spaces ignored), as people and agents name them. */
export function tabByRef(k: TabSource, ref: string): ViewTab | undefined {
  const tabs = viewTabs(k);
  const key = ref.trim().toLowerCase();
  return tabs.find((t) => t.id === ref) ?? tabs.find((t) => t.name.trim().toLowerCase() === key);
}

/** Projection tab `id` (any layout but the board) as saved; null when the kanban has no such tab. */
export function projectionView(k: TabSource, id: string): ProjectionView | null {
  const tab = viewTabs(k).find((t) => t.id === id);
  if (!tab || tab.layout === 'board') return null;
  for (const raw of Array.isArray(k.views) ? (k.views as unknown[]) : []) {
    const t = cleanProjection(raw);
    if (t && t.id === id && t.layout === tab.layout) return t;
  }
  return null;
}

/** Table tab `id` as saved; null when the kanban has no such table tab. */
export function tableView(k: TabSource, id: string): TableViewConfig | null {
  const v = projectionView(k, id);
  return v && v.layout === 'table' ? v : null;
}

const fieldExists = (schema: readonly FieldDef[]) => (id: string) => (id.startsWith('$') ? id !== '$title' : schema.some((f) => f.id === id));

/** The fields table `view` shows as columns after the title: those it names that exist, else the default. */
export function tableColumns(view: Pick<TableViewConfig, 'columns'>, schema: readonly FieldDef[]): string[] {
  if (view.columns) return view.columns.filter(fieldExists(schema));
  return [...schema.map((f) => f.id), ...DEFAULT_TABLE_BUILTINS];
}

/** The fields a list's rows show after the title: those it names that exist, else what the board's cards show. */
export function listColumns(k: TabSource, view: Pick<ListViewConfig, 'columns'>, schema: readonly FieldDef[]): string[] {
  return (view.columns ?? boardView(k).card?.show ?? []).filter(fieldExists(schema));
}

// ------------------------------------------------------------------ what a projection's settings name

/** Built-in fields a projection may group by (it moves no real card, so the card's own status and assignee may). */
export const PROJECTION_GROUP_BUILTINS: readonly FieldDef[] = [
  { id: '$status', name: 'Status', type: 'select', options: STATUS_OPTIONS },
  { id: '$assignee', name: 'Assignee', type: 'person' },
];

/** Fields a list (or focus mode) can group by, and a timeline's swimlanes be made of: the kanban's single selects, people and checkboxes, then status and assignee. */
export function projectionGroupFields(schema: readonly FieldDef[]): FieldDef[] {
  return [...schema.filter(isGroupable), ...PROJECTION_GROUP_BUILTINS];
}

/** A card's value for a field a projection groups by (the card's own status / assignee too). */
export function projectionGroupValue(k: KanbanElement, card: CardElement, f: FieldDef): FieldValue | null {
  return f.id === '$status' || f.id === '$assignee' ? builtinValue(card, f.id) : cardValue(k, card, f);
}

/** The built-in date fields cards have. */
export const DATE_BUILTINS: readonly FieldDef[] = [
  { id: '$due', name: 'Due date', type: 'date' },
  { id: '$start', name: 'Start date', type: 'date' },
];

/** Fields a calendar or a timeline can place cards by: the card's due and start dates, then the kanban's date fields. */
export function dateFields(schema: readonly FieldDef[]): FieldDef[] {
  return [...DATE_BUILTINS, ...schema.filter((f) => f.type === 'date')];
}

const dateRef = (schema: readonly FieldDef[], ref: string | undefined, fallback: string) => (ref && dateFields(schema).some((f) => f.id === ref) ? ref : fallback);

/** The date field calendar `view` places cards on (a deleted one reads as the due date). */
export const calendarDateField = (view: Pick<CalendarViewConfig, 'date'>, schema: readonly FieldDef[]): string => dateRef(schema, view.date, '$due');

/** Where timeline `view`'s bars start and end, its scale and its swimlane field (deleted fields read past). */
export function timelineFields(
  view: Pick<TimelineViewConfig, 'start' | 'end' | 'scale' | 'lanesBy'>,
  schema: readonly FieldDef[],
): { start: string; end: string; scale: TimelineScale; lanes: FieldDef | null } {
  return {
    start: dateRef(schema, view.start, '$start'),
    end: dateRef(schema, view.end, '$due'),
    scale: view.scale ?? 'week',
    lanes: (view.lanesBy && projectionGroupFields(schema).find((f) => f.id === view.lanesBy)) || null,
  };
}

/** The field list `view` groups its rows by (absent: as the board; null or a deleted field: none). */
export function listGroupField(k: TabSource, view: Pick<ListViewConfig, 'groupBy'>, schema: readonly FieldDef[]): FieldDef | null {
  const id = view.groupBy === undefined ? groupFieldId(k) : view.groupBy;
  return (id && projectionGroupFields(schema).find((f) => f.id === id)) || null;
}

// ------------------------------------------------------------------ personal changes to a projection tab

/** A personal override of a `layout` tab as stored (anything else dropped), or null when it changes nothing. */
export function cleanProjectionOverride(layout: ProjectionLayout, raw: unknown): ProjectionOverride | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const out = cleanSettings(layout, r, { personal: true, keepEmpty: true });
  return Object.keys(out).length ? out : null;
}

/** A personal table override as stored, or null when it changes nothing. */
export const cleanTableOverride = (raw: unknown): TableOverride | null => cleanProjectionOverride('table', raw);

/** Projection tab `view` as this person sees it: their override on top of the saved tab. */
export function withProjectionOverride<V extends ProjectionView>(view: V, override: unknown): V {
  const o = cleanProjectionOverride(view.layout, override);
  return o ? { ...view, ...o } : view;
}
export const withTableOverride = (view: TableViewConfig, override: unknown): TableViewConfig => withProjectionOverride(view, override);

/** The override that turns saved projection tab `saved` into `mine` (null: none). */
export function projectionOverrideBetween(saved: ProjectionView, mine: ProjectionView): ProjectionOverride | null {
  const out: Record<string, unknown> = {};
  const s = saved as unknown as Record<string, unknown>;
  const m = mine as unknown as Record<string, unknown>;
  for (const key of LAYOUT_SETTINGS[saved.layout]) {
    if (key === 'filter') {
      if (!sameFilter(mine.filter, saved.filter)) out.filter = mine.filter ?? null;
    } else if (key === 'sort') {
      if (JSON.stringify(mine.sort ?? []) !== JSON.stringify(saved.sort ?? [])) out.sort = [...(mine.sort ?? [])];
    } else if (m[key] !== undefined && JSON.stringify(m[key]) !== JSON.stringify(s[key])) {
      // null ("no groups", "no swimlanes") differs from absent ("as the board").
      out[key] = Array.isArray(m[key]) ? [...(m[key] as unknown[])] : m[key];
    }
  }
  return Object.keys(out).length ? (out as ProjectionOverride) : null;
}
export const tableOverrideBetween = (saved: TableViewConfig, mine: TableViewConfig): TableOverride | null => projectionOverrideBetween(saved, mine);

// ------------------------------------------------------------------ the rows

/**
 * The cards a projection tab shows, in its order: every card in the kanban (folded-away ones too:
 * a projection hides nothing the board folds), in the board's order (column by column, top to
 * bottom) unless the tab is sorted, without the ones its filter leaves out. `me`: who "is me"
 * means.
 */
export function tableRows(k: KanbanElement, all: readonly BoardElement[], view: Pick<ProjectionBase, 'filter' | 'sort'>, ctx: { me?: string } = {}): CardElement[] {
  const schema = collectionSchema(k);
  const order = new Map(manualOrderOf(k, all).map((id, i) => [id, i]));
  const last = order.size;
  let rows = all.filter((el): el is CardElement => isMember(k, el));
  rows.sort((a, b) => (order.get(a.id) ?? last) - (order.get(b.id) ?? last) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (view.filter) rows = rows.filter((c) => cardPasses(k, c, view.filter, schema, ctx));
  if (view.sort?.length) rows = sortCards(k, rows, view.sort, schema);
  return rows;
}
export const projectionRows = tableRows;

// ------------------------------------------------------------------ writing tabs

type ViewsPatch = Pick<KanbanElement, 'views' | 'activeView'>;

/**
 * The stored entries to write back: everything stored kept as it is (tabs of unknown layouts
 * too), with the board view written out first when the kanban had none stored yet (its synthesised
 * settings, so the board reads the same as before).
 */
function stored(k: TabSource): SavedView[] {
  const list = Array.isArray(k.views) ? (k.views as unknown[]).filter((v): v is SavedView => !!v && typeof v === 'object') : [];
  return list.some((v) => v.layout === 'board') ? list : [boardView(k), ...list];
}

/**
 * The `activeView` to write back: as stored while it names a stored entry — a tab of a layout this
 * code doesn't know too (a newer client's), so everyone stays on it —, else the saved tab.
 */
function keptActive(k: TabSource, views: readonly SavedView[]): string {
  const a = k.activeView;
  return typeof a === 'string' && views.some((v) => (v as { id?: unknown }).id === a) ? a : savedTabId(k);
}

/** A tab name not taken yet on the kanban: `base`, else "base 2", "base 3"… */
export function freeTabName(k: TabSource, base = 'Table'): string {
  const taken = new Set(viewTabs(k).map((t) => t.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Why `name` can't name a tab of `k` (other than `selfId`), or null. */
export function tabNameProblem(k: TabSource, name: string, selfId?: string): string | null {
  const n = name.trim();
  if (!n) return 'A tab needs a name';
  if (n.length > VIEW_LIMITS.name) return `At most ${VIEW_LIMITS.name} characters`;
  if (viewTabs(k).some((t) => t.id !== selfId && t.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a tab called “${n}”`;
  return null;
}

/** `views` with projection tab `tab` added at the end (null when the kanban has as many tabs as it may). */
export function withProjectionTab(k: TabSource, tab: ProjectionView): ViewsPatch | null {
  const list = stored(k);
  if (viewTabs(k).length >= VIEW_LIMITS.views || list.length >= VIEW_LIMITS.views || list.some((v) => (v as { id?: unknown }).id === tab.id)) return null;
  const views = [...list, tab];
  return { views, activeView: keptActive(k, views) };
}
export const withTableTab = (k: TabSource, tab: TableViewConfig): ViewsPatch | null => withProjectionTab(k, tab);

/** `views` with projection tab `view` saved in place of the stored one of the same id and layout. */
export function withProjectionSaved(k: TabSource, view: ProjectionView): ViewsPatch {
  const views = stored(k).map((v) => (v.layout === view.layout && v.id === view.id ? view : v));
  return { views, activeView: keptActive(k, views) };
}
export const withTableSaved = (k: TabSource, view: TableViewConfig): ViewsPatch => withProjectionSaved(k, view);

/** `views` without projection tab `id` (null for the board tab or no such tab); a saved tab that goes falls back to the board. */
export function withoutTab(k: TabSource, id: string): ViewsPatch | null {
  const tab = viewTabs(k).find((t) => t.id === id);
  if (!tab || tab.layout === 'board') return null;
  const views = stored(k).filter((v) => !(v.layout === tab.layout && v.id === id));
  return { views, activeView: k.activeView === id ? boardView(k).id : keptActive(k, views) };
}

/** `views` with tab `id` renamed (the board tab too); null when there is no such tab. */
export function withTabRenamed(k: TabSource, id: string, name: string): ViewsPatch | null {
  const tab = viewTabs(k).find((t) => t.id === id);
  if (!tab) return null;
  const n = name.trim().slice(0, VIEW_LIMITS.name);
  const board = boardView(k).id;
  const views = stored(k).map((v) => ((tab.layout === 'board' ? v.layout === 'board' && (v.id ?? BOARD_VIEW_ID) === board : v.layout === tab.layout && v.id === id) ? { ...v, name: n } : v));
  return { views, activeView: keptActive(k, views) };
}

/** `activeView` set to tab `id` (the tab everyone starts on); null when there is no such tab. */
export function withSavedTab(k: TabSource, id: string): ViewsPatch | null {
  if (!viewTabs(k).some((t) => t.id === id)) return null;
  return { views: stored(k), activeView: id };
}
