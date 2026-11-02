// Filters and sorts over typed values (docs/design/kanban-fields-and-views.md, step 2d): the ONE
// implementation behind the free-form table's typed columns (features/table reads its cells as
// QueryValues), a kanban's view of its cards (the board layout hides cards its filter leaves out and
// orders them by its sort; the View panel; the outline) and the server (query_cards,
// configure_view). Pure.
//
// A value is read into a QueryValue first — its kind, the typed value, its words (labels) and, for
// options, its place in the field's option order — so the rules below never know where a value is
// stored. Sorting never depends on anything a client knows and another doesn't (people's names,
// the time zone, the browser's language): a kanban's sorted order is shared geometry, every client
// and the server must compute the same one. That is why a person sorts by user id on a kanban, a
// timestamp reads as its UTC day, and text compares in one fixed collation.
import type { CardElement, KanbanElement } from './elements';
import {
  BUILTIN_FIELDS,
  STATUS_OPTIONS,
  builtinValue,
  cardValue,
  isBuiltinFieldId,
  optionByLabel,
  type FieldDef,
  type FieldOption,
  type FieldValue,
} from './fields';
import { isISODate } from './layout/timeline';

/** How a filter rule compares (which ones a field takes: `opsFor`). gt / lt on a date: after / before. */
export type FilterOp = 'is' | 'isNot' | 'anyOf' | 'noneOf' | 'contains' | 'notContains' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'checked' | 'unchecked' | 'isMe';
export const FILTER_OPS: readonly FilterOp[] = ['is', 'isNot', 'anyOf', 'noneOf', 'contains', 'notContains', 'empty', 'notEmpty', 'gt', 'lt', 'checked', 'unchecked', 'isMe'];

/** What a value is, for filtering and sorting. */
export type QueryKind = 'text' | 'number' | 'date' | 'option' | 'options' | 'person' | 'checkbox';

export interface QueryValue {
  kind: QueryKind;
  /**
   * The typed value; null when empty or unreadable. text: the string; number: a number; date:
   * 'YYYY-MM-DD'; option: an option id (a table's select: its label); options: option ids;
   * person: a user id; checkbox: true.
   */
  value: string | number | string[] | true | null;
  /** The value as words: what `contains` and a text `is` compare (labels, a name, the text). */
  text: string;
  /** option / options: the (first) option's place in the field's option order. */
  rank?: number;
  /** Set when "empty" isn't "no typed value" (a table cell holding text a number column can't read is not empty). */
  empty?: boolean;
}

/** The rules a kind of value takes, in the order a picker offers them. */
export const OPS_BY_KIND: Record<QueryKind, readonly FilterOp[]> = {
  text: ['contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty'],
  number: ['is', 'isNot', 'gt', 'lt', 'empty', 'notEmpty'],
  date: ['is', 'gt', 'lt', 'empty', 'notEmpty'],
  option: ['is', 'isNot', 'anyOf', 'noneOf', 'empty', 'notEmpty'],
  options: ['anyOf', 'noneOf', 'empty', 'notEmpty'],
  person: ['is', 'isNot', 'anyOf', 'noneOf', 'isMe', 'empty', 'notEmpty'],
  checkbox: ['checked', 'unchecked'],
};
/** Rules that compare with nothing. */
export const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set(['empty', 'notEmpty', 'checked', 'unchecked', 'isMe']);

const lower = (s: string) => s.trim().toLowerCase();

/** A number from what someone typed ("1,234.5", " 7 ") or sent; null if it isn't one. */
export function readNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/[\s,](?=\d{3}\b)/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Whether `q` holds the single value `want` (an id, a label, a number, an ISO date, words). */
function equals(q: QueryValue, want: unknown): boolean {
  switch (q.kind) {
    case 'number': {
      const n = readNumber(want);
      return n !== null && typeof q.value === 'number' && q.value === n;
    }
    case 'checkbox':
      return (want === true || want === 'true') === (q.value === true);
    case 'person':
      return typeof want === 'string' && q.value === want;
    case 'options':
      return typeof want === 'string' && Array.isArray(q.value) && q.value.includes(want);
    case 'date':
    case 'option':
      if (typeof want !== 'string' || !want.trim()) return false;
      return q.value === want || (!!q.text && lower(q.text) === lower(want));
    default:
      return typeof want === 'string' && lower(q.text) === lower(want);
  }
}

