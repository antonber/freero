// A tracker's issues and a kanban's fields (docs/design/kanban-fields-and-views.md, step 2f).
// Pure over the board: what a card's Stage and Priority say in a tracker's terms, and the writes
// that put a tracker's status and priority onto kanban cards — on import (which may add the
// columns and the Priority field the issues need) and on every pull.
//
// Status → Stage, one rule for import and pull: the Stage option whose label is the tracker's
// status name (case and spaces don't count: "In review" ↔ "IN  REVIEW"), else the first option
// mapped to the status's category ("Sets card status"); on import, a status neither finds gets a
// column of its own (named after it, mapped to its category) — as a person without a column gets
// theirs when the board is grouped by people. While the board is grouped by another field, Stage
// is a stored value and the same rule picks it (no option: no value).
// Priority → the kanban's single select "Priority": by label; a level the field lacks is added
// (an import into a kanban without one makes it, with the tracker's levels as options, and shows
// it on the cards). Labels, assignee and dates are the card's own fields ($tags, $assignee, $due),
// mapped as before.
import {
  COLUMN_FIELD_ID,
  KANBAN_LAYOUT,
  NO_GROUP,
  PRIORITY_FIELD_NAME,
  boardView,
  cardValue,
  collectionSchema,
  fieldNameProblem,
  groupFieldId,
  kanbanBoardWidth,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanColumnWidth,
  labelKey,
  plainToRichText,
  priorityFieldOf,
  rankColor,
  savedViews,
  storedFields,
  withOptions,
  type BoardElement,
  type CardElement,
  type CardStatus,
  type FieldDef,
  type FieldOption,
  type FieldValues,
  type IssueStatusCategory,
  type IssueValues,
  type KanbanColumn,
  type KanbanElement,
  reflowMoves,
  withKanbanLayout,
  type ElementDraft,
} from '@freero/shared';

type Elements = { elements: Array<{ el: BoardElement }> };

const CATEGORY_COLORS: Record<CardStatus, string> = { todo: '#8A89A3', doing: '#2E9BF0', done: '#1FA463' };
const CATEGORY_TITLES: Record<CardStatus, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };
const CATEGORY_ORDER: CardStatus[] = ['todo', 'doing', 'done'];

/** The kanban a card stands in (its container), if it is one. */
export function kanbanOf(view: Elements, el: Pick<BoardElement, 'frameId'>): KanbanElement | null {
  if (!el.frameId) return null;
  const k = view.elements.find((e) => e.el.id === el.frameId)?.el;
  return k?.type === 'kanban' && Array.isArray((k as KanbanElement).columns) ? (k as KanbanElement) : null;
}

const optionLabel = (f: FieldDef, id: unknown) => (typeof id === 'string' ? (f.options?.find((o) => o.id === id)?.label ?? null) : null);

/**
 * What a card's kanban fields say to a tracker: its Stage option's label (the column it stands
 * in), and its Priority's label when the kanban has a Priority field (left out otherwise, so the
 * board never pushes a priority it doesn't hold).
 */
export function cardTrackerFields(k: KanbanElement, card: CardElement): { statusName: string | null; priority?: string | null } {
  const schema = collectionSchema(k);
  const stage = schema.find((f) => f.id === COLUMN_FIELD_ID);
  const out: { statusName: string | null; priority?: string | null } = { statusName: stage ? optionLabel(stage, cardValue(k, card, stage)) : null };
  const pf = priorityFieldOf(schema);
  if (pf) out.priority = optionLabel(pf, cardValue(k, card, pf));
  return out;
}

/** The Stage option for a tracker status: by name, else the first one mapped to its category. */
export function stageOptionFor(stage: FieldDef, name: string | null | undefined, category: IssueStatusCategory | null | undefined): FieldOption | undefined {
  const opts = (stage.options ?? []).filter((o) => o.id !== NO_GROUP);
  const byName = name?.trim() ? opts.find((o) => labelKey(o.label) === labelKey(name)) : undefined;
  return byName ?? (category ? opts.find((o) => o.status === category) : undefined);
}

