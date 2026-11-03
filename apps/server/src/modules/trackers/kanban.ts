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
// Sprint → the kanban's single select "Sprint" (or "Cycle", "Iteration"; #119), the same way as
// Priority: by label, a sprint the field lacks is added, a closed sprint is a read-only option
// (cards keep it, nobody picks it). An import by sprint makes the field with the project's sprints.
// Mapped fields (#43) → the kanban field the connection's field map names, by name and of a kind
// that holds the value; an import makes it when the kanban has none.
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
  mappedKanbanField,
  plainToRichText,
  priorityFieldOf,
  rankColor,
  readValue,
  savedViews,
  sprintFieldOf,
  storedFields,
  withOptions,
  groupKeyOf,
  type BoardElement,
  type CardElement,
  type CardStatus,
  type CustomValue,
  type FieldDef,
  type FieldMapEntry,
  type FieldOption,
  type FieldValue,
  type FieldValues,
  type IssueStatusCategory,
  type IssueValues,
  type KanbanColumn,
  type KanbanElement,
  type TrackerSprint,
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

export interface CardFieldsContext {
  /** The connection's field map (#43). */
  map?: readonly FieldMapEntry[];
  /** A person's verified email by user id (person fields). */
  emailOf?(userId: string): string | null;
}

/** A kanban field's value in a tracker's terms: labels for options, an email for a person. */
function trackerValueOf(f: FieldDef, v: FieldValue | null, emailOf?: (id: string) => string | null): CustomValue {
  if (v === null || v === undefined) return f.type === 'multiselect' ? [] : null;
  switch (f.type) {
    case 'select':
      return optionLabel(f, v);
    case 'multiselect':
      return Array.isArray(v) ? v.flatMap((id) => (optionLabel(f, id) ? [optionLabel(f, id)!] : [])) : [];
    case 'person':
      // Someone without a verified address can't be named to the tracker: '~' is never sent.
      return typeof v === 'string' ? (emailOf?.(v) ?? `~${v}`) : null;
    case 'number':
      return typeof v === 'number' ? v : null;
    default:
      return typeof v === 'string' ? v : null;
  }
}

/**
 * What a card's kanban fields say to a tracker: its Stage option's label (the column it stands
 * in), its Priority's and Sprint's labels when the kanban has those fields, and the fields the
 * connection's map names (#43) — each left out when the kanban has no such field, so the board
 * never pushes (or clears) a value it doesn't hold.
 */
export function cardTrackerFields(
  k: KanbanElement,
  card: CardElement,
  ctx: CardFieldsContext = {},
): { statusName: string | null; priority?: string | null; sprint?: string | null; custom?: Record<string, CustomValue> } {
  const schema = collectionSchema(k);
  const stage = schema.find((f) => f.id === COLUMN_FIELD_ID);
  const out: { statusName: string | null; priority?: string | null; sprint?: string | null; custom?: Record<string, CustomValue> } = {
    statusName: stage ? optionLabel(stage, cardValue(k, card, stage)) : null,
  };
  const pf = priorityFieldOf(schema);
  if (pf) out.priority = optionLabel(pf, cardValue(k, card, pf));
  const sf = sprintFieldOf(schema);
  if (sf) out.sprint = optionLabel(sf, cardValue(k, card, sf));
  for (const m of ctx.map ?? []) {
    const f = mappedKanbanField(schema, m);
    if (!f) continue;
    (out.custom ??= {})[m.tracker] = trackerValueOf(f, cardValue(k, card, f), ctx.emailOf);
  }
  return out;
}

/** The user ids a card's person fields hold (their emails are what trackers match). */
export function personValues(k: KanbanElement, card: CardElement): string[] {
  return collectionSchema(k).flatMap((f) => {
    if (f.type !== 'person') return [];
    const v = cardValue(k, card, f);
    return typeof v === 'string' ? [v] : [];
  });
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

/** The tracker's sprints as a field's options: a closed sprint read-only (#119). */
function withSprintOptions(options: readonly FieldOption[], labels: readonly string[], sprints: readonly TrackerSprint[] | null, newId: () => string): FieldOption[] {
  const closed = new Set((sprints ?? []).filter((s) => s.state === 'closed').map((s) => labelKey(s.name)));
  const known = new Set((sprints ?? []).map((s) => labelKey(s.name)));
  return withOptions(options, labels, newId).map((o) => {
    // Only what the tracker says changes an option: one it no longer lists stays as it was.
    if (!known.has(labelKey(o.label))) return o;
    const ro = closed.has(labelKey(o.label));
    if (ro === !!o.readOnly) return o;
    const { readOnly: _r, ...rest } = o;
    return ro ? { ...rest, readOnly: true as const } : rest;
  });
}

/** A tracker value as kanban field `f` stores it (labels → option ids; adding options goes through `ensure`). */
function storedValueOf(f: FieldDef, v: CustomValue | undefined, userIdOf: (email: string) => string | null): FieldValue | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (Array.isArray(v) && !v.length)) return null;
  switch (f.type) {
    case 'select': {
      const label = String(Array.isArray(v) ? v[0] : v);
      return f.options?.find((o) => labelKey(o.label) === labelKey(label))?.id;
    }
    case 'multiselect': {
      const want = new Set((Array.isArray(v) ? v : [v]).map((l) => labelKey(String(l))));
      const ids = (f.options ?? []).filter((o) => want.has(labelKey(o.label))).map((o) => o.id);
      return ids.length ? ids : null;
    }
    case 'person': {
      const email = String(v);
      if (email.startsWith('~')) return undefined;
      return userIdOf(email.toLowerCase()) ?? undefined;
    }
    default: {
      const r = readValue(f, typeof v === 'number' ? v : String(v));
      return r === null ? undefined : r;
    }
  }
}

