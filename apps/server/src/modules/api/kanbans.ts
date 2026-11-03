// Kanbans over the API (docs/design/kanban-fields-and-views.md, step 2e): a kanban's fields
// (`define_fields`), its saved board view (`configure_view`: grouping, swimlanes, what cards show,
// filter, sort, column limits, the view lock) and its cards read as rows (`query_cards`, filtered
// and sorted by the shared query module, the same rules the board uses). Pure over a board view,
// like items.ts, so changeBoard plans with it against the live board in one step; every change is
// laid out as open boards would lay it out after the same change made there (withKanbanLayout).
//
// Fields and options are named by id or by name / label (case-insensitive), as agents read them in
// the outline. Nothing is half-done: the first problem refuses the whole call, naming what would
// have been valid.
import {
  BUILTIN_FIELDS,
  COLUMN_FIELD_ID,
  FIELD_LIMITS,
  FIELD_TYPES,
  NO_GROUP,
  OPS_BY_KIND,
  SHOWABLE_BUILTINS,
  VIEW_LIMITS,
  PROJECTION_GROUP_BUILTINS,
  PROJECTION_LAYOUTS,
  TIMELINE_SCALES,
  barSpanOf,
  boardView,
  calendarDateField,
  cardDate,
  cleanProjection,
  dateFields,
  isProjectionLayout,
  listColumns,
  listGroupField,
  projectionGroupFields,
  projectionView,
  savedTabId,
  tabByRef,
  tabNameProblem,
  tableColumns,
  timelineFields,
  timelineLayout,
  viewTabs,
  withSavedTab,
  withTabRenamed,
  withProjectionSaved,
  withProjectionTab,
  withoutTab,
  type ProjectionLayout,
  type ProjectionView,
  type TimelineScale,
  type ViewTab,
  type KanbanViewElement,
  LAYOUT_NAMES,
  LINKED_VIEW_SIZES,
  linkedView,
  linkedViewDraft,
  linkedViewNameProblem,
  linkedViewSpot,
  newLinkedView,
  projectionWords,
  rotatedBounds,
  withLinkedViewSaved,
  cardPasses,
  cardQueryValue,
  cardValue,
  cleanFilter,
  cleanSort,
  collectionSchema,
  colorableFields,
  describeFilter,
  describeSort,
  fieldByRef,
  fieldNameProblem,
  filterProblem,
  groupFieldId,
  groupTitle,
  isGroupable,
  isMember,
  isStackable,
  kanbanBoardWidth,
  kanbanColumnAt,
  manualOrderOf,
  optionByLabel,
  planGroupBy,
  plainToRichText,
  queryFields,
  readNumber,
  reflowMoves,
  richTextToPlain,
  ruleValueByLabel,
  savedViews,
  sortCards,
  storedFields,
  storedKey,
  valueText,
  viewLockedFor,
  withKanbanLayout,
  type BoardElement,
  type CardElement,
  type CardStatus,
  type FieldDef,
  type FieldOption,
  type FieldType,
  type FilterOp,
  type FilterRule,
  type KanbanColumn,
  type KanbanElement,
  type QueryField,
  type Role,
  type SortRule,
  type ViewConfig,
  type ViewFilter,
} from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import type { BoardChange, BoardView } from '../realtime/index';

type Input = Record<string, unknown>;
type Names = (id: string) => string | undefined;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** New options' colours, in turn (Freero's column palette). */
const OPTION_COLORS = ['#8A89A3', '#2E9BF0', '#F5A524', '#1FA463', '#8B5CF6', '#E64DA6', '#14B8A6', '#E5484D'];
const STATUSES: readonly CardStatus[] = ['todo', 'doing', 'done'];
const plain = (v: unknown) => (typeof v === 'string' ? richTextToPlain(v) : '').trim();
const norm = (s: string) => s.trim().toLowerCase();

/** The kanban `kanbanId` on the board as the caller sees it (404 otherwise). */
export function kanbanIn(view: BoardView, kanbanId: string): KanbanElement {
  const el = view.elements.find((e) => e.el.id === kanbanId)?.el;
  if (!el) throw notFound('No such kanban on this board');
  if (el.type !== 'kanban') throw badRequest(`Item ${kanbanId} is a ${el.type}, not a kanban`);
  return el as KanbanElement;
}

const elementsOf = (view: BoardView) => view.elements.map((e) => e.el);

// ------------------------------------------------------------------ reading a kanban

/** A field as agents read it: options by label; the field the board is grouped by, and the swimlanes', marked. */
function apiField(f: FieldDef, k: KanbanElement) {
  const view = boardView(k);
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    ...(f.options ? { options: f.options.map((o) => ({ id: o.id, label: o.label, color: o.color, ...(o.status ? { status: o.status } : {}) })) } : {}),
    ...(f.id === groupFieldId(k) ? { columns: true } : {}),
    ...(f.id === view.subGroupBy ? { rows: true } : {}),
  };
}

/** A rule as agents read and send it: the field and options by name. */
function apiRule(r: FilterRule, schema: readonly FieldDef[]) {
  const f = queryFields(schema).find((x) => x.id === r.field);
  const label = (v: unknown) => (typeof v === 'string' ? (f?.options?.find((o) => o.id === v)?.label ?? v) : v);
  return { field: f?.name ?? r.field, op: r.op, ...(r.value !== undefined ? { value: Array.isArray(r.value) ? r.value.map(label) : label(r.value) } : {}) };
}

/** Kanban `k` as `GET /kanbans/{id}` and the tools describe it: fields, columns, rows and the saved view. */
export function kanbanSummary(k: KanbanElement, names: Names) {
  const schema = collectionSchema(k);
  const view = boardView(k);
  const group = schema.find((f) => f.id === groupFieldId(k));
  const lanes = view.subGroupBy ? schema.find((f) => f.id === view.subGroupBy) : undefined;
  const fieldName = (id: string) => queryFields(schema).find((f) => f.id === id)?.name ?? id;
  return {
    id: k.id,
    title: plain(k.title),
    fields: schema.map((f) => apiField(f, k)),
    groupBy: group?.name ?? null,
    subGroupBy: lanes?.name ?? null,
    columns: k.columns.map((c) => ({
      id: c.id,
      title: group?.type === 'person' && c.id !== NO_GROUP ? (names(c.id) ?? 'someone') : plain(c.title) || (group ? groupTitle(group, c.id) : 'Untitled'),
      status: c.status ?? null,
      ...(c.wip ? { wip: c.wip } : {}),
      ...(c.limit ? { limit: c.limit } : {}),
      ...(c.collapsed ? { collapsed: true } : {}),
    })),
    ...(lanes ? { rows: (k.lanes ?? []).map((l) => ({ id: l.id, title: lanes.type === 'person' && l.id !== NO_GROUP ? (names(l.id) ?? 'someone') : groupTitle(lanes, l.id) })) } : {}),
    view: {
      show: (view.card?.show ?? []).map(fieldName),
      color: view.card?.color === 'group' ? 'column' : view.card?.color === 'own' ? 'own' : fieldName(view.card?.color ?? 'own'),
      density: view.card?.density ?? 'comfortable',
      filter: view.filter ? { match: view.filter.op === 'or' ? 'any' : 'all', rules: view.filter.rules.map((r) => apiRule(r, schema)) } : null,
      filterText: describeFilter(view.filter, schema, names) || null,
      sort: (view.sort ?? []).map((s) => ({ field: fieldName(s.field), dir: s.dir })),
      sortText: describeSort(view.sort, schema) || null,
      locked: !!view.locked,
    },
    // Its tabs (step 3a): the Board, and tables of the same cards; `active` is the one everyone starts on.
    views: viewTabs(k).map((t) => apiTab(k, t, schema, names)),
  };
}