/** Whether `q` passes rule `op` (with `want`). `me`: who "is me" means (personal filters only). */
export function matchValue(q: QueryValue, op: FilterOp, want?: unknown, ctx: { me?: string } = {}): boolean {
  const empty = q.empty ?? (q.value === null || (Array.isArray(q.value) && !q.value.length));
  switch (op) {
    case 'empty':
      return empty;
    case 'notEmpty':
      return !empty;
    case 'checked':
      return q.value === true;
    case 'unchecked':
      return q.value !== true;
    case 'isMe':
      return !!ctx.me && q.kind === 'person' && q.value === ctx.me;
    case 'contains':
    case 'notContains': {
      const w = typeof want === 'string' || typeof want === 'number' ? lower(String(want)) : '';
      const hit = q.text.toLowerCase().includes(w);
      return op === 'contains' ? hit : !hit;
    }
    case 'is':
    case 'isNot': {
      const hit = Array.isArray(want) ? want.some((w) => equals(q, w)) : equals(q, want);
      return op === 'is' ? hit : !hit;
    }
    case 'anyOf':
    case 'noneOf': {
      const list = Array.isArray(want) ? want : want === undefined || want === null ? [] : [want];
      const hit = list.some((w) => equals(q, w));
      return op === 'anyOf' ? hit : !hit;
    }
    case 'gt':
    case 'lt': {
      const sign = op === 'gt' ? 1 : -1;
      if (q.kind === 'number') {
        const n = readNumber(want);
        return n !== null && typeof q.value === 'number' && sign * (q.value - n) > 0;
      }
      if (q.kind === 'date') return typeof q.value === 'string' && isISODate(want) && sign * q.value.localeCompare(want) > 0;
      return false;
    }
  }
}

// ------------------------------------------------------------------ sort

/** What `q` sorts by; null for empty, which sorts last in both directions. */
function sortKey(q: QueryValue): number | string | null {
  switch (q.kind) {
    case 'number':
      return typeof q.value === 'number' ? q.value : null;
    case 'date':
      return typeof q.value === 'string' ? q.value : null;
    case 'checkbox':
      return q.value === true ? 1 : null;
    case 'option':
    case 'options':
      return q.value === null || (Array.isArray(q.value) && !q.value.length) ? null : (q.rank ?? 1000);
    case 'person':
      return q.value === null ? null : q.text ? q.text.toLowerCase() : String(q.value);
    default:
      return q.text.trim() ? q.text.toLowerCase() : null;
  }
}

/** One fixed collation (numbers in text by value: "Item 9" before "Item 10"), the same on every client and the server. */
const collate = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** -1 / 0 / 1 for two values sorted ascending; empty ones always last. */
export function compareValues(a: QueryValue | null, b: QueryValue | null, dir: 'asc' | 'desc' = 'asc'): number {
  const ka = a ? sortKey(a) : null;
  const kb = b ? sortKey(b) : null;
  if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
  const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collate(String(ka), String(kb));
  return (dir === 'asc' ? 1 : -1) * Math.sign(c);
}

/** `items` in the order `rules` give (stable: ties keep their order), each rule a tie-breaker for the one before. */
export function sortByValues<T>(items: readonly T[], rules: ReadonlyArray<{ read: (item: T) => QueryValue | null; dir: 'asc' | 'desc' }>): T[] {
  if (!rules.length) return [...items];
  const keyed = items.map((item, i) => ({ item, i, vs: rules.map((r) => r.read(item)) }));
  keyed.sort((a, b) => {
    for (let r = 0; r < rules.length; r++) {
      const c = compareValues(a.vs[r], b.vs[r], rules[r].dir);
      if (c) return c;
    }
    return a.i - b.i;
  });
  return keyed.map((k) => k.item);
}

