// Typed fields on a kanban's cards (docs/design/kanban-fields-and-views.md, step 2a). A kanban is a
// collection: its schema is a list of field definitions on the element (`KanbanElement.fields`),
// and each card it holds carries its values keyed by field id (`CardElement.values`). Pure: the
// web (card details, the Fields panel, the outline) and the server read fields only through here.
//
// The group field. A kanban's columns are the values of the field it is grouped by
// (`groupFieldId`: the column field "Stage" unless its board view groups by another single select,
// a person or a checkbox field, step 2c). For a select group field `columns[i].id` is the option id,
// the column's title, colour and status are the option's label, colour and status; its entry in
// `fields` holds only its name and place, never options, so an older client (or server code) that
// edits `columns` keeps the field in step by construction, and a kanban from before fields reads as
// `[Stage]` with nothing to migrate or write. A card's value for the group field is the column
// under its center: on the board the position IS the value (one write moves the card and changes
// its value; nobody ever sees a card in one column with another column's value). Every other
// field's values are stored on the cards, Stage's too while the board is grouped by something else.
// One exception (#197): a card whose last write hadn't seen the latest regroup (a drag racing it;
// an element is one value, so its x and values come from that write) stands where the earlier
// grouping put it. Its `placed` names that grouping, and it is read by its values (`stalePlacement`)
// until the layout moves it to its column.
//
// Values that don't fit their field any more (an option deleted, a field's type changed) read as
// empty; values of deleted fields stay on the cards, dormant, so undoing the delete brings them
// back without a mass write.
import type { BoardElement, CardElement, CardPlacement, CardStatus, KanbanColumn, KanbanElement } from './elements';
import { kanbanColumnAt } from './elements';
import { isISODate } from './layout/timeline';
import { plainToRichText, richTextToPlain } from './text';

export type FieldType = 'select' | 'multiselect' | 'person' | 'date' | 'number' | 'text' | 'url' | 'checkbox';

export const FIELD_TYPES: readonly FieldType[] = ['select', 'multiselect', 'person', 'date', 'number', 'text', 'url', 'checkbox'];

export interface FieldOption {
  id: string;
  /** Plain text. */
  label: string;
  /** #RRGGBB from the Freero option palette. */
  color: string;
  /** Only on the column field: the card status a card in this column takes (the column's `status`). */
  status?: CardStatus | null;
  /**
   * [additive] Kept but not offered (a tracker's closed sprint, #119): cards that hold it show it,
   * nobody picks it. Absent on every other option.
   */
  readOnly?: true;
}

export interface FieldDef {
  /** Stable: values are keyed by it. Never starts with '$' (built-in fields do). */
  id: string;
  /** Unique in the collection (case-insensitive), at most `FIELD_LIMITS.name` characters. */
  name: string;
  type: FieldType;
  /** select / multiselect, in order. The column field's are its columns (never stored here). */
  options?: FieldOption[];
}

/**
 * A stored value, in its canonical form: select = option id, multiselect = option ids (in option
 * order), person = user id, date = 'YYYY-MM-DD', number = a finite number, text / url = a string,
 * checkbox = true (unchecked = absent).
 */
export type FieldValue = string | string[] | number | true;
export type FieldValues = Record<string, FieldValue>;

export const FIELD_LIMITS = { fields: 50, name: 60, options: 200, label: 100, text: 2000, url: 2000 } as const;

/** The id and default name of every kanban's column field. */
export const COLUMN_FIELD_ID = 'stage';
export const COLUMN_FIELD_NAME = 'Stage';
/** The key of the "No <field>" group: the column (or swimlane) of cards without a value. */
export const NO_GROUP = '~none';
/** Field types a board can be grouped by (a card stands in one column): single select, person, checkbox. */
export const GROUPABLE_TYPES: readonly FieldType[] = ['select', 'person', 'checkbox'];

// ------------------------------------------------------------------ built-in card fields