// ------------------------------------------------------------------ filters and sorts as agents send them

/** A field (built-in or custom) named by id or name. */
function queryFieldByRef(schema: readonly FieldDef[], ref: unknown, what: string): QueryField {
  const all = queryFields(schema);
  const f = typeof ref === 'string' ? (all.find((x) => x.id === ref) ?? all.find((x) => norm(x.name) === norm(ref))) : undefined;
  if (!f) throw badRequest(`${what}: no field “${String(ref)}” (fields: ${all.map((x) => x.name).join(', ')})`);
  return f;
}

/**
 * A filter as agents send it — `{ match: 'all' | 'any', rules: [{ field, op, value }] }`, fields by
 * name, select options by label — as the view stores it (ids). `me`: who "is me" is (query_cards
 * only; a saved filter decides what everyone's board shows, so it can't depend on who looks).
 */
export function readFilter(raw: unknown, schema: readonly FieldDef[], opts: { me?: string } = {}): ViewFilter | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('filter must be { match: "all" | "any", rules: [ { field, op, value } ] } or null');
  const r = raw as Input;
  if (r.match !== undefined && r.match !== 'all' && r.match !== 'any') throw badRequest('filter.match must be all or any');
  if (!Array.isArray(r.rules)) throw badRequest('filter.rules must be a list of { field, op, value }');
  const rules: FilterRule[] = r.rules.map((x, i) => {
    if (!x || typeof x !== 'object') throw badRequest(`filter.rules[${i}] must be { field, op, value }`);
    const { field, op, value } = x as Input;
    const f = queryFieldByRef(schema, field, `filter.rules[${i}]`);
    if (typeof op !== 'string' || !OPS_BY_KIND[f.kind].includes(op as FilterOp)) throw badRequest(`filter.rules[${i}]: “${f.name}” takes ${OPS_BY_KIND[f.kind].join(', ')}`);
    if (op === 'isMe') {
      if (!opts.me) throw badRequest(`filter.rules[${i}]: isMe depends on who looks, so a saved view can’t use it (query_cards can)`);
      return { field: f.id, op: 'is', value: opts.me };
    }
    return { field: f.id, op: op as FilterOp, ...(value !== undefined && value !== null ? { value: ruleValueByLabel(f, (f.kind === 'number' && readNumber(value) !== null ? readNumber(value) : value) as FilterRule['value']) } : {}) };
  });
  const filter = cleanFilter({ op: r.match === 'any' ? 'or' : 'and', rules });
  if (rules.length && (!filter || filter.rules.length !== rules.length)) throw badRequest('filter: every rule but empty / notEmpty / checked / unchecked needs a value');
  const problem = filterProblem(filter, schema);
  if (problem) throw badRequest(`filter: ${problem}`);
  return filter;
}

/** A sort as agents send it: `[{ field, dir }]`, fields by name ([] = manual order). */
export function readSort(raw: unknown, schema: readonly FieldDef[]): SortRule[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw badRequest('sort must be a list of { field, dir } ([] for manual order)');
  if (raw.length > 3) throw badRequest('sort: at most 3 fields');
  return cleanSort(
    raw.map((x, i) => {
      if (!x || typeof x !== 'object') throw badRequest(`sort[${i}] must be { field, dir }`);
      const { field, dir } = x as Input;
      const f = queryFieldByRef(schema, field, `sort[${i}]`);
      if (!f.sortable) throw badRequest(`sort[${i}]: “${f.name}” holds several values and can’t sort cards`);
      if (dir !== undefined && dir !== 'asc' && dir !== 'desc') throw badRequest(`sort[${i}].dir must be asc or desc`);
      return { field: f.id, dir: dir === 'desc' ? 'desc' : 'asc' };
    }),
  );
}

// ------------------------------------------------------------------ the board as it changes, step by step

/** Elements of the board as a change plans them, so later steps see what earlier ones did. */
class Working {
  readonly els: Map<string, BoardElement>;
  private readonly before: readonly BoardElement[];
  private readonly touched = new Set<string>();
  constructor(view: BoardView, readonly kid: string) {
    this.before = elementsOf(view);
    this.els = new Map(this.before.map((el) => [el.id, el]));
  }
  get k(): KanbanElement {
    return this.els.get(this.kid) as KanbanElement;
  }
  all = () => [...this.els.values()];
  patch(id: string, p: Record<string, unknown>) {
    const el = this.els.get(id);
    if (!el) return;
    this.els.set(id, { ...el, ...p } as BoardElement);
    this.touched.add(id);
  }
  moveBy(moves: ReadonlyArray<{ id: string; dx: number; dy: number }>) {
    for (const m of moves) {
      const el = this.els.get(m.id);
      if (el) this.patch(m.id, { x: el.x + m.dx, y: el.y + m.dy });
    }
  }
  /** The change: every element that differs from before (whole new fields), laid out. */
  change(): BoardChange {
    const was = new Map(this.before.map((el) => [el.id, el]));
    const update = [...this.touched].flatMap((id) => {
      const now = this.els.get(id) as unknown as Record<string, unknown>;
      const old = was.get(id) as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(now)) if (JSON.stringify(now[key]) !== JSON.stringify(old[key])) patch[key] = now[key] === undefined ? null : now[key];
      return Object.keys(patch).length ? [{ id, patch }] : [];
    });
    if (!update.length) throw badRequest('Nothing to change');
    return withKanbanLayout(this.before, { update });
  }
}