/** The option labels a tracker value needs on a select / multi-select field. */
const labelsOf = (f: Pick<FieldDef, 'type'>, v: CustomValue | undefined): string[] =>
  v === undefined || v === null || (f.type !== 'select' && f.type !== 'multiselect') ? [] : (Array.isArray(v) ? v : [v]).map(String).filter((l) => l.trim());

/**
 * The writes that put a tracker's status and / or priority (`pull`, only the fields that changed
 * there) onto `cards` of kanban `k`: a card moves to the column of its new Stage when Stage is
 * what the board is grouped by (else its stored Stage changes), and gets its new Priority the same
 * way. A pull never adds a column for an unknown status (the import does); it does add a priority
 * level the field doesn't have yet, since the tracker's levels are the field's.
 */
export function planKanbanPull(
  view: Elements,
  k: KanbanElement,
  cards: CardElement[],
  pull: Pick<IssueValues, 'status' | 'statusName' | 'priority' | 'sprint' | 'custom'>,
  ctx: {
    newId(): string;
    moving: ReadonlySet<string>;
    /** The tracker's sprints (to mark closed ones read-only), when known. */
    sprints?: readonly TrackerSprint[] | null;
    map?: readonly FieldMapEntry[];
    userIdOf?(email: string): string | null;
  },
): KanbanPull {
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

  // Sprint (#119) and mapped fields (#43): options the field lacks are added, then the value set.
  const setFrom = (f0: FieldDef, v: CustomValue | undefined, options?: (opts: readonly FieldOption[], labels: string[]) => FieldOption[]) => {
    if (v === undefined) return;
    let f = collectionSchema(kanban).find((x) => x.id === f0.id) ?? f0;
    const labels = labelsOf(f, v);
    if (f.type === 'select' || f.type === 'multiselect') {
      const before = f.options ?? [];
      const next = options ? options(before, labels) : withOptions(before, labels, ctx.newId);
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        f = { ...f, options: next };
        const added = next.filter((o) => !before.some((b) => b.id === o.id));
        if (f.id === group && added.length) for (const o of added) kanban = addOption(kanban, collectionSchema(kanban), f, o);
        else kanban = { ...kanban, fields: storedFields(collectionSchema(kanban).map((x) => (x.id === f.id ? f : x)), group) };
        // Read-only flags of the group field's options live on its columns.
        if (f.id === group) kanban = { ...kanban, columns: kanban.columns.map((c) => ({ ...c, ...flagOf(next, c.id) })) };
        out.kanban = kanbanPatch(k, kanban);
      }
    }
    const stored = storedValueOf(f, v, ctx.userIdOf ?? (() => null));
    if (stored === undefined) return;
    for (const c of cards) {
      if (f.type === 'select' || f.id === group) setValue(c, f, typeof stored === 'string' ? stored : null);
      else {
        const values = { ...((out.cards.get(c.id)?.values as FieldValues | undefined) ?? c.values ?? {}) };
        if (JSON.stringify(values[f.id] ?? null) === JSON.stringify(stored)) continue;
        if (stored === null) delete values[f.id];
        else values[f.id] = stored;
        patch(c.id, { values });
      }
    }
  };
  const sf = sprintFieldOf(schema);
  if (sf && pull.sprint !== undefined) setFrom(sf, pull.sprint, (opts, labels) => withSprintOptions(opts, labels, ctx.sprints ?? null, ctx.newId));
  for (const m of ctx.map ?? []) {
    const f = mappedKanbanField(schema, m);
    if (f && pull.custom && m.tracker in pull.custom) setFrom(f, pull.custom[m.tracker]);
  }
  return out;
}