/**
 * The card's own fields, with fixed ids so later views (group, sort, filter, show) treat them like
 * any other field. They stay where they are on the card (`status`, `assigneeId`, …): trackers,
 * notifications, the timeline and planning poker read them as before.
 */
export type BuiltinFieldId = '$title' | '$status' | '$assignee' | '$due' | '$start' | '$estimate' | '$tags' | '$link' | '$created' | '$updated';

export interface BuiltinField {
  id: BuiltinFieldId;
  name: string;
  /** 'timestamp': milliseconds, read-only. */
  type: FieldType | 'timestamp';
  readOnly?: true;
  /** $status: its three values. ($tags' options are the board's tag vocabulary, `tags` collection.) */
  options?: FieldOption[];
}

export const STATUS_OPTIONS: FieldOption[] = [
  { id: 'todo', label: 'To do', color: '#8A89A3', status: 'todo' },
  { id: 'doing', label: 'Doing', color: '#2E9BF0', status: 'doing' },
  { id: 'done', label: 'Done', color: '#1FA463', status: 'done' },
];

export const BUILTIN_FIELDS: readonly BuiltinField[] = [
  { id: '$title', name: 'Title', type: 'text' },
  { id: '$status', name: 'Status', type: 'select', options: STATUS_OPTIONS },
  { id: '$assignee', name: 'Assignee', type: 'person' },
  { id: '$due', name: 'Due date', type: 'date' },
  { id: '$start', name: 'Start date', type: 'date' },
  { id: '$estimate', name: 'Estimate', type: 'text' },
  { id: '$tags', name: 'Tags', type: 'multiselect' },
  { id: '$link', name: 'Link', type: 'url' },
  { id: '$created', name: 'Created', type: 'timestamp', readOnly: true },
  { id: '$updated', name: 'Updated', type: 'timestamp', readOnly: true },
];

export const isBuiltinFieldId = (id: string): id is BuiltinFieldId => BUILTIN_FIELDS.some((f) => f.id === id);

/**
 * Names a custom field can't take: the built-in fields' (and the keys a card's outline line
 * already uses), so "status" always means the card's own status.
 */
const RESERVED_NAMES = new Set(['title', 'description', 'status', 'assignee', 'due', 'due date', 'start', 'start date', 'estimate', 'tags', 'link', 'created', 'updated']);