/** Column changes that keep every card in its column (or hand a removed column's to `fallback`). */
function setColumns(w: Working, columns: KanbanColumn[], fallback: string | null = null) {
  const k = w.k;
  const moves = reflowMoves(k, { colW: k.colW, columns }, w.all(), fallback);
  w.patch(k.id, { columns, w: kanbanBoardWidth({ ...k, columns }) });
  // The cards move from where the old columns put them (reflowMoves read the old geometry).
  w.moveBy(moves);
}

// ------------------------------------------------------------------ define_fields

const optionId = (newId: () => string) => newId().slice(0, 10);

/**
 * Adds, renames, reorders and deletes kanban `kid`'s fields and their options in one change. Each
 * entry names a field by `id`, else by `name` (no such field: a new one, `type` needed); `name`
 * with an `id` renames it. `delete: true` deletes it (its values stay on the cards, dormant, as in
 * the Fields panel). `options` add / rename / recolour / delete options the same way (by `id`, else
 * by `label`); the column field's options are the board's columns, and a deleted column's cards
 * move to the column beside it. `order` (top level) and `optionOrder` (per field) reorder.
 */
export function planDefineFields(view: BoardView, kid: string, body: unknown, newId: () => string): BoardChange {
  const k0 = kanbanIn(view, kid);
  if (k0.locked) throw badRequest('That kanban is locked; unlock it first');
  const b = body as Input | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.fields) || !b.fields.length) throw badRequest('Send { fields: [ { name, type?, options?, delete? } ], order? }');
  const w = new Working(view, kid);
  const group = groupFieldId(k0);
  const lanesBy = boardView(k0).subGroupBy;
  let schema: FieldDef[] = collectionSchema(k0).map((f) => ({ ...f, ...(f.options ? { options: f.options.map((o) => ({ ...o })) } : {}) }));

  b.fields.forEach((raw, i) => {
    const at = `fields[${i}]`;
    if (!raw || typeof raw !== 'object') throw badRequest(`${at} must be an object`);
    const e = raw as Input;
    const name = typeof e.name === 'string' ? e.name.trim() : undefined;
    if (e.id !== undefined && typeof e.id !== 'string') throw badRequest(`${at}.id must be a field id`);
    let f = typeof e.id === 'string' ? schema.find((x) => x.id === e.id) : name ? fieldByRef(schema, name) : undefined;
    if (typeof e.id === 'string' && !f) throw badRequest(`${at}: no field ${e.id} (fields: ${schema.map((x) => `${x.name} [${x.id}]`).join(', ')})`);
    if (!f && !name) throw badRequest(`${at} needs a name (or the id of a field)`);
    if (e.delete === true) {
      if (!f) throw badRequest(`${at}: no field “${name}” to delete`);
      if (f.id === COLUMN_FIELD_ID) throw badRequest(`${at}: “${f.name}” is the kanban’s column field and can’t be deleted (rename it, or edit its options)`);
      if (f.id === group) throw badRequest(`${at}: the board is grouped by “${f.name}”; group it by another field first (configure_view groupBy)`);
      if (f.id === lanesBy) throw badRequest(`${at}: the swimlanes are made of “${f.name}”; turn them off first (configure_view subGroupBy: null)`);
      schema = schema.filter((x) => x.id !== f!.id);
      return;
    }
    if (!f) {
      if (typeof e.type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(e.type)) throw badRequest(`${at}: a new field needs a type: ${FIELD_TYPES.join(', ')}`);
      const problem = fieldNameProblem(schema, name!);
      if (problem) throw badRequest(`${at}: ${problem}`);
      if (schema.length >= FIELD_LIMITS.fields) throw badRequest(`A kanban has at most ${FIELD_LIMITS.fields} fields`);
      f = { id: newId(), name: name!, type: e.type as FieldType, ...(e.type === 'select' || e.type === 'multiselect' ? { options: [] } : {}) };
      schema.push(f);
    } else {
      if (e.type !== undefined && e.type !== f.type) throw badRequest(`${at}: “${f.name}” is a ${f.type} field; its type can’t change (add a new field instead)`);
      if (name && typeof e.id === 'string' && name !== f.name) {
        const problem = fieldNameProblem(schema, name, f.id);
        if (problem) throw badRequest(`${at}: ${problem}`);
        f.name = name;
      }
    }
    if (e.options !== undefined) defineOptions(w, f, e.options, at, newId, f.id === group);
    if (e.optionOrder !== undefined) orderOptions(w, f, e.optionOrder, at, f.id === group);
  });

  if (b.order !== undefined) {
    if (!Array.isArray(b.order)) throw badRequest('order must be a list of field names or ids');
    const listed = b.order.map((ref, i) => {
      const f = typeof ref === 'string' ? fieldByRef(schema, ref) : undefined;
      if (!f) throw badRequest(`order[${i}]: no field “${String(ref)}”`);
      return f;
    });
    schema = [...new Set([...listed, ...schema])];
  }
  // The group field's options are the columns (written above); the others' go into `fields`.
  w.patch(kid, { fields: storedFields(schema, group) });
  return w.change();
}

