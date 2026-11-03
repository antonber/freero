// A kanban's view tabs (docs/design/kanban-fields-and-views.md, step 3a): the same cards seen as a
// board or as a table. A kanban keeps its saved tabs in `views` (the board view of views.ts and
// any number of table views) and the tab everyone starts on in `activeView`. Only the BOARD tab
// places the real cards; a table tab is a projection that draws the cards itself, from the live
// elements, and never moves them (its edits go through card.setValues like any other).
//
// Saved vs personal (owner decision 2): which tab a person looks at, and a table tab's filter,
// sort and columns, are theirs (personal view state, never in the doc) until an editor presses
// "Save for everyone"; then they become the saved tab and settings everyone starts from. A table
// tab's filter really leaves rows out (a projection moves no shared geometry, so nothing to keep
// in place for anyone), unlike a person's own filter on the board, which only fades cards.
//
// Read-time and deterministic like the rest of the views: a kanban without `views` has one tab,
// "Board"; malformed entries are skipped; entries of layouts this code doesn't know (a later
// step's calendar) are kept as they are when the tabs are written. Older clients read only the
// board view (`storedBoardView`: the active one when it is a board, else the first board) and keep
// the other entries when they save theirs (`savedViews`), so they never lose a tab.
//
// Pure: the kanban feature, the outline and the server's configure_view / query_cards read tabs
// only through here.
import type { BoardElement, CardElement, KanbanElement } from './elements';
import { collectionSchema, isMember, type FieldDef } from './fields';
import { manualOrderOf } from './layout/kanban';
import { cardPasses, cleanFilter, cleanSort, sameFilter, sortCards, type SortRule, type ViewFilter } from './query';
import { BOARD_VIEW_ID, VIEW_LIMITS, boardView, type ViewConfig } from './views';

export type ViewLayout = 'board' | 'table';

/** A saved table tab: the kanban's cards as rows, one column per field. */
export interface TableViewConfig {
  id: string;
  name: string;
  layout: 'table';
  /** Fields shown as columns after the title, in order (custom or built-in ids); absent: `defaultTableColumns`. */
  columns?: string[];
  /** Which cards are rows (the others are left out of this tab only; the board is untouched). */
  filter?: ViewFilter | null;
  /** Row order; empty: the board's order (column by column, top to bottom). */
  sort?: SortRule[];
  /** Locked by an editor: nobody else changes the saved tab (their own settings still work). */
  locked?: { by: string } | null;
}

/** One stored entry of `KanbanElement.views`. */
export type SavedView = ViewConfig | TableViewConfig;

export interface ViewTab {
  id: string;
  name: string;
  layout: ViewLayout;
}

/** A person's own changes to a table tab (personal view state, under the tab's id). */
export interface TableOverride {
  columns?: string[];
  filter?: ViewFilter | null;
  sort?: SortRule[];
}

/**
 * Personal view state keys a kanban uses besides its tabs' ids (`Editor.getPersonalView(kanbanId,
 * key)`): which tab I look at (`{ tab }`), and my focus-mode settings. Tab ids never start with "_".
 */
export const MY_TAB_KEY = '_tab';
export const FOCUS_KEY = '_focus';

/** Fields a table shows when its tab names none: the kanban's own fields, then the assignee and due date. */
export const DEFAULT_TABLE_BUILTINS: readonly string[] = ['$assignee', '$due'];

const isTabId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= VIEW_LIMITS.id && v !== '__proto__' && !v.startsWith('_');
const cleanName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, VIEW_LIMITS.name) : fallback);
const cleanIds = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= VIEW_LIMITS.id && x !== '__proto__'))].slice(0, VIEW_LIMITS.show) : undefined;
const cleanLock = (raw: unknown): { by: string } | undefined => {
  const by = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).by : undefined;
  return typeof by === 'string' && by.length > 0 && by.length <= VIEW_LIMITS.id ? { by } : undefined;
};

type TabSource = Pick<KanbanElement, 'views' | 'activeView' | 'colorCards' | 'columns'> & { fields?: unknown };

/** A stored table entry as a table view (anything malformed dropped); null when it isn't one. */
export function cleanTableView(raw: unknown): TableViewConfig | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || r.layout !== 'table' || !isTabId(r.id)) return null;
  const columns = cleanIds(r.columns);
  const filter = cleanFilter(r.filter);
  const sort = cleanSort(r.sort);
  const locked = cleanLock(r.locked);
  return {
    id: r.id,
    name: cleanName(r.name, 'Table'),
    layout: 'table',
    ...(columns ? { columns } : {}),
    ...(filter ? { filter } : {}),
    ...(sort.length ? { sort } : {}),
    ...(locked ? { locked } : {}),
  };
}

const tabsCache = new WeakMap<object, ViewTab[]>();

/**
 * The kanban's tabs, in order: the board tab (always one; first when none is stored) and its table
 * tabs. Tabs of layouts this code doesn't know are left out (they stay stored).
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
    const t = cleanTableView(r);
    if (!t || seen.has(t.id) || t.id === board.id) continue;
    seen.add(t.id);
    out.push({ id: t.id, name: t.name, layout: 'table' });
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

/** Table tab `id` as saved; null when the kanban has no such table tab. */
export function tableView(k: TabSource, id: string): TableViewConfig | null {
  if (!viewTabs(k).some((t) => t.id === id && t.layout === 'table')) return null;
  for (const raw of Array.isArray(k.views) ? (k.views as unknown[]) : []) {
    const t = cleanTableView(raw);
    if (t && t.id === id) return t;
  }
  return null;
}