// ------------------------------------------------------------------ a view's filter and sort

export interface FilterRule {
  /** A custom field id or a built-in id ($status, $due …). */
  field: string;
  op: FilterOp;
  /** What it compares with: an option id, a user id, a number, 'YYYY-MM-DD', words; several for anyOf / noneOf. */
  value?: string | number | boolean | string[];
}

/** A view's filter: its rules, all of which (`and`) or any of which (`or`) a card must pass. One level, no nesting. */
export interface ViewFilter {
  op: 'and' | 'or';
  rules: FilterRule[];
}

export interface SortRule {
  field: string;
  dir: 'asc' | 'desc';
}

export const QUERY_LIMITS = { rules: 20, sorts: 3, values: 50, text: 200 } as const;

const isFieldRef = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && v !== '__proto__';

function cleanRuleValue(v: unknown): FilterRule['value'] | undefined {
  if (typeof v === 'string') return v.slice(0, QUERY_LIMITS.text);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const list = v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, QUERY_LIMITS.text)).slice(0, QUERY_LIMITS.values);
    return list.length ? list : undefined;
  }
  return undefined;
}

/**
 * A filter as stored (anything malformed dropped), or null when it has no rules. `isMe` depends on
 * who looks, so only a personal filter keeps it: a saved filter decides which cards stand on the
 * shared board, and every client must decide the same.
 */
export function cleanFilter(raw: unknown, opts: { personal?: boolean } = {}): ViewFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rules: FilterRule[] = [];
  for (const x of Array.isArray(r.rules) ? r.rules : []) {
    if (!x || typeof x !== 'object') continue;
    const { field, op, value } = x as Record<string, unknown>;
    if (!isFieldRef(field) || !(FILTER_OPS as readonly unknown[]).includes(op)) continue;
    if (op === 'isMe' && !opts.personal) continue;
    const v = VALUELESS_OPS.has(op as FilterOp) ? undefined : cleanRuleValue(value);
    if (!VALUELESS_OPS.has(op as FilterOp) && v === undefined) continue;
    rules.push({ field, op: op as FilterOp, ...(v !== undefined ? { value: v } : {}) });
    if (rules.length >= QUERY_LIMITS.rules) break;
  }
  return rules.length ? { op: r.op === 'or' ? 'or' : 'and', rules } : null;
}

/** A sort as stored: at most a few rules, each field once. Empty = manual order. */
export function cleanSort(raw: unknown): SortRule[] {
  if (!Array.isArray(raw)) return [];
  const out: SortRule[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const { field, dir } = x as Record<string, unknown>;
    if (!isFieldRef(field) || out.some((s) => s.field === field)) continue;
    out.push({ field, dir: dir === 'desc' ? 'desc' : 'asc' });
    if (out.length >= QUERY_LIMITS.sorts) break;
  }
  return out;
}

/** Two filters the same (null = none). */
export const sameFilter = (a: ViewFilter | null | undefined, b: ViewFilter | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Whether a reading passes `filter` (no filter: everything does). Rules on fields that are gone are left out. */
export function passesFilter(filter: ViewFilter | null | undefined, read: (field: string) => QueryValue | null, ctx: { me?: string } = {}): boolean {
  if (!filter?.rules.length) return true;
  const results: boolean[] = [];
  for (const r of filter.rules) {
    const q = read(r.field);
    if (q) results.push(matchValue(q, r.op, r.value, ctx));
  }
  if (!results.length) return true;
  return filter.op === 'or' ? results.some(Boolean) : results.every(Boolean);
}

// ------------------------------------------------------------------ a kanban's cards

/** A field (custom or built-in) of a kanban as filters and sorts see it. */
export interface QueryField {
  id: string;
  name: string;
  kind: QueryKind;
  options?: readonly FieldOption[];
  /** False for fields a board can't be sorted by (several options; tags). */
  sortable: boolean;
}

const KIND_OF: Record<string, QueryKind> = {
  select: 'option',
  multiselect: 'options',
  person: 'person',
  date: 'date',
  timestamp: 'date',
  number: 'number',
  text: 'text',
  url: 'text',
  checkbox: 'checkbox',
};

/** Field `id` of `schema` (a custom field, or a built-in one) as filters and sorts see it; null when there is no such field. */
export function queryField(schema: readonly FieldDef[], id: string): QueryField | null {
  if (isBuiltinFieldId(id)) {
    const b = BUILTIN_FIELDS.find((f) => f.id === id)!;
    const kind = KIND_OF[b.type];
    return { id, name: b.name, kind, ...(id === '$status' ? { options: STATUS_OPTIONS } : {}), sortable: kind !== 'options' };
  }
  const f = schema.find((x) => x.id === id);
  if (!f) return null;
  const kind = KIND_OF[f.type];
  return { id, name: f.name, kind, ...(f.options ? { options: f.options } : {}), sortable: kind !== 'options' };
}

/** Every field of `schema` (built-in ones first) as filters see them. */
export function queryFields(schema: readonly FieldDef[]): QueryField[] {
  return [...BUILTIN_FIELDS.map((b) => queryField(schema, b.id)!), ...schema.map((f) => queryField(schema, f.id)!)];
}

/** A timestamp's UTC day: the same on every client, whatever its time zone. */
const utcDay = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);

