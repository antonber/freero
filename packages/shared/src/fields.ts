// Typed fields on a kanban's cards (docs/design/kanban-fields-and-views.md, step 2a). A kanban is a
// collection: its schema is a list of field definitions on the element (`KanbanElement.fields`),
// and each card it holds carries its values keyed by field id (`CardElement.values`). Pure: the
// web (card details, the Fields panel, the outline) and the server read fields only through here.
//
// The column field ("Stage"). Every kanban has one select field whose options ARE its columns:
// `columns[i].id` is the option id, the column's title, colour and status are the option's label,
// colour and status. Its entry in `fields` holds only its name and place, never options, so an
// older client (or server code) that edits `columns` keeps the field in step by construction, and a
// kanban from before fields reads as `[Stage]` with nothing to migrate or write. A card's value for
// it is the column under its center: on the board the position IS the value (one write moves the
// card and changes its stage; nobody ever sees a card in one column with another column's value).
//
// Values that don't fit their field any more (an option deleted, a field's type changed) read as
// empty; values of deleted fields stay on the cards, dormant, so undoing the delete brings them
// back without a mass write.
import type { BoardElement, CardElement, CardStatus, KanbanColumn, KanbanElement } from './elements';
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

type SchemaSource = Pick<KanbanElement, 'columns'> & { fields?: unknown };

const HEX = /^#[0-9a-f]{6}$/i;
const isStatus = (s: unknown): s is CardStatus => s === 'todo' || s === 'doing' || s === 'done';

/** A kanban's column field: its columns as options (ids kept, title as plain text, colour, status). */
export function columnField(k: SchemaSource, name?: string): FieldDef {
  return {
    id: COLUMN_FIELD_ID,
    name: name?.trim() ? name.trim().slice(0, FIELD_LIMITS.name) : COLUMN_FIELD_NAME,
    type: 'select',
    options: (k.columns ?? []).map((c: KanbanColumn) => ({ id: c.id, label: richTextToPlain(c.title ?? '').trim(), color: c.color, status: c.status ?? null })),
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
    out.push({ id, label: typeof label === 'string' ? label.slice(0, FIELD_LIMITS.label) : '', color: typeof color === 'string' && HEX.test(color) ? color : '#8A89A3' });
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
  const out: FieldDef[] = [];
  const ids = new Set<string>();
  let column: FieldDef | null = null;
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, type, options } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 64 || id.startsWith('$') || id === '__proto__' || ids.has(id)) continue;
    ids.add(id);
    if (id === COLUMN_FIELD_ID) {
      column = columnField(k, typeof name === 'string' ? name : undefined);
      out.push(column);
      continue;
    }
    if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) continue;
    const f: FieldDef = { id, name: (typeof name === 'string' ? name.trim() : '').slice(0, FIELD_LIMITS.name) || 'Untitled', type: type as FieldType };
    if (f.type === 'select' || f.type === 'multiselect') f.options = cleanOptions(options);
    out.push(f);
    if (out.length > FIELD_LIMITS.fields) break;
  }
  if (!column) out.unshift(columnField(k));
  return out;
}

/** What `KanbanElement.fields` stores for `schema`: the column field without its options (they are the columns). */
export function storedFields(schema: readonly FieldDef[]): FieldDef[] {
  return schema.map((f) => (f.id === COLUMN_FIELD_ID ? { id: f.id, name: f.name, type: 'select' } : { ...f, ...(f.options ? { options: f.options.map((o) => ({ id: o.id, label: o.label, color: o.color })) } : {}) }));
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

/** Card `card`'s value for field `f` of kanban `k`: the column field's is the column under it. */
export function cardValue(k: KanbanElement, card: CardElement, f: FieldDef): FieldValue | null {
  if (f.id === COLUMN_FIELD_ID) return isMember(k, card) && k.columns.length ? k.columns[kanbanColumnAt(k, card.x + card.w / 2)].id : null;
  return readValue(f, card.values?.[f.id]);
}

/** The option of a select field with this label (case-insensitive), e.g. for text an agent sends. */
export const optionByLabel = (f: FieldDef, label: string): FieldOption | undefined => {
  const l = label.trim().toLowerCase();
  return l ? f.options?.find((o) => o.label.trim().toLowerCase() === l) : undefined;
};

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