function defineOptions(w: Working, f: FieldDef, raw: unknown, at: string, newId: () => string, isGroup: boolean) {
  if (f.type !== 'select' && f.type !== 'multiselect') throw badRequest(`${at}: “${f.name}” is a ${f.type} field: it has no options`);
  if (!Array.isArray(raw)) throw badRequest(`${at}.options must be a list of { id?, label, color?, status?, delete? }`);
  // The column field may say which card status its options set (a column's "Sets card status").
  const mayStatus = isGroup || f.id === COLUMN_FIELD_ID;
  raw.forEach((x, j) => {
    const here = `${at}.options[${j}]`;
    if (!x || typeof x !== 'object') throw badRequest(`${here} must be an object`);
    const o = x as Input;
    const label = typeof o.label === 'string' ? o.label.trim() : undefined;
    const options = isGroup ? currentGroupOptions(w) : (f.options ?? []);
    const hit = typeof o.id === 'string' ? options.find((x) => x.id === o.id) : label ? optionByLabel({ ...f, options }, label) : undefined;
    if (typeof o.id === 'string' && !hit) throw badRequest(`${here}: “${f.name}” has no option ${o.id}`);
    if (o.color !== undefined && (typeof o.color !== 'string' || !HEX.test(o.color))) throw badRequest(`${here}.color must be #RRGGBB`);
    if (o.status !== undefined && o.status !== null && !STATUSES.includes(o.status as CardStatus)) throw badRequest(`${here}.status must be todo, doing, done or null`);
    if (o.status !== undefined && !mayStatus) throw badRequest(`${here}: only the column field’s options set a card’s status`);
    if (label !== undefined && (!label || label.length > FIELD_LIMITS.label)) throw badRequest(`${here}.label must be 1 to ${FIELD_LIMITS.label} characters`);
    if (o.delete === true) {
      if (!hit) throw badRequest(`${here}: no option “${label}” to delete`);
      if (isGroup) {
        const cols = w.k.columns;
        if (cols.filter((c) => c.id !== NO_GROUP).length < 2) throw badRequest(`${here}: the board keeps at least one column`);
        const i = cols.findIndex((c) => c.id === hit.id);
        const options = cols.filter((c) => c.id !== NO_GROUP);
        const at2 = options.findIndex((c) => c.id === hit.id);
        const fallback = options[at2 > 0 ? at2 - 1 : 1].id;
        setColumns(w, cols.filter((_, n) => n !== i), fallback);
      } else f.options = (f.options ?? []).filter((x) => x.id !== hit.id);
      return;
    }
    const status = o.status === undefined ? undefined : ((o.status as CardStatus | null) ?? null);
    if (!hit) {
      if (!label) throw badRequest(`${here}: a new option needs a label`);
      if (options.length >= FIELD_LIMITS.options) throw badRequest(`“${f.name}” has at most ${FIELD_LIMITS.options} options`);
      const color = typeof o.color === 'string' ? o.color : OPTION_COLORS[options.length % OPTION_COLORS.length];
      const id = optionId(newId);
      if (isGroup) setColumns(w, [...w.k.columns, { id, title: plainToRichText(label), status: status ?? null, color }]);
      else f.options = [...(f.options ?? []), { id, label, color, ...(status ? { status } : {}) }];
      return;
    }
    if (isGroup)
      setColumns(
        w,
        w.k.columns.map((c) => (c.id !== hit.id ? c : { ...c, ...(label ? { title: plainToRichText(label) } : {}), ...(typeof o.color === 'string' ? { color: o.color } : {}), ...(status !== undefined ? { status } : {}) })),
      );
    else
      f.options = (f.options ?? []).map((x): FieldOption => {
        if (x.id !== hit.id) return x;
        const next: FieldOption = { ...x, ...(label ? { label } : {}), ...(typeof o.color === 'string' ? { color: o.color } : {}) };
        if (status !== undefined) {
          if (status) next.status = status;
          else delete next.status;
        }
        return next;
      });
  });
}

/** The group field's options as the columns are now (the "No value" column is none). */
const currentGroupOptions = (w: Working): FieldOption[] =>
  w.k.columns.filter((c) => c.id !== NO_GROUP).map((c) => ({ id: c.id, label: plain(c.title), color: c.color, status: c.status ?? null }));

function orderOptions(w: Working, f: FieldDef, raw: unknown, at: string, isGroup: boolean) {
  if (!Array.isArray(raw)) throw badRequest(`${at}.optionOrder must be a list of option labels or ids`);
  const options = isGroup ? currentGroupOptions(w) : (f.options ?? []);
  const listed = raw.map((ref, j) => {
    const o = typeof ref === 'string' ? (options.find((x) => x.id === ref) ?? optionByLabel({ ...f, options }, ref)) : undefined;
    if (!o) throw badRequest(`${at}.optionOrder[${j}]: “${f.name}” has no option “${String(ref)}”`);
    return o.id;
  });
  const ids = [...new Set([...listed, ...options.map((o) => o.id)])];
  if (isGroup) {
    const cols = w.k.columns;
    const none = cols.filter((c) => c.id === NO_GROUP);
    setColumns(w, [...none, ...ids.map((id) => cols.find((c) => c.id === id)!)]);
  } else f.options = ids.map((id) => options.find((o) => o.id === id)!);
}

// ------------------------------------------------------------------ configure_view

/**
 * Changes kanban `kid`'s saved board view in one change: `groupBy` (moves the cards to their
 * columns), `subGroupBy` (swimlanes; null: none), `show` (fields on cards), `color` ('own',
 * 'column', 'status' or a select field), `density`, `filter`, `sort` ([] = manual order: the order
 * people had is restored), `columns` (per column: wip, limit, collapsed) and `locked`. What an
 * agent sets is the saved view everyone sees (agents have no personal view). Refused while the
 * kanban is locked, or the view is locked by someone else (its locker and the board's owners may).
 */