/** A typed field value read for filtering and sorting, given the field's kind and options. */
export function queryValueOf(f: Pick<QueryField, 'kind' | 'options'>, v: FieldValue | null): QueryValue {
  const label = (id: string) => f.options?.find((o) => o.id === id)?.label ?? '';
  const rank = (id: string) => {
    const i = f.options?.findIndex((o) => o.id === id) ?? -1;
    return i >= 0 ? i : 1000;
  };
  switch (f.kind) {
    case 'option':
      return typeof v === 'string' ? { kind: 'option', value: v, text: label(v), rank: rank(v) } : { kind: 'option', value: null, text: '' };
    case 'options': {
      const ids = Array.isArray(v) ? v : [];
      return { kind: 'options', value: ids, text: ids.map(label).join(', '), ...(ids.length ? { rank: rank(ids[0]) } : {}) };
    }
    case 'number':
      return { kind: 'number', value: typeof v === 'number' ? v : null, text: typeof v === 'number' ? String(v) : '' };
    case 'checkbox':
      return { kind: 'checkbox', value: v === true ? true : null, text: v === true ? 'Yes' : '' };
    case 'person':
      // Names aren't known everywhere (and change): a person compares and sorts by user id.
      return { kind: 'person', value: typeof v === 'string' && v ? v : null, text: '' };
    case 'date':
      return { kind: 'date', value: typeof v === 'string' && isISODate(v) ? v : null, text: typeof v === 'string' ? v : '' };
    default:
      return { kind: 'text', value: typeof v === 'string' && v ? v : null, text: typeof v === 'string' ? v : '' };
  }
}

/** Card `card`'s field `id` of kanban `k` (schema `schema`) as filters and sorts read it; null when the kanban has no such field. */
export function cardQueryValue(k: KanbanElement, card: CardElement, id: string, schema: readonly FieldDef[]): QueryValue | null {
  const f = queryField(schema, id);
  if (!f) return null;
  if (isBuiltinFieldId(id)) {
    const raw = builtinValue(card, id);
    return queryValueOf(f, id === '$created' || id === '$updated' ? utcDay(raw) : raw);
  }
  return queryValueOf(f, cardValue(k, card, schema.find((x) => x.id === id)!));
}

/** Whether card `card` of kanban `k` passes `filter`. */
export function cardPasses(k: KanbanElement, card: CardElement, filter: ViewFilter | null | undefined, schema: readonly FieldDef[], ctx: { me?: string } = {}): boolean {
  return passesFilter(filter, (id) => cardQueryValue(k, card, id, schema), ctx);
}

/** `cards` of kanban `k` in the order `sort` gives (stable). */
export function sortCards<T extends CardElement>(k: KanbanElement, cards: readonly T[], sort: readonly SortRule[], schema: readonly FieldDef[]): T[] {
  return sortByValues(
    cards,
    sort.filter((s) => queryField(schema, s.field)?.sortable).map((s) => ({ read: (c: T) => cardQueryValue(k, c, s.field, schema), dir: s.dir })),
  );
}