/** Why `name` can't name a field of `schema` (other than `selfId`), or null when it can. */
export function fieldNameProblem(schema: readonly FieldDef[], name: string, selfId?: string): string | null {
  const n = name.trim();
  if (!n) return 'A field needs a name';
  if (n.length > FIELD_LIMITS.name) return `At most ${FIELD_LIMITS.name} characters`;
  if (RESERVED_NAMES.has(n.toLowerCase())) return `“${n}” is a card’s own field`;
  if (schema.some((f) => f.id !== selfId && f.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a field called “${n}”`;
  return null;
}

/** A card's built-in field value (null when empty). */
export function builtinValue(card: CardElement, id: BuiltinFieldId): FieldValue | null {
  switch (id) {
    case '$title':
      return richTextToPlain(card.title ?? '').trim() || null;
    case '$status':
      return card.status ?? null;
    case '$assignee':
      return card.assigneeId || null;
    case '$due':
      return isISODate(card.dueDate) ? card.dueDate : null;
    case '$start':
      return isISODate(card.startDate) ? card.startDate : null;
    case '$estimate':
      return card.estimate || null;
    case '$tags':
      return card.tags?.length ? [...card.tags] : null;
    case '$link':
      return card.link || null;
    case '$created':
      return card.createdAt;
    case '$updated':
      return card.updatedAt;
  }
}

/**
 * The card patch that sets built-in field `id` to `raw` (null clears it), or undefined when the
 * value doesn't fit (or the field is read-only). The start ≤ due rule is the caller's.
 */
export function builtinPatch(id: BuiltinFieldId, raw: unknown): Partial<CardElement> | undefined {
  const clear = raw === null || raw === '';
  switch (id) {
    case '$title':
      return typeof raw === 'string' || raw === null ? { title: plainToRichText((raw ?? '').slice(0, 500)) } : undefined;
    case '$status':
      return clear ? { status: null } : raw === 'todo' || raw === 'doing' || raw === 'done' ? { status: raw } : undefined;
    case '$assignee':
      return clear ? { assigneeId: null } : typeof raw === 'string' && raw.length <= 200 ? { assigneeId: raw } : undefined;
    case '$due':
      return clear ? { dueDate: null } : isISODate(raw) ? { dueDate: raw } : undefined;
    case '$start':
      return clear ? { startDate: null } : isISODate(raw) ? { startDate: raw } : undefined;
    case '$estimate':
      return clear ? { estimate: null } : typeof raw === 'string' || typeof raw === 'number' ? { estimate: String(raw).trim().slice(0, 12) || null } : undefined;
    case '$tags':
      return clear ? { tags: [] } : Array.isArray(raw) && raw.every((t) => typeof t === 'string') ? { tags: [...new Set(raw as string[])] } : undefined;
    case '$link': {
      if (clear) return { link: null };
      const url = canonicalUrl(raw);
      return url ? { link: url } : undefined;
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ the schema

type SchemaSource = Pick<KanbanElement, 'columns'> & { fields?: unknown; views?: unknown; activeView?: string };

/** The board view as stored (raw, unchecked): the active view when it is a board view, else the first one. views.ts reads it too. */
export function storedBoardView(k: { views?: unknown; activeView?: string }): Record<string, unknown> | null {
  const stored = Array.isArray(k.views) ? (k.views as unknown[]).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && (v as Record<string, unknown>).layout === 'board') : [];
  return stored.find((v) => v.id === k.activeView) ?? stored[0] ?? null;
}

/** True for a field a board can be grouped by. */
export const isGroupable = (f: Pick<FieldDef, 'id' | 'type'>) => f.id === COLUMN_FIELD_ID || GROUPABLE_TYPES.includes(f.type);

/**
 * The field the kanban is grouped by (its options / values are the columns): the board view's
 * `groupBy` when that names a stored groupable field, else the column field "Stage".
 */
export function groupFieldId(k: { fields?: unknown; views?: unknown; activeView?: string }): string {
  const by = storedBoardView(k)?.groupBy;
  if (typeof by !== 'string' || by === COLUMN_FIELD_ID || !Array.isArray(k.fields)) return COLUMN_FIELD_ID;
  const entry = (k.fields as unknown[]).find((f) => !!f && typeof f === 'object' && (f as Record<string, unknown>).id === by) as Record<string, unknown> | undefined;
  return entry && typeof entry.type === 'string' && GROUPABLE_TYPES.includes(entry.type as FieldType) ? by : COLUMN_FIELD_ID;
}

const HEX = /^#[0-9a-f]{6}$/i;
const isStatus = (s: unknown): s is CardStatus => s === 'todo' || s === 'doing' || s === 'done';

/** The columns as a select field's options (ids kept, title as plain text, colour, status); the "No value" column is no option. */
const columnOptions = (k: SchemaSource): FieldOption[] =>
  (k.columns ?? []).filter((c) => c.id !== NO_GROUP).map((c: KanbanColumn) => ({ id: c.id, label: richTextToPlain(c.title ?? '').trim(), color: c.color, status: c.status ?? null, ...(c.readOnly ? { readOnly: true as const } : {}) }));

/** A kanban's column field: its columns as options (ids kept, title as plain text, colour, status). */
export function columnField(k: SchemaSource, name?: string): FieldDef {
  return {
    id: COLUMN_FIELD_ID,
    name: name?.trim() ? name.trim().slice(0, FIELD_LIMITS.name) : COLUMN_FIELD_NAME,
    type: 'select',
    options: columnOptions(k),
  };
}

function cleanOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const { id, label, color } = o as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 64 || seen.has(id)) continue;
    seen.add(id);
    const { status, readOnly } = o as Record<string, unknown>;
    // `status`: kept on the options of a field that was a board's group field (Stage's "sets status").
    out.push({
      id,
      label: typeof label === 'string' ? label.slice(0, FIELD_LIMITS.label) : '',
      color: typeof color === 'string' && HEX.test(color) ? color : '#8A89A3',
      ...(isStatus(status) ? { status } : {}),
      ...(readOnly === true ? { readOnly: true as const } : {}),
    });
    if (out.length >= FIELD_LIMITS.options) break;
  }
  return out;
}

/**
 * The kanban's schema, in display order: the column field (synthesised for kanbans from before
 * fields, at the front) and the custom fields. Read-time and deterministic: two clients reading
 * the same element get the same schema, and `collectionSchema({ ...k, fields: storedFields(s) })`
 * is `s` again. Malformed entries (anything an API write or an old bug left) are skipped.
 */
export function collectionSchema(k: SchemaSource): FieldDef[] {
  const stored = Array.isArray(k.fields) ? (k.fields as unknown[]) : [];
  const group = groupFieldId(k);
  const out: FieldDef[] = [];
  const ids = new Set<string>();
  let column: FieldDef | null = null;
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, type, options } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 64 || id.startsWith('$') || id === '__proto__' || ids.has(id)) continue;
    ids.add(id);
    if (id === COLUMN_FIELD_ID) {
      // Stage: its options are the columns while the board is grouped by it, else stored here.
      column = group === COLUMN_FIELD_ID ? columnField(k, typeof name === 'string' ? name : undefined) : { ...columnField(k, typeof name === 'string' ? name : undefined), options: cleanOptions(options) };
      out.push(column);
      continue;
    }
    if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) continue;
    const f: FieldDef = { id, name: (typeof name === 'string' ? name.trim() : '').slice(0, FIELD_LIMITS.name) || 'Untitled', type: type as FieldType };
    if (f.type === 'select' || f.type === 'multiselect') f.options = id === group ? columnOptions(k) : cleanOptions(options);
    out.push(f);
    if (out.length > FIELD_LIMITS.fields) break;
  }
  if (!column && group === COLUMN_FIELD_ID) out.unshift(columnField(k));
  return out;
}

/**
 * What `KanbanElement.fields` stores for `schema`: the group field (`groupId`, the column field
 * unless the board is grouped by another) without its options: they are the columns.
 */
export function storedFields(schema: readonly FieldDef[], groupId: string = COLUMN_FIELD_ID): FieldDef[] {
  return schema.map((f) =>
    f.id === groupId
      ? { id: f.id, name: f.name, type: f.type }
      : { ...f, ...(f.options ? { options: f.options.map((o) => ({ id: o.id, label: o.label, color: o.color, ...(o.status ? { status: o.status } : {}), ...(o.readOnly ? { readOnly: true as const } : {}) })) } : {}) },
  );
}

// ------------------------------------------------------------------ values

/** An http(s) / mailto / tel URL as stored; a bare domain ("freero.app/x") gets https://. */
function canonicalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > FIELD_LIMITS.url || /[\u0000-\u001f\s]/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[^/]+\.[a-z]{2,}(\/|$)/i.test(s)) return null;
    s = `https://${s}`;
  }
  return /^(https?:\/\/[^/]|mailto:|tel:)/i.test(s) ? s : null;
}

/**
 * `raw` as field `f` stores it: the canonical value, null for "clear" (empty input, false
 * checkbox, no options picked), or undefined when it doesn't fit the field (an option the field
 * doesn't have, an unreadable date or number).
 */
export function canonicalValue(f: FieldDef, raw: unknown): FieldValue | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (f.type) {
    case 'select':
      return typeof raw === 'string' && f.options?.some((o) => o.id === raw) ? raw : undefined;
    case 'multiselect': {
      if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) return undefined;
      const want = new Set(raw as string[]);
      if ([...want].some((id) => !f.options?.some((o) => o.id === id))) return undefined;
      const ids = (f.options ?? []).filter((o) => want.has(o.id)).map((o) => o.id);
      return ids.length ? ids : null;
    }
    case 'person':
      return typeof raw === 'string' && raw.length <= 200 ? raw : undefined;
    case 'date':
      return isISODate(raw) ? raw : undefined;
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(raw) ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : undefined;
    }
    case 'text': {
      if (typeof raw !== 'string') return undefined;
      // Plain text: control characters out (line breaks and tabs stay), at most the limit.
      const t = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, FIELD_LIMITS.text);
      return t.trim() ? t : null;
    }
    case 'url':
      return canonicalUrl(raw) ?? undefined;
    case 'checkbox':
      return raw === true ? true : raw === false ? null : undefined;
  }
}