export function planConfigureView(view: BoardView, kid: string, body: unknown, who: { id: string; role: Role }, newId: () => string = () => Math.random().toString(36).slice(2)): BoardChange {
  // A linked view (step 3c) is configured by its own id.
  const lv = view.elements.find((e) => e.el.id === kid && e.el.type === 'kanbanview')?.el as KanbanViewElement | undefined;
  if (lv) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest(`Send what to change: ${LINKED_KEYS.join(', ')}`);
    return planConfigureLinkedView(view, lv, body as Input, who);
  }
  const k0 = kanbanIn(view, kid);
  if (k0.locked) throw badRequest('That kanban is locked; unlock it first');
  const b = body as Input | null;
  if (!b || typeof b !== 'object' || Array.isArray(b))
    throw badRequest('Send what to change: view or addView (which tab), groupBy, subGroupBy, show, color, density, filter, sort, columns, locked, name, active or remove');
  if (b.layout !== undefined) throw badRequest('layout switches a linked view to another layout; a kanban’s tabs keep theirs (addView adds a tab of another layout)');
  const w = new Working(view, kid);
  const schema = () => collectionSchema(w.k);

  // The tab the rest of the call configures (step 3a): a new table, one named by id or name, else the board.
  let tab: ViewTab = viewTabs(k0).find((t) => t.layout === 'board')!;
  let created = false;
  if (b.addView !== undefined) {
    if (b.view !== undefined) throw badRequest('Give view (a tab to change) or addView (a new tab), not both');
    const a = b.addView as Input | null;
    const name = a && typeof a.name === 'string' ? a.name.trim() : '';
    if (!a || typeof a !== 'object' || (a.layout !== undefined && !isProjectionLayout(a.layout)))
      throw badRequest(`addView is { name, layout } (layout: ${PROJECTION_LAYOUTS.join(', ')}; default table)`);
    const problem = tabNameProblem(k0, name);
    if (problem) throw badRequest(`addView.name: ${problem}`);
    const layout: ProjectionLayout = isProjectionLayout(a.layout) ? a.layout : 'table';
    const t = { id: `t${newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'tab'}`, name, layout } as ProjectionView;
    const patch = withProjectionTab(k0, t);
    if (!patch) throw badRequest(`A kanban has at most ${VIEW_LIMITS.views} tabs`);
    w.patch(kid, patch);
    tab = { id: t.id, name: t.name, layout };
    created = true;
  } else if (b.view !== undefined) {
    const t = typeof b.view === 'string' ? tabByRef(k0, b.view) : undefined;
    if (!t) throw badRequest(`view: no tab “${String(b.view)}” (tabs: ${viewTabs(k0).map((x) => x.name).join(', ')})`);
    tab = t;
  }
  const lockOf = () => (tab.layout === 'board' ? boardView(w.k) : projectionView(w.k, tab.id)!);
  if (!created && viewLockedFor(lockOf(), who)) throw badRequest('This kanban’s view is locked by someone else: only they or the board’s owners can change it');
  // What any tab takes: its name, whether everyone starts on it, deleting it (tables only).
  if (b.remove !== undefined) {
    if (b.remove !== true) throw badRequest('remove must be true (delete the tab)');
    if (tab.layout === 'board') throw badRequest('The Board tab can’t be deleted (it holds the cards); delete another tab');
    const others = Object.keys(b).filter((key) => key !== 'remove' && key !== 'view');
    if (others.length) throw badRequest(`remove deletes the tab: send ${others.join(', ')} without it`);
    w.patch(kid, withoutTab(w.k, tab.id)!);
    return w.change();
  }
  if (b.name !== undefined) {
    if (typeof b.name !== 'string') throw badRequest('name must be the tab’s new name');
    const problem = tabNameProblem(w.k, b.name, tab.id);
    if (problem) throw badRequest(`name: ${problem}`);
    w.patch(kid, withTabRenamed(w.k, tab.id, b.name)!);
  }
  if (b.active !== undefined) {
    if (b.active !== true) throw badRequest('active must be true (the tab everyone starts on); make another tab active instead');
    w.patch(kid, withSavedTab(w.k, tab.id)!);
  }
  if (tab.layout !== 'board') {
    configureProjection(w, tab.id, b, who, schema);
    return w.change();
  }

  const groupable = (ref: unknown, what: string) => {
    const f = typeof ref === 'string' ? fieldByRef(schema(), ref) : undefined;
    if (!f || !isGroupable(f)) throw badRequest(`${what}: “${String(ref)}” isn’t a field the board can be grouped by (single select, person or checkbox: ${schema().filter(isGroupable).map((x) => x.name).join(', ')})`);
    return f;
  };

  if (b.groupBy !== undefined) {
    const f = groupable(b.groupBy, 'groupBy');
    const plan = planGroupBy(w.k, w.all(), f.id);
    if (plan) {
      w.patch(kid, plan.kanban as Record<string, unknown>);
      for (const v of plan.values) w.patch(v.id, v.patch);
      w.moveBy(plan.moves);
    }
  }
  const saved = (): ViewConfig => boardView(w.k);
  const save = (next: ViewConfig, extra: Record<string, unknown> = {}) => w.patch(kid, { ...savedViews(w.k, next), ...extra });

  if (b.subGroupBy !== undefined) {
    if (b.subGroupBy === null) save({ ...saved(), subGroupBy: null }, { lanes: null });
    else {
      const f = groupable(b.subGroupBy, 'subGroupBy');
      if (f.id === saved().groupBy) throw badRequest(`subGroupBy: the columns are “${f.name}” already`);
      save({ ...saved(), subGroupBy: f.id });
    }
  }
  if (b.show !== undefined || b.color !== undefined || b.density !== undefined) {
    const v = saved();
    const card = { ...v.card! };
    if (b.show !== undefined) {
      if (!Array.isArray(b.show)) throw badRequest('show must be a list of field names');
      card.show = [
        ...new Set(
          b.show.map((ref, i) => {
            const f = typeof ref === 'string' ? (SHOWABLE_BUILTINS.find((x) => x.id === ref || norm(x.name) === norm(ref)) ?? fieldByRef(schema(), ref)) : undefined;
            if (!f) throw badRequest(`show[${i}]: no field “${String(ref)}” a card can show`);
            return f.id;
          }),
        ),
      ];
    }
    if (b.color !== undefined) {
      if (b.color === 'own' || b.color === 'column') card.color = b.color === 'own' ? 'own' : 'group';
      else if (typeof b.color === 'string' && norm(b.color) === 'status') card.color = '$status';
      else {
        const f = typeof b.color === 'string' ? colorableFields(schema(), groupFieldId(w.k)).find((x) => x.id === b.color || norm(x.name) === norm(b.color as string)) : undefined;
        if (!f) throw badRequest(`color must be own, column, status or a select field (${colorableFields(schema(), groupFieldId(w.k)).map((x) => x.name).join(', ') || 'none yet'})`);
        card.color = f.id;
      }
    }
    if (b.density !== undefined) {
      if (b.density !== 'compact' && b.density !== 'comfortable') throw badRequest('density must be compact or comfortable');
      card.density = b.density;
    }
    save({ ...v, card });
  }
  if (b.filter !== undefined) save({ ...saved(), filter: readFilter(b.filter, schema()) });
  if (b.sort !== undefined) {
    const v = saved();
    const sort = readSort(b.sort, schema());
    const { sort: _s, manualOrder, ...rest } = v;
    // Starting a sort keeps the manual order; clearing it lets the layout bring that order back.
    const kept = v.sort?.length ? manualOrder : sort.length ? manualOrderOf(w.k, w.all()) : manualOrder;
    save({ ...rest, ...(sort.length ? { sort } : {}), ...(kept ? { manualOrder: kept } : {}) } as ViewConfig);
  }
  if (b.columns !== undefined) {
    if (!Array.isArray(b.columns)) throw badRequest('columns must be a list of { column, wip?, limit?, collapsed? }');
    let columns = [...w.k.columns];
    b.columns.forEach((raw, i) => {
      const c = raw as Input | null;
      const ref = c && typeof c.column === 'string' ? c.column : undefined;
      const at = ref === undefined ? -1 : columns.findIndex((x) => x.id === ref || norm(plain(x.title)) === norm(ref));
      if (at < 0) throw badRequest(`columns[${i}]: no column “${String(ref)}” (columns: ${columns.map((x) => plain(x.title) || x.id).join(', ')})`);
      const count = (v: unknown, name: string) => {
        if (v === null || v === 0) return 0;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10_000) throw badRequest(`columns[${i}].${name} must be a whole number (0 or null: none)`);
        return v;
      };
      const next: KanbanColumn = { ...columns[at] };
      if (c!.wip !== undefined) {
        const n = count(c!.wip, 'wip');
        if (n) next.wip = n;
        else delete next.wip;
      }
      if (c!.limit !== undefined) {
        const n = count(c!.limit, 'limit');
        if (n) next.limit = n;
        else delete next.limit;
      }
      if (c!.collapsed !== undefined) {
        if (typeof c!.collapsed !== 'boolean') throw badRequest(`columns[${i}].collapsed must be true or false`);
        if (c!.collapsed) next.collapsed = true;
        else delete next.collapsed;
      }
      columns = columns.map((x, n) => (n === at ? next : x));
    });
    setColumns(w, columns);
  }
  if (b.locked !== undefined) {
    if (typeof b.locked !== 'boolean') throw badRequest('locked must be true or false');
    save({ ...saved(), locked: b.locked ? { by: who.id } : null });
  }
  return w.change();
}