/** Kanban `k` with columns added for `adds` (each after the last column of its category, else at the end), and its width. */
function withColumns(k: KanbanElement, adds: KanbanColumn[]): KanbanElement {
  const columns = [...k.columns];
  for (const c of adds) {
    let at = -1;
    columns.forEach((x, i) => {
      if (c.status && x.status === c.status) at = i;
    });
    if (at < 0 && c.status) {
      // Before the first column of a later category (a "doing" status goes before Done).
      const later = CATEGORY_ORDER.slice(CATEGORY_ORDER.indexOf(c.status) + 1);
      const i = columns.findIndex((x) => x.status && later.includes(x.status));
      at = i < 0 ? columns.length - 1 : i - 1;
    }
    columns.splice(at < 0 ? columns.length : at + 1, 0, c);
  }
  const next = { ...k, columns };
  return { ...next, w: kanbanBoardWidth(next) };
}

/**
 * Where a card goes in column `col` of `k`: centered in it, below the cards already there (not
 * those moving in this change). Null when it already stands in that column.
 */
export function columnSpot(view: Elements, k: KanbanElement, card: BoardElement, col: number, moving: ReadonlySet<string>): { x: number; y: number; color?: string } | null {
  if (col < 0 || col >= k.columns.length || kanbanColumnAt(k, card.x + card.w / 2) === col) return null;
  const { itemGap, headerH, colHeadH, pad } = KANBAN_LAYOUT;
  const inCol = (el: BoardElement) => el.frameId === k.id && el.id !== card.id && !moving.has(el.id) && kanbanColumnAt(k, el.x + el.w / 2) === col;
  const bottom = view.elements
    .map((e) => e.el)
    .filter(inCol)
    .reduce((m, el) => Math.max(m, el.y + el.h), k.y + headerH + colHeadH + pad - itemGap);
  // Older clients read the column colour off the card on boards that colour cards by column.
  const color = k.colorCards ? k.columns[col].color : undefined;
  return { x: Math.round(k.x + kanbanColumnLeft(k, col) + kanbanColumnWidth(k, col) / 2 - card.w / 2), y: Math.round(bottom + itemGap), ...(color ? { color } : {}) };
}

export interface KanbanPull {
  /** Card patches by card id. */
  cards: Map<string, Record<string, unknown>>;
  /** The kanban's own patch (a priority level it didn't have yet), or null. */
  kanban: Partial<KanbanElement> | null;
}

/**
 * The writes that put a tracker's status and / or priority (`pull`, only the fields that changed
 * there) onto `cards` of kanban `k`: a card moves to the column of its new Stage when Stage is
 * what the board is grouped by (else its stored Stage changes), and gets its new Priority the same
 * way. A pull never adds a column for an unknown status (the import does); it does add a priority
 * level the field doesn't have yet, since the tracker's levels are the field's.
 */
export function planKanbanPull(view: Elements, k: KanbanElement, cards: CardElement[], pull: Pick<IssueValues, 'status' | 'statusName' | 'priority'>, ctx: { newId(): string; moving: ReadonlySet<string> }): KanbanPull {
  const out: KanbanPull = { cards: new Map(), kanban: null };
  let kanban = k;
  const schema = collectionSchema(k);
  const group = groupFieldId(k);
  const patch = (id: string, p: Record<string, unknown>) => out.cards.set(id, { ...(out.cards.get(id) ?? {}), ...p });
  const setValue = (c: CardElement, f: FieldDef, optionId: string | null) => {
    if (f.id === group) {
      const col = kanban.columns.findIndex((x) => x.id === (optionId ?? NO_GROUP));
      const spot = col >= 0 ? columnSpot(view, kanban, c, col, ctx.moving) : null;
      if (spot) patch(c.id, spot);
      return;
    }
    const values = { ...((out.cards.get(c.id)?.values as FieldValues | undefined) ?? c.values ?? {}) };
    if ((values[f.id] ?? null) === optionId) return;
    if (optionId === null) delete values[f.id];
    else values[f.id] = optionId;
    patch(c.id, { values });
  };

  const stage = schema.find((f) => f.id === COLUMN_FIELD_ID);
  if (stage && (pull.statusName !== undefined || pull.status)) {
    for (const c of cards) {
      const current = cardValue(kanban, c, stage);
      const currentOpt = stage.options?.find((o) => o.id === current);
      // By name when the name changed there; by category only when the category changed and the
      // card's column isn't one of it already (a card in "Backlog" stays when Jira says "To do").
      const named = pull.statusName ? stageOptionFor(stage, pull.statusName, null) : undefined;
      const target = named ?? (pull.status && currentOpt?.status !== pull.status ? stageOptionFor(stage, null, pull.status) : undefined);
      if (target && target.id !== current) setValue(c, stage, target.id);
    }
  }

  const pf = priorityFieldOf(schema);
  if (pf && pull.priority !== undefined) {
    let field = pf;
    let optionId: string | null = null;
    if (pull.priority) {
      const label = pull.priority;
      let hit = field.options?.find((o) => labelKey(o.label) === labelKey(label));
      if (!hit) {
        field = { ...field, options: withOptions(field.options ?? [], [label], ctx.newId) };
        hit = field.options!.at(-1)!;
        kanban = addOption(kanban, schema, field, hit);
        out.kanban = kanbanPatch(k, kanban);
      }
      optionId = hit.id;
    }
    for (const c of cards) setValue(c, field, optionId);
  }
  return out;
}

