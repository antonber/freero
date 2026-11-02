// Views of a kanban (docs/design/kanban-fields-and-views.md, step 2b): how its cards are shown.
// A kanban's SAVED views are `KanbanElement.views` (written by editors through the kanban
// feature; synced, undoable, copied with the kanban). On top of a saved view each person may keep
// a PERSONAL override (`ViewOverride`): kept outside the board doc (the engine's personal view
// state, persisted per person behind the Host), so it never reaches anyone else, and viewers can
// keep one too. "Save for everyone" writes the override into `views` and clears it.
//
// What a card shows is derived when it is drawn, never written onto the card: its accent colour
// (its own, its column's, or a select field's option colour) and its field chips. Only `density`
// changes the cards' size (the board's shared layout), so it is never personal; nor is grouping
// (`groupBy`, `subGroupBy`, step 2c) or sorting (step 2d): they decide where the real cards stand
// on the shared board. A filter is (step 2d): the SAVED filter hides the cards it leaves out from
// everyone (they make room: shared geometry), a person's own filter only fades the cards it leaves
// out, for them alone — hiding them would leave holes in the shared stacks.
//
// Pure: the web (the kanban's presentation of its cards, the View panel) and the server read
// views only through here.
import type { Role } from './api';
import type { CardElement, KanbanElement } from './elements';
import { kanbanColumnAt } from './elements';
import {
  BUILTIN_FIELDS,
  COLUMN_FIELD_ID,
  GROUPABLE_TYPES,
  STATUS_OPTIONS,
  builtinValue,
  cardValue,
  groupFieldId,
  isBuiltinFieldId,
  storedBoardView,
  type FieldDef,
  type FieldType,
  type FieldValue,
} from './fields';
import { cleanFilter, cleanSort, sameFilter, type SortRule, type ViewFilter } from './query';

export type CardDensity = 'compact' | 'comfortable';

/**
 * Where a card's accent colour comes from: 'own' its stored colour, 'group' the colour of the
 * column it is in (the group option's), or a select field's id: that field's option colour
 * (cards without a value keep their own).
 */
export type CardColorBy = 'own' | 'group' | (string & {});

export interface CardDisplay {
  /** Fields shown on cards, in order: custom field ids or built-in ids ($status, $due…). */
  show: string[];
  density: CardDensity;
  color: CardColorBy;
}

/** Settings of one group (a column) that belong to how a view looks at it, not to the option. */
export interface GroupSettings {
  wip?: number;
  collapsed?: boolean;
  limit?: number;
}

export interface ViewConfig {
  id: string;
  name: string;
  layout: 'board';
  /** The field the columns are (fields.ts `groupFieldId` reads it): the column field "Stage" when absent. */
  groupBy?: string | null;
  /** Swimlanes: rows by a second groupable field (a card's value for it is stored; a drop sets it). */
  subGroupBy?: string | null;
  /**
   * Column settings (WIP limit, collapsed, card limit) of the fields the board is NOT grouped by
   * now, kept for when it is again: field id → group key → settings. The current group field's
   * live on `columns`, where older clients read them.
   */
  groupSettings?: Record<string, Record<string, GroupSettings>>;
  card?: CardDisplay;
  /** Which cards the board shows: the others stay in their column, folded away below it (step 2d). */
  filter?: ViewFilter | null;
  /** How each column (cell) orders its cards; empty = manual (the order people stacked them in). */
  sort?: SortRule[];
  /**
   * While sorted: the items' manual order (ids, column by column, top to bottom) from when the
   * sort began, so clearing the sort puts every card back where people had it. The layout drops it
   * once it has restored that order.
   */
  manualOrder?: string[];
  /** Locked by an editor: nobody else changes the saved view (their own view settings still work). */
  locked?: { by: string } | null;
}

/**
 * What a person may change of a saved view for themselves: what cards show and what colours them,
 * and the filter (which only fades cards for them). Density, grouping and sorting move or resize
 * the real cards: never personal. `filter: null` = no filter for me (while the saved view has one).
 */