/** What each projection layout takes from configure_view (besides name, active and remove). */
const PROJECTION_KEYS: Record<ProjectionLayout, readonly string[]> = {
  table: ['show', 'filter', 'sort', 'locked'],
  list: ['show', 'groupBy', 'filter', 'sort', 'locked'],
  calendar: ['date', 'filter', 'sort', 'locked'],
  timeline: ['start', 'end', 'scale', 'subGroupBy', 'filter', 'sort', 'locked'],
};
const BOARD_KEYS = ['groupBy', 'subGroupBy', 'color', 'density', 'columns'];

/**
 * configure_view on a tab other than the board (steps 3a, 3b): what that layout has — a table's or
 * a list's fields (`show`: by name, in order), a list's grouping (`groupBy`, null: none), the date
 * field a calendar places cards on (`date`), a timeline's `start` / `end` date fields, `scale` and
 * swimlanes (`subGroupBy`, null: none) —, and any tab's filter (which cards it shows; the board is
 * untouched), sort and lock. What moves or sizes the real cards belongs to the Board tab.
 */
function configureProjection(w: Working, id: string, b: Input, who: { id: string; role: Role }, schema: () => FieldDef[]) {
  const saved = projectionView(w.k, id)!;
  const next = projectionSettings(saved, b, who, schema(), 'tab');
  if (next !== saved) w.patch(w.kid, withProjectionSaved(w.k, next));
}

/**
 * Projection view `saved` with the settings of `b` applied (by name, validated: the first problem
 * refuses the call naming what would have been valid) — a kanban's tab, or a linked view (step 3c,
 * `what` 'linked view'), which takes the same settings as a tab of its layout.
 * `schema` (the collection's) names the fields.
 */
function projectionSettings(saved0: ProjectionView, b: Input, who: { id: string; role: Role }, schema: readonly FieldDef[], what: 'tab' | 'linked view'): ProjectionView {
  const layout = saved0.layout;
  const takes = PROJECTION_KEYS[layout];
  const also = [...takes, 'name', ...(what === 'tab' ? ['active', 'remove'] : ['layout'])].join(', ');
  for (const key of [...BOARD_KEYS, 'date', 'start', 'end', 'scale']) {
    if (b[key] === undefined || takes.includes(key)) continue;
    throw badRequest(BOARD_KEYS.includes(key) ? `${key} belongs to the Board tab; a ${layout} ${what} takes ${also}` : `${key} isn’t a setting of a ${layout} ${what}; it takes ${also}`);
  }
  let cur = saved0;
  const saved = () => cur;
  const save = (next: ProjectionView) => void (cur = cleanProjection(next)!);
  const dateField = (ref: unknown, at: string) => {
    const all = dateFields(schema);
    const f = typeof ref === 'string' ? (all.find((x) => x.id === ref) ?? all.find((x) => norm(x.name) === norm(ref))) : undefined;
    if (!f) throw badRequest(`${at}: “${String(ref)}” isn’t a date field (date fields: ${all.map((x) => x.name).join(', ')})`);
    return f.id;
  };
  const groupField = (ref: unknown, at: string) => {
    const all = projectionGroupFields(schema);
    const f = typeof ref === 'string' ? (all.find((x) => x.id === ref) ?? all.find((x) => norm(x.name) === norm(ref))) : undefined;
    if (!f) throw badRequest(`${at}: “${String(ref)}” isn’t a field to group by (single select, person or checkbox, Status, Assignee: ${all.map((x) => x.name).join(', ')})`);
    return f.id;
  };
  if (b.show !== undefined) {
    if (!Array.isArray(b.show)) throw badRequest(`show must be a list of field names (the ${layout === 'table' ? 'table’s columns' : 'fields on each row'}, after the title)`);
    const columns = [
      ...new Set(
        b.show.map((ref, i) => {
          const f = typeof ref === 'string' ? (SHOWABLE_BUILTINS.find((x) => x.id === ref || norm(x.name) === norm(ref)) ?? fieldByRef(schema, ref)) : undefined;
          if (!f) throw badRequest(`show[${i}]: no field “${String(ref)}” a ${layout} can show`);
          return f.id;
        }),
      ),
    ];
    save({ ...saved(), columns } as ProjectionView);
  }
  if (b.groupBy !== undefined) save({ ...saved(), groupBy: b.groupBy === null ? null : groupField(b.groupBy, 'groupBy') } as ProjectionView);
  if (b.date !== undefined) save({ ...saved(), date: dateField(b.date, 'date') } as ProjectionView);
  if (b.start !== undefined) save({ ...saved(), start: dateField(b.start, 'start') } as ProjectionView);
  if (b.end !== undefined) save({ ...saved(), end: dateField(b.end, 'end') } as ProjectionView);
  if (b.scale !== undefined) {
    if (!TIMELINE_SCALES.includes(b.scale as TimelineScale)) throw badRequest(`scale must be ${TIMELINE_SCALES.join(', ')}`);
    save({ ...saved(), scale: b.scale as TimelineScale } as ProjectionView);
  }
  if (b.subGroupBy !== undefined) save({ ...saved(), lanesBy: b.subGroupBy === null ? null : groupField(b.subGroupBy, 'subGroupBy') } as ProjectionView);
  if (b.filter !== undefined) save({ ...saved(), filter: readFilter(b.filter, schema) });
  if (b.sort !== undefined) {
    const { sort: _s, ...rest } = saved();
    const sort = readSort(b.sort, schema);
    save({ ...rest, ...(sort.length ? { sort } : {}) } as ProjectionView);
  }
  if (b.locked !== undefined) {
    if (typeof b.locked !== 'boolean') throw badRequest('locked must be true or false');
    save({ ...saved(), locked: b.locked ? { by: who.id } : null });
  }
  return cur;
}

// ------------------------------------------------------------------ linked views (step 3c)

/** The keys add_view and configure_view on a linked view take (besides what its layout has). */
const LINKED_KEYS = ['name', 'layout', ...new Set(Object.values(PROJECTION_KEYS).flat())];