/** A stored value as readers see it: anything that no longer fits the field reads as empty. */
export const readValue = (f: FieldDef, raw: unknown): FieldValue | null => canonicalValue(f, raw) ?? null;

/** True for a card `k` holds (its records): the cards whose `frameId` is the kanban. */
export const isMember = (k: Pick<KanbanElement, 'id'>, el: BoardElement): el is CardElement => el.type === 'card' && el.frameId === k.id;

/** The group key a value of group field `f` stands in: an option id, a user id, 'true' / 'false', or NO_GROUP. */
export function groupKeyOf(f: Pick<FieldDef, 'type'>, v: FieldValue | null): string {
  if (f.type === 'checkbox') return v === true ? 'true' : 'false';
  return typeof v === 'string' && v ? v : NO_GROUP;
}

/** The value group key `key` (a column id) means for group field `f`; null for "No value". */
export function groupKeyValue(f: FieldDef, key: string): FieldValue | null {
  if (key === NO_GROUP) return null;
  if (f.type === 'checkbox') return key === 'true' ? true : null;
  return readValue(f, key);
}

/** Kanban `k`'s grouping now, as cards record it (`CardElement.placed.rev`). */
export const groupRevOf = (k: Pick<KanbanElement, 'groupRev'>): string => k.groupRev ?? '';