/** A column's read-only flag from its option (only sprint fields set one). */
function flagOf(options: readonly FieldOption[], id: string): { readOnly?: true } {
  return options.find((o) => o.id === id)?.readOnly ? { readOnly: true } : {};
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
  values: Pick<IssueValues, 'status' | 'statusName' | 'priority' | 'sprint' | 'custom'>;
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
export function planKanbanImport(
  k: KanbanElement,
  issues: ImportedIssue[],
  ctx: {
    newId(): string;
    priorities: string[] | null;
    /** The project's sprints (an import by sprint, #119): the Sprint field's options, closed ones read-only. */
    sprints?: readonly TrackerSprint[] | null;
    /** What a new sprint field is called ("Sprint", "Cycle", "Iteration"). */
    sprintFieldName?: string;
    map?: readonly FieldMapEntry[];
    userIdOf?(email: string): string | null;
  },
): KanbanImport {
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

  // Sprint (#119) and mapped fields (#43): the field the kanban has (options it lacks added), or
  // a new one shown on the cards when an issue has a value (an import by sprint always makes it).
  const groupValue = new Map<string, string>();
  const show: string[] = [];
  const ensure = (name: string, type: FieldDef['type'], existing: FieldDef | undefined, labels: string[], sprints: readonly TrackerSprint[] | null): FieldDef | undefined => {
    let f = existing;
    if (!f) {
      if (fieldNameProblem(schema, name)) return undefined;
      f = { id: ctx.newId(), name, type, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) };
      schema = [...schema, f];
      show.push(f.id);
    }
    if (f.type === 'select' || f.type === 'multiselect') {
      const before = f.options ?? [];
      const next = sprints ? withSprintOptions(before, labels, sprints, ctx.newId) : withOptions(before, labels, ctx.newId);
      if (JSON.stringify(next) !== JSON.stringify(before) || show.includes(f.id)) {
        const g = { ...f, options: next };
        if (g.id === group) {
          for (const o of next.filter((o) => !before.some((b) => b.id === o.id))) kanban = addOption(kanban, schema, g, o);
          kanban = { ...kanban, columns: kanban.columns.map((c) => ({ ...c, ...flagOf(next, c.id) })) };
        }
        schema = schema.map((x) => (x.id === g.id ? g : x));
        f = g;
      }
    }
    kanban = { ...kanban, fields: storedFields(schema, group) };
    schema = collectionSchema(kanban);
    return schema.find((x) => x.id === f!.id);
  };
  const assign = (f: FieldDef, i: ImportedIssue, v: CustomValue | undefined) => {
    const stored = storedValueOf(f, v, ctx.userIdOf ?? (() => null));
    if (stored === undefined || stored === null) return;
    if (f.id === group) groupValue.set(i.id, groupKeyOf(f, stored));
    else values.set(i.id, { ...(values.get(i.id) ?? {}), [f.id]: stored });
  };
  const sprintLabels = [
    ...(ctx.sprints ?? []).filter((s) => s.state !== 'closed').map((s) => s.name),
    ...issues.map((i) => i.values.sprint?.trim()).filter((s): s is string => !!s),
  ];
  const sprintField = sprintFieldOf(schema);
  if (sprintLabels.length || (sprintField && ctx.sprints)) {
    const sf = ensure(ctx.sprintFieldName ?? 'Sprint', 'select', sprintField, sprintLabels, ctx.sprints ?? null);
    if (sf) for (const i of issues) assign(sf, i, i.values.sprint ?? undefined);
  }
  for (const m of ctx.map ?? []) {
    const have = mappedKanbanField(schema, m);
    const vals = issues.map((i) => i.values.custom?.[m.tracker]).filter((v) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length));
    if (!have && !vals.length) continue;
    // A field of that name but another kind: left alone (the map names what it can't hold).
    if (!have && schema.some((x) => labelKey(x.name) === labelKey(m.board))) continue;
    const f = ensure(m.board, m.type, have, vals.flatMap((v) => labelsOf({ type: m.type }, v as CustomValue)), null);
    if (f) for (const i of issues) assign(f, i, i.values.custom?.[m.tracker]);
  }
  if (show.length) {
    const view = boardView(kanban);
    kanban = { ...kanban, ...savedViews(kanban, { ...view, card: { ...view.card!, show: [...view.card!.show, ...show.filter((s) => !view.card!.show.includes(s))] } }) };
  }

  // The column: the value of the field the board is grouped by.
  for (const i of issues) {
    const key = group === COLUMN_FIELD_ID ? stageOf.get(i.id) : pf && group === pf.id ? (priorityOf.get(i.id) ?? NO_GROUP) : (groupValue.get(i.id) ?? NO_GROUP);

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