/** Linked view `lv` (showing `k`, or nothing when its kanban isn't on the board) as agents read it. */
export function linkedViewSummary(lv: KanbanViewElement, k: KanbanElement | null, names: Names) {
  const v = linkedView(lv);
  const schema = k ? collectionSchema(k) : [];
  return {
    id: lv.id,
    kind: 'linked view' as const,
    sourceId: lv.sourceId,
    source: k ? { id: k.id, title: plain(k.title) || 'Kanban' } : null,
    ...apiProjection(k, v, schema, names),
    name: v.name,
    layout: v.layout,
    shows: projectionWords(k, v, schema),
  };
}

/**
 * add_view (step 3c): a linked view of kanban `kid` — `layout` (table, list, calendar, timeline;
 * default table), `name`, and the settings a tab of that layout takes — placed beside the kanban
 * (right of it, or the nearest free spot). One new element; no card moves.
 */
export function planAddView(view: BoardView, kid: string, body: unknown, who: { id: string; role: Role }, newId: () => string): { change: BoardChange; id: string } {
  const k = kanbanIn(view, kid);
  const b = (body ?? {}) as Input;
  if (typeof b !== 'object' || Array.isArray(b)) throw badRequest(`Send the view: layout (${PROJECTION_LAYOUTS.join(', ')}), name and its settings`);
  const unknown = Object.keys(b).find((key) => !LINKED_KEYS.includes(key));
  if (unknown) throw badRequest(`${unknown} isn’t a setting of a linked view (it takes ${LINKED_KEYS.join(', ')})`);
  if (b.layout !== undefined && !isProjectionLayout(b.layout)) throw badRequest(`layout must be ${PROJECTION_LAYOUTS.join(', ')}`);
  if (b.name !== undefined && (typeof b.name !== 'string' || linkedViewNameProblem(b.name))) throw badRequest(`name: ${typeof b.name === 'string' ? linkedViewNameProblem(b.name) : 'the view’s name'}`);
  const layout: ProjectionLayout = isProjectionLayout(b.layout) ? b.layout : 'table';
  const { layout: _l, name: _n, ...settings } = b;
  const v = projectionSettings(newLinkedView(layout, typeof b.name === 'string' ? b.name : null), settings, who, collectionSchema(k), 'linked view');
  const size = LINKED_VIEW_SIZES[layout];
  const obstacles = view.elements.map((e) => rotatedBounds(e.el));
  const id = newId();
  return { id, change: { create: [linkedViewDraft(id, k, v, linkedViewSpot(k, size, obstacles))] } };
}

/** configure_view on linked view `lv` (step 3c): its name, layout (its filter and sort carry over) and the settings of its layout, for everyone. */
function planConfigureLinkedView(view: BoardView, lv: KanbanViewElement, b: Input, who: { id: string; role: Role }): BoardChange {
  if (lv.locked) throw badRequest('That linked view is locked; unlock it first');
  const unknown = Object.keys(b).find((key) => !LINKED_KEYS.includes(key));
  if (unknown) throw badRequest(`${unknown} isn’t a setting of a linked view (it takes ${LINKED_KEYS.join(', ')})`);
  let v = linkedView(lv);
  if (viewLockedFor(v, who)) throw badRequest('This linked view is locked by someone else: only they or the board’s owners can change it');
  const k = view.elements.find((e) => e.el.id === lv.sourceId && e.el.type === 'kanban')?.el as KanbanElement | undefined;
  if (!k) throw badRequest('This linked view’s kanban isn’t on the board (deleted, or not visible to you): there is nothing to configure');
  if (b.name !== undefined) {
    const problem = typeof b.name === 'string' ? linkedViewNameProblem(b.name) : 'the view’s name';
    if (problem) throw badRequest(`name: ${problem}`);
    v = { ...v, name: (b.name as string).trim() };
  }
  if (b.layout !== undefined) {
    if (!isProjectionLayout(b.layout)) throw badRequest(`layout must be ${PROJECTION_LAYOUTS.join(', ')}`);
    if (b.layout !== v.layout) {
      const fresh = newLinkedView(b.layout);
      const name = v.name === LAYOUT_NAMES[v.layout] ? fresh.name : v.name;
      v = cleanProjection({ ...fresh, name, filter: v.filter ?? null, sort: v.sort ?? [], locked: v.locked ?? null })!;
    }
  }
  const { name: _n, layout: _l, ...settings } = b;
  v = projectionSettings(v, settings, who, collectionSchema(k), 'linked view');
  const patch = withLinkedViewSaved(v);
  if (JSON.stringify(patch.view) === JSON.stringify(lv.view)) throw badRequest('Nothing to change');
  return { update: [{ id: lv.id, patch: patch as unknown as Record<string, unknown> }] };
}

/** A projection's settings as agents read them (a tab's or a linked view's): fields by name. */
function apiProjection(k: KanbanElement | null, v: ProjectionView, schema: readonly FieldDef[], names: Names): Record<string, unknown> {
  const fieldName = (id: string) => [...queryFields(schema), ...PROJECTION_GROUP_BUILTINS].find((f) => f.id === id)?.name ?? id;
  const common = {
    filter: v.filter ? { match: v.filter.op === 'or' ? 'any' : 'all', rules: v.filter.rules.map((r) => apiRule(r, schema)) } : null,
    filterText: describeFilter(v.filter, schema, names) || null,
    sort: (v.sort ?? []).map((s) => ({ field: fieldName(s.field), dir: s.dir })),
    locked: !!v.locked,
  };
  switch (v.layout) {
    case 'table':
      return { show: tableColumns(v, schema).map(fieldName), ...common };
    case 'list':
      return { show: k ? listColumns(k, v, schema).map(fieldName) : [], groupBy: (k && listGroupField(k, v, schema)?.name) ?? null, ...common };
    case 'calendar':
      return { date: fieldName(calendarDateField(v, schema)), ...common };
    case 'timeline': {
      const tl = timelineFields(v, schema);
      return { start: fieldName(tl.start), end: fieldName(tl.end), scale: tl.scale, subGroupBy: tl.lanes?.name ?? null, ...common };
    }
  }
}

/** A tab as agents read it: its name, layout, whether everyone starts on it, and the settings of a tab other than the board. */
function apiTab(k: KanbanElement, t: ViewTab, schema: readonly FieldDef[], names: Names) {
  const v = t.layout === 'board' ? null : projectionView(k, t.id);
  return {
    id: t.id,
    name: t.name,
    layout: t.layout,
    ...(t.id === savedTabId(k) ? { active: true } : {}),
    ...(v ? apiProjection(k, v, schema, names) : {}),
  };
}

// ------------------------------------------------------------------ query_cards