/**
 * True for a card of `k` placed under an earlier grouping of `k` (#197): someone's write that hadn't
 * seen the latest regroup won, so where it stands says nothing about the field the board is grouped
 * by now. Its values say it (`settledValues`).
 */
export function stalePlacement(k: KanbanElement, card: CardElement): boolean {
  const p = card.placed;
  return !!p && p.kanban === k.id && p.rev !== groupRevOf(k) && isMember(k, card);
}

/**
 * The values of a card of `k` as they stand once its placement is settled: a stale one's column
 * under its old grouping becomes that field's value, and the group field's value comes from what
 * it stores (dropped from its values: the column says it once it is moved there). Others: as stored.
 */
export function settledValues(k: KanbanElement, card: CardElement, schema: readonly FieldDef[] = collectionSchema(k)): FieldValues {
  const values = { ...(card.values ?? {}) };
  if (!stalePlacement(k, card)) return values;
  const p = card.placed!;
  const gid = groupFieldId(k);
  const was = p.field !== gid ? schema.find((f) => f.id === p.field) : undefined;
  if (was && isGroupable(was)) {
    const v = groupKeyValue(was, p.key);
    if (v === null) delete values[was.id];
    else values[was.id] = v;
  }
  delete values[gid];
  return values;
}

/**
 * The patch that records card `card` as put into column `key` of `k` now, by someone who sees the
 * board as it is (an agent's or a tracker's value for the group field, card details): its values
 * settled and its placement the current grouping's, so a card a regroup had left stale isn't
 * settled back into its stored value's column when the move happens to leave its x where it was.
 */
export function placedNow(k: KanbanElement, card: CardElement, key: string, schema: readonly FieldDef[] = collectionSchema(k)): { values?: FieldValues; placed: CardPlacement } {
  const values = settledValues(k, card, schema);
  const changed = JSON.stringify(values) !== JSON.stringify(card.values ?? {});
  return { ...(changed ? { values } : {}), placed: { kanban: k.id, rev: groupRevOf(k), field: groupFieldId(k), key } };
}