export interface ViewOverride {
  card?: { show?: string[]; color?: CardColorBy };
  filter?: ViewFilter | null;
}

/** The id of a kanban's board view when it has none saved yet. */
export const BOARD_VIEW_ID = 'board';
/** What cards show on a kanban without saved views: the footer cards always had. */
export const DEFAULT_CARD_SHOW: readonly string[] = ['$status', '$due', '$tags', '$estimate', '$assignee'];
export const VIEW_LIMITS = { views: 20, show: 40, name: 60, id: 64, manualOrder: 5000 } as const;

/** Built-in fields a card can show (the title always shows; links have their own badge). */
export const SHOWABLE_BUILTINS = BUILTIN_FIELDS.filter((f) => f.id !== '$title' && f.id !== '$link');

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= VIEW_LIMITS.id && v !== '__proto__';

function cleanShow(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter(isId))].slice(0, VIEW_LIMITS.show);
}

const cleanColor = (raw: unknown): CardColorBy | undefined => (isId(raw) ? raw : undefined);

function cleanCard(raw: unknown, fallback: CardDisplay): CardDisplay {
  const c = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    show: cleanShow(c.show) ?? [...fallback.show],
    density: c.density === 'compact' || c.density === 'comfortable' ? c.density : fallback.density,
    color: cleanColor(c.color) ?? fallback.color,
  };
}

type ViewSource = Pick<KanbanElement, 'views' | 'activeView' | 'colorCards'> & { fields?: unknown };

/** The display a kanban without saved views has: cards as they always were, coloured by column on boards that did. */
const defaultCard = (k: ViewSource): CardDisplay => ({ show: [...DEFAULT_CARD_SHOW], density: 'comfortable', color: k.colorCards ? 'group' : 'own' });

/**
 * The kanban's board view as saved (what everyone starts from): the active view when it is a
 * board view, else the first one, else the view a kanban from before views has. Read-time and
 * deterministic, malformed entries read as the defaults; nothing has to be written to migrate.
 */
export function boardView(k: ViewSource): ViewConfig {
  const raw = storedBoardView(k);
  const fallback = defaultCard(k);
  if (!raw) return { id: BOARD_VIEW_ID, name: 'Board', layout: 'board', groupBy: COLUMN_FIELD_ID, subGroupBy: null, card: fallback };
  const groupBy = groupFieldId(k);
  const sub = typeof raw.subGroupBy === 'string' && raw.subGroupBy !== groupBy && groupableStored(k, raw.subGroupBy) ? raw.subGroupBy : null;
  return {
    id: isId(raw.id) ? raw.id : BOARD_VIEW_ID,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, VIEW_LIMITS.name) : 'Board',
    layout: 'board',
    groupBy,
    subGroupBy: sub,
    ...(raw.groupSettings && typeof raw.groupSettings === 'object' ? { groupSettings: cleanGroupSettings(raw.groupSettings) } : {}),
    card: cleanCard(raw.card, fallback),
    ...(cleanFilter(raw.filter) ? { filter: cleanFilter(raw.filter) } : {}),
    ...(cleanSort(raw.sort).length ? { sort: cleanSort(raw.sort) } : {}),
    ...(Array.isArray(raw.manualOrder) ? { manualOrder: raw.manualOrder.filter(isId).slice(0, VIEW_LIMITS.manualOrder) } : {}),
    ...(raw.locked && typeof raw.locked === 'object' && isId((raw.locked as Record<string, unknown>).by) ? { locked: { by: (raw.locked as { by: string }).by } } : {}),
  };
}

/**
 * True when `who` may not change kanban view `view` as saved: it is locked by someone else (the
 * person who locked it and the board's owners may). Their own view settings stay theirs to change.
 */
export const viewLockedFor = (view: Pick<ViewConfig, 'locked'>, who: { id: string; role: Role }): boolean =>
  !!view.locked && view.locked.by !== who.id && who.role !== 'owner';