export interface CardQuery {
  filter?: unknown;
  sort?: unknown;
  /** Only these fields (names) in each row; default all. */
  fields?: unknown;
  /** Apply the saved view's filter and sort first (the cards the board shows, in its order). */
  useView?: unknown;
  /** A tab (id or name) whose saved filter and sort apply first: a table's rows in its order; the Board tab as useView. */
  view?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

/**
 * Kanban `kid`'s cards as rows, filtered and sorted by the shared rules (the ones the board uses):
 * `{ id, title, column, row?, filtered?, fields: { name: value } }` — options as labels, people by
 * name, dates ISO. Default order: the board's (column by column, top to bottom). `me`: the person
 * an `isMe` rule means.
 */
export function queryCardRows(view: BoardView, kid: string, q: CardQuery, names: Names, me: string) {
  const k = kanbanIn(view, kid);
  const schema = collectionSchema(k);
  const saved = boardView(k);
  const all = elementsOf(view);
  const cards = all.filter((el): el is CardElement => isMember(k, el) && isStackable(el, k.id));
  const filter = readFilter(q.filter, schema, { me });
  const tab = q.view === undefined || q.view === '' ? null : typeof q.view === 'string' ? tabByRef(k, q.view) : undefined;
  if (tab === undefined) throw badRequest(`view: no tab “${String(q.view)}” (tabs: ${viewTabs(k).map((t) => t.name).join(', ')})`);
  const projection = tab && tab.layout !== 'board' ? projectionView(k, tab.id) : null;
  const useView = q.useView === true || q.useView === 'true' || !!tab;
  // The view applied first: a tab's filter and sort (a table's, list's, calendar's or timeline's), else the board's.
  const applied = projection ?? saved;
  const sort = q.sort !== undefined ? readSort(q.sort, schema) : useView ? (applied.sort ?? []) : [];
  const limit = q.limit === undefined ? 100 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw badRequest('limit must be a whole number from 1 to 500');
  const from = q.cursor === undefined || q.cursor === null || q.cursor === '' ? 0 : Number(q.cursor);
  if (!Number.isInteger(from) || from < 0) throw badRequest('Invalid cursor');
  const wanted = q.fields === undefined ? null : Array.isArray(q.fields) ? new Set(q.fields.map((f) => norm(String(f)))) : null;
  if (q.fields !== undefined && !Array.isArray(q.fields)) throw badRequest('fields must be a list of field names');

  const order = new Map(manualOrderOf(k, all).map((id, i) => [id, i]));
  let rows = [...cards].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (useView && applied.filter) rows = rows.filter((c) => cardPasses(k, c, applied.filter, schema));
  if (filter) rows = rows.filter((c) => cardPasses(k, c, filter, schema, { me }));
  if (sort.length) rows = sortCards(k, rows, sort, schema);
  // A calendar's or timeline's cards, unsorted, read in date order (its date / a bar's start; the undated last), as it shows them.
  else if (projection && (projection.layout === 'calendar' || projection.layout === 'timeline')) {
    const at = (c: CardElement): number => {
      if (projection.layout === 'calendar') {
        const d = cardDate(k, c, calendarDateField(projection, schema), schema);
        return d ? timelineLayout.dayOf(d) : Number.MAX_SAFE_INTEGER;
      }
      const tl = timelineFields(projection, schema);
      return barSpanOf(k, c, tl.start, tl.end, schema)?.start ?? Number.MAX_SAFE_INTEGER;
    };
    const day = new Map(rows.map((c) => [c.id, at(c)]));
    rows = [...rows].sort((a, b) => day.get(a.id)! - day.get(b.id)!);
  }

  const group = schema.find((f) => f.id === groupFieldId(k));
  const lanes = saved.subGroupBy ? schema.find((f) => f.id === saved.subGroupBy) : undefined;
  const title = (f: FieldDef | undefined, key: string) => (!f ? key : f.type === 'person' && key !== NO_GROUP ? (names(key) ?? 'someone') : groupTitle(f, key));
  const shown = (name: string) => !wanted || wanted.has(norm(name));
  const row = (c: CardElement) => {
    const fields: Record<string, string | number | boolean | string[] | null> = {};
    for (const b of BUILTIN_FIELDS) {
      if (b.id === '$title' || !shown(b.name)) continue;
      const v = cardQueryValue(k, c, b.id, schema);
      if (!v || v.value === null || (Array.isArray(v.value) && !v.value.length)) continue;
      fields[b.name] = b.id === '$assignee' ? (names(String(v.value)) ?? 'someone') : b.id === '$status' ? v.text : b.id === '$tags' ? (v.value as string[]) : (v.value as string);
    }
    for (const f of schema) {
      if (!shown(f.name)) continue;
      const v = cardValue(k, c, f);
      if (v === null) continue;
      fields[f.name] = typeof v === 'number' || v === true ? v : f.type === 'multiselect' && Array.isArray(v) ? v.map((id) => f.options?.find((o) => o.id === id)?.label ?? 'Untitled') : valueText(f, v, names);
    }
    const col = k.columns[kanbanColumnAt(k, c.x + c.w / 2)];
    const lane = lanes ? storedKey(lanes, c) : null;
    return {
      id: c.id,
      title: plain(c.title),
      column: col ? (group?.type === 'person' && col.id !== NO_GROUP ? (names(col.id) ?? 'someone') : plain(col.title) || title(group, col.id)) : null,
      ...(lanes && lane !== null ? { row: title(lanes, lane) } : {}),
      ...(saved.filter && !cardPasses(k, c, saved.filter, schema) ? { filtered: true } : {}),
      fields,
    };
  };
  const page = rows.slice(from, from + limit);
  return {
    kanban: { id: k.id, title: plain(k.title) },
    total: rows.length,
    cards: page.map(row),
    nextCursor: from + limit < rows.length ? String(from + limit) : null,
  };
}

/** People the rows name (assignees, person fields, person columns): for the caller to look up. */
export function peopleOn(view: BoardView, kid: string): string[] {
  const k = kanbanIn(view, kid);
  const schema = collectionSchema(k);
  const ids = new Set<string>();
  for (const el of elementsOf(view)) {
    if (!isMember(k, el)) continue;
    if (el.assigneeId) ids.add(el.assigneeId);
    for (const f of schema) if (f.type === 'person') {
      const v = cardValue(k, el, f);
      if (typeof v === 'string') ids.add(v);
    }
  }
  const lanesBy = boardView(k).subGroupBy;
  if (schema.find((f) => f.id === groupFieldId(k))?.type === 'person') for (const c of k.columns) if (c.id !== NO_GROUP) ids.add(c.id);
  if (lanesBy && schema.find((f) => f.id === lanesBy)?.type === 'person') for (const l of k.lanes ?? []) if (l.id !== NO_GROUP) ids.add(l.id);
  return [...ids];
}