/**
 * Why `filter` can't be a view's filter on `schema` (an unknown field, a rule the field doesn't
 * take, a value it can't compare with), or null when it can.
 */
export function filterProblem(filter: ViewFilter | null, schema: readonly FieldDef[]): string | null {
  for (const r of filter?.rules ?? []) {
    const f = queryField(schema, r.field);
    if (!f) return `There is no field “${r.field}”`;
    if (!OPS_BY_KIND[f.kind].includes(r.op)) return `“${f.name}” can’t be filtered with ${r.op} (it takes ${OPS_BY_KIND[f.kind].join(', ')})`;
    if (VALUELESS_OPS.has(r.op)) continue;
    const vals = Array.isArray(r.value) ? r.value : [r.value];
    if (f.kind === 'number' && vals.some((v) => readNumber(v) === null)) return `“${f.name}” compares with a number`;
    if (f.kind === 'date' && vals.some((v) => !isISODate(v))) return `“${f.name}” compares with a date (YYYY-MM-DD)`;
    if (f.kind === 'option' || f.kind === 'options') {
      const bad = vals.find((v) => typeof v !== 'string' || (f.options && f.id !== '$tags' && !f.options.some((o) => o.id === v)));
      if (bad !== undefined) return `“${String(bad)}” is no option of “${f.name}”`;
    }
  }
  return null;
}

/** A rule's value with select options named by label turned into their ids (what an agent or person types). */
export function ruleValueByLabel(f: QueryField, v: FilterRule['value']): FilterRule['value'] {
  if ((f.kind !== 'option' && f.kind !== 'options') || !f.options) return v;
  const id = (x: unknown) => (typeof x === 'string' ? (f.options!.find((o) => o.id === x) ?? optionByLabel({ options: [...f.options!] } as FieldDef, x))?.id ?? x : x);
  return Array.isArray(v) ? v.map((x) => id(x) as string) : (id(v) as FilterRule['value']);
}

const OP_WORDS: Record<FilterOp, string> = {
  is: 'is',
  isNot: 'is not',
  anyOf: 'is any of',
  noneOf: 'is none of',
  contains: 'contains',
  notContains: 'does not contain',
  empty: 'is empty',
  notEmpty: 'is not empty',
  gt: '>',
  lt: '<',
  checked: 'is checked',
  unchecked: 'is not checked',
  isMe: 'is me',
};

/** A filter in words, for the outline and agents: `Priority is P1 and Points > 3` (labels and names, not ids). */
export function describeFilter(filter: ViewFilter | null | undefined, schema: readonly FieldDef[], personName?: (id: string) => string | undefined): string {
  if (!filter?.rules.length) return '';
  const parts = filter.rules.map((r) => {
    const f = queryField(schema, r.field);
    const name = f?.name ?? r.field;
    const op = f?.kind === 'date' && (r.op === 'gt' || r.op === 'lt') ? (r.op === 'gt' ? 'is after' : 'is before') : OP_WORDS[r.op];
    if (VALUELESS_OPS.has(r.op)) return `${name} ${op}`;
    const word = (v: unknown) =>
      typeof v !== 'string'
        ? String(v)
        : f?.kind === 'option' || f?.kind === 'options'
          ? (f.options?.find((o) => o.id === v)?.label ?? v)
          : f?.kind === 'person'
            ? (personName?.(v) ?? 'someone')
            : v;
    const value = Array.isArray(r.value) ? r.value.map(word).join(' | ') : word(r.value);
    return `${name} ${op} ${value}`;
  });
  return parts.join(filter.op === 'or' ? ' or ' : ' and ');
}

/** A sort in words: `Points (descending), Title`. */
export function describeSort(sort: readonly SortRule[] | null | undefined, schema: readonly FieldDef[]): string {
  return (sort ?? []).map((s) => `${queryField(schema, s.field)?.name ?? s.field}${s.dir === 'desc' ? ' (descending)' : ''}`).join(', ');
}