/** A field the kanban stores that a board can group by (Stage always). */
function groupableStored(k: ViewSource, id: string): boolean {
  if (id === COLUMN_FIELD_ID) return true;
  const fields = (k as { fields?: unknown }).fields;
  const f = Array.isArray(fields) ? (fields as Array<Record<string, unknown>>).find((x) => x && x.id === id) : undefined;
  return !!f && GROUPABLE_TYPES.includes(f.type as FieldType);
}

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : undefined);

function cleanGroupSettings(raw: object): Record<string, Record<string, GroupSettings>> {
  const out: Record<string, Record<string, GroupSettings>> = {};
  for (const [fid, groups] of Object.entries(raw).slice(0, 60)) {
    if (!isId(fid) || !groups || typeof groups !== 'object') continue;
    const g: Record<string, GroupSettings> = {};
    for (const [key, v] of Object.entries(groups as object).slice(0, 250)) {
      if (!isId(key) || !v || typeof v !== 'object') continue;
      const { wip, collapsed, limit } = v as Record<string, unknown>;
      const s: GroupSettings = { ...(count(wip) ? { wip: count(wip) } : {}), ...(collapsed === true ? { collapsed: true } : {}), ...(count(limit) ? { limit: count(limit) } : {}) };
      if (Object.keys(s).length) g[key] = s;
    }
    if (Object.keys(g).length) out[fid] = g;
  }
  return out;
}

/** A personal override as stored (anything else in it is dropped), or null when it changes nothing. */
export function cleanOverride(raw: unknown): ViewOverride | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const c = r.card && typeof r.card === 'object' ? (r.card as Record<string, unknown>) : {};
  const show = cleanShow(c.show);
  const color = cleanColor(c.color);
  const out: ViewOverride = {};
  if (show || color) out.card = { ...(show ? { show } : {}), ...(color ? { color } : {}) };
  // A person's own filter may say "is me": it only fades cards, for them.
  if (Object.hasOwn(r, 'filter')) out.filter = cleanFilter(r.filter, { personal: true });
  return Object.keys(out).length ? out : null;
}

/** `view` as this person sees it: their personal override on top of the saved view. */
export function withOverride(view: ViewConfig, override: unknown): ViewConfig {
  const o = cleanOverride(override);
  if (!o) return view;
  return {
    ...view,
    ...(o.card && view.card ? { card: { ...view.card, ...o.card } } : {}),
    ...(o.filter !== undefined ? { filter: o.filter } : {}),
  };
}

/** The override that turns `saved` into `mine`: only the keys that differ (null: none). */
export function overrideBetween(saved: ViewConfig, mine: ViewConfig): ViewOverride | null {
  const card: NonNullable<ViewOverride['card']> = {};
  if (mine.card && saved.card) {
    if (mine.card.show.join('\n') !== saved.card.show.join('\n')) card.show = [...mine.card.show];
    if (mine.card.color !== saved.card.color) card.color = mine.card.color;
  }
  const out: ViewOverride = Object.keys(card).length ? { card } : {};
  if (!sameFilter(mine.filter, saved.filter)) out.filter = mine.filter ?? null;
  return Object.keys(out).length ? out : null;
}

/**
 * `KanbanElement.views` with `view` saved in place of the board view of the same id (or added),
 * and the `colorCards` an older client reads: on exactly when cards are coloured by column.
 */
export function savedViews(k: ViewSource, view: ViewConfig): Pick<KanbanElement, 'views' | 'activeView' | 'colorCards'> {
  const stored = Array.isArray(k.views) ? k.views.filter((v) => v && typeof v === 'object') : [];
  const i = stored.findIndex((v) => v.id === view.id);
  const views = i >= 0 ? stored.map((v, j) => (j === i ? view : v)) : [...stored, view].slice(-VIEW_LIMITS.views);
  return { views, activeView: k.activeView && views.some((v) => v.id === k.activeView) ? k.activeView : view.id, colorCards: view.card?.color === 'group' };
}

// ------------------------------------------------------------------ what a card shows