/** `k` with option `o` added to field `f` (a column when `f` is what the board is grouped by). */
function addOption(k: KanbanElement, schema: FieldDef[], f: FieldDef, o: FieldOption): KanbanElement {
  const group = groupFieldId(k);
  if (f.id === group) return withColumns(k, [{ id: o.id, title: plainToRichText(o.label), status: o.status ?? null, color: o.color }]);
  return { ...k, fields: storedFields(schema.map((x) => (x.id === f.id ? f : x)), group) };
}

/** The keys of `next` that differ from `k` (what to write). */
function kanbanPatch(k: KanbanElement, next: KanbanElement): Partial<KanbanElement> | null {
  const out: Record<string, unknown> = {};
  for (const key of ['columns', 'w', 'fields', 'views', 'activeView', 'colorCards'] as const)
    if (JSON.stringify(k[key]) !== JSON.stringify(next[key])) out[key] = next[key];
  return Object.keys(out).length ? (out as Partial<KanbanElement>) : null;
}

export interface ImportedIssue {
  /** The card's id. */
  id: string;
  values: Pick<IssueValues, 'status' | 'statusName' | 'priority'>;
}

export interface KanbanImport {
  /** The kanban as the import leaves it (new columns, a Priority field shown on its cards). */
  kanban: KanbanElement;
  patch: Partial<KanbanElement> | null;
  /** The column each card goes to (column id). */
  columnOf: Map<string, string>;
  /** Stored field values each card gets (Stage while the board is grouped by another field, Priority). */
  values: Map<string, FieldValues>;
}

/** The columns a new kanban for these issues has: one per status name, in category order (to do, doing, done), then as the issues come. */
export function statusColumns(issues: ImportedIssue[]): Array<{ title: string; status: CardStatus }> {
  const seen = new Map<string, { title: string; status: CardStatus; at: number }>();
  issues.forEach((i, n) => {
    const status = i.values.status ?? 'todo';
    const title = i.values.statusName?.trim() || CATEGORY_TITLES[status];
    if (!seen.has(labelKey(title))) seen.set(labelKey(title), { title: title.slice(0, 100), status, at: n });
  });
  return [...seen.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.status) - CATEGORY_ORDER.indexOf(b.status) || a.at - b.at).map(({ title, status }) => ({ title, status }));
}

/**
 * How issues imported into kanban `k` land: each card's column (its status by name, else by
 * category, else a new column named after it), its stored values, and the kanban's changes —
 * columns added, and a Priority field (with `priorities`, the tracker's levels, as options, else
 * the levels the issues have) when an issue has a priority and the kanban has none; it is shown
 * on the cards. A kanban the issues need nothing new from is left as it is.
 */