/** The fields table `view` shows as columns after the title: those it names that exist, else the default. */
export function tableColumns(view: Pick<TableViewConfig, 'columns'>, schema: readonly FieldDef[]): string[] {
  const exists = (id: string) => id.startsWith('$') ? id !== '$title' : schema.some((f) => f.id === id);
  if (view.columns) return view.columns.filter(exists);
  return [...schema.map((f) => f.id), ...DEFAULT_TABLE_BUILTINS];
}

// ------------------------------------------------------------------ personal changes to a table tab

/** A personal table override as stored (anything else dropped), or null when it changes nothing. */
export function cleanTableOverride(raw: unknown): TableOverride | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const out: TableOverride = {};
  const columns = cleanIds(r.columns);
  if (columns) out.columns = columns;
  // A person's own filter may say "is me": a table leaves rows out for them only.
  if (Object.hasOwn(r, 'filter')) out.filter = cleanFilter(r.filter, { personal: true });
  if (Array.isArray(r.sort)) out.sort = cleanSort(r.sort);
  return Object.keys(out).length ? out : null;
}

/** Table tab `view` as this person sees it: their override on top of the saved tab. */
export function withTableOverride(view: TableViewConfig, override: unknown): TableViewConfig {
  const o = cleanTableOverride(override);
  if (!o) return view;
  return {
    ...view,
    ...(o.columns ? { columns: o.columns } : {}),
    ...(o.filter !== undefined ? { filter: o.filter } : {}),
    ...(o.sort ? { sort: o.sort } : {}),
  };
}

/** The override that turns saved table tab `saved` into `mine` (null: none). */
export function tableOverrideBetween(saved: TableViewConfig, mine: TableViewConfig): TableOverride | null {
  const out: TableOverride = {};
  if (JSON.stringify(mine.columns ?? null) !== JSON.stringify(saved.columns ?? null) && mine.columns) out.columns = [...mine.columns];
  if (!sameFilter(mine.filter, saved.filter)) out.filter = mine.filter ?? null;
  if (JSON.stringify(mine.sort ?? []) !== JSON.stringify(saved.sort ?? [])) out.sort = [...(mine.sort ?? [])];
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ the rows

/**
 * The cards a table tab shows, in its order: every card in the kanban (folded-away ones too: a
 * table hides nothing the board folds), in the board's order (column by column, top to bottom)
 * unless the tab is sorted, without the ones its filter leaves out. `me`: who "is me" means.
 */
export function tableRows(k: KanbanElement, all: readonly BoardElement[], view: Pick<TableViewConfig, 'filter' | 'sort'>, ctx: { me?: string } = {}): CardElement[] {
  const schema = collectionSchema(k);
  const order = new Map(manualOrderOf(k, all).map((id, i) => [id, i]));
  const last = order.size;
  let rows = all.filter((el): el is CardElement => isMember(k, el));
  rows.sort((a, b) => (order.get(a.id) ?? last) - (order.get(b.id) ?? last) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (view.filter) rows = rows.filter((c) => cardPasses(k, c, view.filter, schema, ctx));
  if (view.sort?.length) rows = sortCards(k, rows, view.sort, schema);
  return rows;
}

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

/** `views` with table tab `tab` added at the end (null when the kanban has as many tabs as it may). */
export function withTableTab(k: TabSource, tab: TableViewConfig): ViewsPatch | null {
  if (viewTabs(k).length >= VIEW_LIMITS.views || viewTabs(k).some((t) => t.id === tab.id)) return null;
  return { views: [...stored(k), tab], activeView: savedTabId(k) };
}

/** `views` with table tab `view` saved in place of the stored one of the same id. */
export function withTableSaved(k: TabSource, view: TableViewConfig): ViewsPatch {
  return { views: stored(k).map((v) => (v.layout === 'table' && v.id === view.id ? view : v)), activeView: savedTabId(k) };
}

/** `views` without table tab `id` (null for the board tab or no such tab); a saved tab that goes falls back to the board. */
export function withoutTab(k: TabSource, id: string): ViewsPatch | null {
  const tab = viewTabs(k).find((t) => t.id === id);
  if (!tab || tab.layout === 'board') return null;
  const views = stored(k).filter((v) => !(v.layout === 'table' && v.id === id));
  const active = savedTabId(k);
  return { views, activeView: active === id ? boardView(k).id : active };
}

/** `views` with tab `id` renamed (the board tab too); null when there is no such tab. */
export function withTabRenamed(k: TabSource, id: string, name: string): ViewsPatch | null {
  const tab = viewTabs(k).find((t) => t.id === id);
  if (!tab) return null;
  const n = name.trim().slice(0, VIEW_LIMITS.name);
  const board = boardView(k).id;
  const views = stored(k).map((v) => ((tab.layout === 'board' ? v.layout === 'board' && (v.id ?? BOARD_VIEW_ID) === board : v.layout === 'table' && v.id === id) ? { ...v, name: n } : v));
  return { views, activeView: savedTabId(k) };
}

/** `activeView` set to tab `id` (the tab everyone starts on); null when there is no such tab. */
export function withSavedTab(k: TabSource, id: string): ViewsPatch | null {
  if (!viewTabs(k).some((t) => t.id === id)) return null;
  return { views: stored(k), activeView: id };
}