/**
 * Card `card`'s value for field `f` of kanban `k`: the group field's is the column under it. A card
 * placed under an earlier grouping (`stalePlacement`) is read by what it was placed for: the column
 * it was placed in is the value of the field that column stood for, and the group field's value is
 * its stored one.
 */
export function cardValue(k: KanbanElement, card: CardElement, f: FieldDef): FieldValue | null {
  const stale = stalePlacement(k, card);
  if (f.id === groupFieldId(k)) {
    if (!isMember(k, card) || !k.columns.length) return null;
    if (!stale) return groupKeyValue(f, k.columns[kanbanColumnAt(k, card.x + card.w / 2)].id);
    return card.placed!.field === f.id ? groupKeyValue(f, card.placed!.key) : readValue(f, card.values?.[f.id]);
  }
  if (stale && f.id === card.placed!.field && isGroupable(f)) return groupKeyValue(f, card.placed!.key);
  return readValue(f, card.values?.[f.id]);
}

/** The option of a select field with this label (case-insensitive), e.g. for text an agent sends. */
export const optionByLabel = (f: FieldDef, label: string): FieldOption | undefined => {
  const l = label.trim().toLowerCase();
  return l ? f.options?.find((o) => o.label.trim().toLowerCase() === l) : undefined;
};

/** A field of `schema` named by its id or its name (case-insensitive). */
export const fieldByRef = (schema: readonly FieldDef[], ref: string): FieldDef | undefined =>
  schema.find((x) => x.id === ref) ?? schema.find((x) => x.name.trim().toLowerCase() === ref.trim().toLowerCase());

/**
 * Field values as an agent (the API, MCP) sends them — `{ "<field name or id>": value }`, a select
 * option by its label or id, null to clear — read against `schema`: each field with its canonical
 * value (null: clear), or the first problem in words, naming what would have been valid. Nothing
 * is half-read: one bad entry and none of them are.
 */
export function readFieldInputs(schema: readonly FieldDef[], raw: unknown): { values: Array<{ field: FieldDef; value: FieldValue | null }> } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'fields must be an object of field name → value' };
  const names = schema.map((f) => f.name).join(', ');
  const out: Array<{ field: FieldDef; value: FieldValue | null }> = [];
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fieldByRef(schema, key);
    if (!f) return { error: `the kanban has no field “${key}” (its fields: ${names})` };
    const byLabel = (s: unknown) => (typeof s === 'string' ? ((f.options?.find((o) => o.id === s) ?? optionByLabel(f, s))?.id ?? s) : s);
    const value = canonicalValue(f, f.type === 'select' ? byLabel(v) : f.type === 'multiselect' && Array.isArray(v) ? v.map(byLabel) : v);
    if (value === undefined) {
      const choices = f.options?.length ? ` (one of: ${f.options.map((o) => o.label || 'Untitled').join(', ')})` : '';
      return { error: `“${String(typeof v === 'object' ? JSON.stringify(v) : v)}” is not a valid ${f.type} for “${f.name}”${choices}` };
    }
    out.push({ field: f, value });
  }
  return { values: out };
}

/** A value as words (labels, names, ISO dates); '' for empty. */
export function valueText(f: Pick<FieldDef, 'type' | 'options'>, v: FieldValue | null, personName?: (id: string) => string | undefined): string {
  if (v === null) return '';
  const label = (id: string) => f.options?.find((o) => o.id === id)?.label || 'Untitled';
  switch (f.type) {
    case 'select':
      return typeof v === 'string' ? label(v) : '';
    case 'multiselect':
      return Array.isArray(v) ? v.map(label).join(', ') : '';
    case 'person':
      return typeof v === 'string' ? (personName?.(v) ?? 'someone') : '';
    case 'checkbox':
      return v === true ? 'Yes' : '';
    default:
      return String(v);
  }
}