export function planKanbanImport(k: KanbanElement, issues: ImportedIssue[], ctx: { newId(): string; priorities: string[] | null }): KanbanImport {
  let kanban = k;
  let schema = collectionSchema(k);
  const group = groupFieldId(k);
  const values = new Map<string, FieldValues>();
  const columnOf = new Map<string, string>();
  const set = (id: string, fieldId: string, v: string) => values.set(id, { ...(values.get(id) ?? {}), [fieldId]: v });

  // Stage: by name, else by category, else (the board's columns) a column of its own.
  const stage = schema.find((f) => f.id === COLUMN_FIELD_ID);
  const stageOf = new Map<string, string>();
  if (stage) {
    const added: KanbanColumn[] = [];
    let options = stage.options ?? [];
    for (const i of issues) {
      let o = stageOptionFor({ ...stage, options }, i.values.statusName, i.values.status);
      if (!o && group === COLUMN_FIELD_ID) {
        const status = i.values.status ?? 'todo';
        const title = i.values.statusName?.trim() || CATEGORY_TITLES[status];
        o = { id: ctx.newId(), label: title.slice(0, 100), color: CATEGORY_COLORS[status], status };
        options = [...options, o];
        added.push({ id: o.id, title: plainToRichText(o.label), status, color: o.color });
      }
      if (o) stageOf.set(i.id, o.id);
    }
    if (added.length) {
      kanban = withColumns(kanban, added);
      schema = collectionSchema(kanban);
    }
    for (const [id, o] of stageOf) if (group !== COLUMN_FIELD_ID) set(id, COLUMN_FIELD_ID, o);
  }

  // Priority: the field the kanban has, or a new one when an issue has a priority.
  const wanted = issues.map((i) => i.values.priority?.trim()).filter((p): p is string => !!p);
  let pf = priorityFieldOf(schema);
  if (wanted.length && !pf && !fieldNameProblem(schema, PRIORITY_FIELD_NAME)) {
    const levels = [...(ctx.priorities ?? []), ...wanted];
    const n = new Set(levels.map(labelKey)).size;
    pf = { id: ctx.newId(), name: PRIORITY_FIELD_NAME, type: 'select', options: withOptions([], levels, ctx.newId, (_l, i) => rankColor(i, n)) };
    schema = [...schema, pf];
    kanban = { ...kanban, fields: storedFields(schema, group) };
    const view = boardView(kanban);
    const shown = { ...view, card: { ...view.card!, show: [pf.id, ...view.card!.show.filter((s) => s !== pf!.id)] } };
    kanban = { ...kanban, ...savedViews(kanban, shown) };
  } else if (pf && wanted.length) {
    const before = pf.options?.length ?? 0;
    const next = { ...pf, options: withOptions(pf.options ?? [], wanted, ctx.newId) };
    for (const o of next.options!.slice(before)) kanban = addOption(kanban, schema, next, o);
    pf = next;
    schema = collectionSchema(kanban);
  }
  const priorityOf = new Map<string, string>();
  if (pf)
    for (const i of issues) {
      const p = i.values.priority?.trim();
      const o = p ? pf.options?.find((x) => labelKey(x.label) === labelKey(p)) : undefined;
      if (o) priorityOf.set(i.id, o.id);
      if (o && pf.id !== group) set(i.id, pf.id, o.id);
    }

  // The column: the value of the field the board is grouped by.
  for (const i of issues) {
    const key = group === COLUMN_FIELD_ID ? stageOf.get(i.id) : pf && group === pf.id ? (priorityOf.get(i.id) ?? NO_GROUP) : NO_GROUP;
    const col = kanban.columns.find((c) => c.id === key) ?? kanban.columns.find((c) => c.id === NO_GROUP || c.id === 'false') ?? kanban.columns[0];
    if (col) columnOf.set(i.id, col.id);
  }
  return { kanban, patch: kanbanPatch(k, kanban), columnOf, values };
}

/**
 * The change an import into kanban `k` (already on the board, `before`) makes: the placed cards
 * (`placed`), the kanban's new columns and fields (`plan`), the cards already there moved along
 * with their columns when a status column opens between others (a card in Done stays in Done when
 * "In progress" opens before it — moved by position alone it would land in the new column and take
 * its status), and the kanban laid out as open boards would lay it out after the same drop
 * (@freero/shared withKanbanLayout: swimlanes, filter, sort, card limits).
 */
export function importIntoKanban(
  before: readonly BoardElement[],
  k: KanbanElement,
  plan: KanbanImport | null,
  placed: { create: ElementDraft[]; update: Array<{ id: string; patch: Record<string, unknown> }> },
): { create: ElementDraft[]; update: Array<{ id: string; patch: Record<string, unknown> }> } {
  const update = [...placed.update];
  if (plan?.patch) {
    const i = update.findIndex((u) => u.id === k.id);
    if (i >= 0) update[i] = { id: k.id, patch: { ...plan.patch, ...update[i].patch } };
    else update.push({ id: k.id, patch: plan.patch as Record<string, unknown> });
    if (plan.patch.columns)
      for (const m of reflowMoves(k, { colW: k.colW, columns: plan.kanban.columns }, before, null)) {
        const el = before.find((e) => e.id === m.id)!;
        update.push({ id: m.id, patch: { x: el.x + m.dx } });
      }
  }
  return withKanbanLayout(before, { create: placed.create as Array<ElementDraft & Record<string, unknown>>, update }) as { create: ElementDraft[]; update: typeof update };
}