/** One field shown on a card (only fields with a value are). */
export type FieldChip = { field: string; name: string } & (
  | { kind: 'options'; options: Array<{ id: string; label: string; color: string }> }
  | { kind: 'person'; userId: string }
  | { kind: 'date'; date: string }
  | { kind: 'text'; text: string }
  | { kind: 'check' }
  | { kind: 'tags'; ids: string[] }
);

const isoDay = (ms: number) => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
};

/** The field (custom or built-in) `id` names on kanban `schema`, as something chips can be made of. */
function fieldOf(schema: readonly FieldDef[], id: string): (Pick<FieldDef, 'id' | 'name' | 'type' | 'options'> & { builtin?: true }) | null {
  if (isBuiltinFieldId(id)) {
    const b = BUILTIN_FIELDS.find((f) => f.id === id)!;
    return { id: b.id, name: b.name, type: b.type === 'timestamp' ? 'date' : b.type, options: id === '$status' ? STATUS_OPTIONS : undefined, builtin: true };
  }
  return schema.find((f) => f.id === id) ?? null;
}

function chip(f: NonNullable<ReturnType<typeof fieldOf>>, v: FieldValue | null): FieldChip | null {
  if (v === null || v === undefined) return null;
  const base = { field: f.id, name: f.name };
  if (f.id === '$tags') return Array.isArray(v) && v.length ? { ...base, kind: 'tags', ids: v } : null;
  if (f.id === '$created' || f.id === '$updated') {
    const day = typeof v === 'number' ? isoDay(v) : null;
    return day ? { ...base, kind: 'date', date: day } : null;
  }
  switch (f.type) {
    case 'select':
    case 'multiselect': {
      const ids = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
      const options = ids.map((id) => f.options?.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
      return options.length ? { ...base, kind: 'options', options: options.map((o) => ({ id: o.id, label: o.label || 'Untitled', color: o.color })) } : null;
    }
    case 'person':
      return typeof v === 'string' ? { ...base, kind: 'person', userId: v } : null;
    case 'date':
      return typeof v === 'string' ? { ...base, kind: 'date', date: v } : null;
    case 'checkbox':
      return v === true ? { ...base, kind: 'check' } : null;
    default:
      return { ...base, kind: 'text', text: String(v) };
  }
}

/** The chips card `card` of kanban `k` shows in `view`, in its order (fields without a value are left out). */
export function cardChips(k: KanbanElement, card: CardElement, view: ViewConfig, schema: readonly FieldDef[]): FieldChip[] {
  const out: FieldChip[] = [];
  for (const id of view.card?.show ?? []) {
    const f = fieldOf(schema, id);
    if (!f) continue;
    const v = f.builtin ? builtinValue(card, id as Parameters<typeof builtinValue>[1]) : cardValue(k, card, f as FieldDef);
    const c = chip(f, v);
    if (c) out.push(c);
  }
  return out;
}

/** The accent card `card` is drawn with in `view` of kanban `k`; null = its own colour. */
export function cardAccent(k: KanbanElement, card: CardElement, view: ViewConfig, schema: readonly FieldDef[]): string | null {
  const by = view.card?.color ?? 'own';
  if (by === 'own') return null;
  if (by === 'group') return k.columns.length ? (k.columns[kanbanColumnAt(k, card.x + card.w / 2)]?.color ?? null) : null;
  const f = !isBuiltinFieldId(by) ? schema.find((x) => x.id === by) : by === '$status' ? { id: '$status', name: 'Status', type: 'select' as const, options: STATUS_OPTIONS } : undefined;
  if (!f || f.type !== 'select') return null;
  const v = f.id === '$status' ? (card.status ?? null) : cardValue(k, card, f as FieldDef);
  return (typeof v === 'string' && f.options?.find((o) => o.id === v)?.color) || null;
}

/** Fields a view can colour cards by: select fields other than the group field (its colour is "group"). */
export function colorableFields(schema: readonly FieldDef[], groupId: string = COLUMN_FIELD_ID): FieldDef[] {
  return schema.filter((f) => f.type === 'select' && f.id !== groupId);
}
