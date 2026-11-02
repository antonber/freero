// Typed columns (KAI-123). Pure: what a column's cells hold, how they read, sort, filter and
// convert. A typed cell is stored in `tableCells` as its canonical plain value (see TableColumn in
// @freero/shared), so everything here works on the raw stored string. Words are read by
// @freero/shared fieldText.ts and values filtered and sorted by query.ts — the same rules a
// kanban's fields, the CSV import and the trackers use; only the table's own storage lives here.
import { nanoid } from 'nanoid';
import { inferFieldType, matchValue, parseCheckboxText, parseDateText, parseNumberText, plainToRichText, richTextToPlain, sortByValues, timelineLayout, type QueryValue, type TableColumn, type TableColumnType, type TableElement, type TableFilter, type TableSelectOption } from '@freero/shared';

export const COLUMN_TYPES: Array<{ value: TableColumnType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'person', label: 'Person' },
  { value: 'checkbox', label: 'Checkbox' },
];

/** Select option tints (Freero's palette), in the order new options take them. */
export const OPTION_COLORS = ['#E9E4FF', '#DDF0FF', '#DDF6EA', '#FFF1D6', '#FFE3E0', '#FDE2F3', '#E6E6EA'];

export const typeOf = (col: Pick<TableColumn, 'type'> | undefined): TableColumnType => col?.type ?? 'text';

const { isISODate } = timelineLayout;

/** A typed number as stored ("1234.5"), from what someone typed or pasted ("1,234.50", " 7 "); null if it isn't one. */
export function parseNumber(text: string): string | null {
  const n = parseNumberText(text);
  return n === null ? null : String(n);
}

/** A date as stored (YYYY-MM-DD) from an ISO date or a spreadsheet's day/month/year; null otherwise (and for one that reads both ways: no guessing). */
export const parseDate = (text: string): string | null => parseDateText(text, { dayFirst: false });

export const parseCheckbox = parseCheckboxText;

export interface PeopleLookup {
  /** A person's name by user id (members of the board). */
  name(id: string): string | undefined;
  /** A member's id by name or email (case-insensitive), for pasted / converted text. */
  idOf?(nameOrEmail: string): string | undefined;
}

/** What a typed cell reads as: plain text (a text cell: its plain text). */
export function displayValue(col: TableColumn | undefined, raw: string, people?: PeopleLookup): string {
  if (!raw) return '';
  switch (typeOf(col)) {
    case 'text':
      return richTextToPlain(raw).replace(/\n+$/, '');
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) && parseNumber(raw) !== null ? n.toLocaleString('en-US', { maximumFractionDigits: 10 }) : richTextToPlain(raw);
    }
    case 'date':
      return isISODate(raw) ? formatDate(raw) : richTextToPlain(raw);
    case 'select':
      return richTextToPlain(raw);
    case 'person':
      return people?.name(raw) ?? 'Unknown person';
    case 'checkbox':
      return raw === 'true' ? 'Yes' : '';
  }
}

/** The value as a CSV / clipboard cell: numbers and dates in the form spreadsheets read back. */
export function exportValue(col: TableColumn | undefined, raw: string, people?: PeopleLookup): string {
  switch (typeOf(col)) {
    case 'number':
    case 'date':
    case 'select':
      return richTextToPlain(raw);
    case 'checkbox':
      return raw === 'true' ? 'TRUE' : 'FALSE';
    default:
      return displayValue(col, raw, people);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export const optionOf = (col: TableColumn | undefined, raw: string): TableSelectOption | undefined => {
  const label = richTextToPlain(raw).trim().toLowerCase();
  return label ? col?.options?.find((o) => o.label.trim().toLowerCase() === label) : undefined;
};

// ------------------------------------------------------------------ sort and filter

/**
 * A cell as filters and sorts read it (@freero/shared query.ts: the one implementation the table
 * and kanbans share). A select cell holds its label, so its value is the label and its rank the
 * option's place (unknown labels after the options); text a typed column can't read is no value
 * but not empty either.
 */
export function queryValue(col: TableColumn | undefined, raw: string, people?: PeopleLookup): QueryValue {
  const text = raw ? displayValue(col, raw, people) : '';
  const empty = !richTextToPlain(raw).trim();
  switch (typeOf(col)) {
    case 'number':
      return { kind: 'number', value: parseNumber(raw) !== null ? Number(raw) : null, text, empty };
    case 'date':
      return { kind: 'date', value: isISODate(raw) ? raw : null, text, empty };
    case 'checkbox':
      return { kind: 'checkbox', value: raw === 'true' ? true : null, text };
    case 'select': {
      const i = col?.options?.findIndex((o) => o === optionOf(col, raw)) ?? -1;
      return { kind: 'option', value: empty ? null : richTextToPlain(raw).trim(), text, rank: i >= 0 ? i : 1000, empty };
    }
    case 'person':
      return { kind: 'person', value: raw || null, text: raw ? text : '', empty };
    default:
      return { kind: 'text', value: text.trim() ? text : null, text, empty };
  }
}

/**
 * The rows in the order sorting by `col` gives (stable; the header row stays first, empty cells
 * last in both directions). `get(rowId)` is the raw cell of that row in that column.
 */
export function sortedRows<R extends { id: string }>(
  rows: R[],
  header: boolean,
  col: TableColumn,
  dir: 'asc' | 'desc',
  get: (rowId: string) => string,
  people?: PeopleLookup,
): R[] {
  const head = header && rows.length ? [rows[0]] : [];
  return [...head, ...sortByValues(rows.slice(head.length), [{ read: (r) => queryValue(col, get(r.id), people), dir }])];
}

export const FILTER_OPS: Record<TableColumnType, Array<{ value: TableFilter['op']; label: string; needsValue: boolean }>> = {
  text: [
    { value: 'contains', label: 'contains', needsValue: true },
    { value: 'is', label: 'is', needsValue: true },
    { value: 'empty', label: 'is empty', needsValue: false },
    { value: 'notEmpty', label: 'is not empty', needsValue: false },
  ],
  number: [
    { value: 'is', label: '=', needsValue: true },
    { value: 'gt', label: '>', needsValue: true },
    { value: 'lt', label: '<', needsValue: true },
    { value: 'empty', label: 'is empty', needsValue: false },
    { value: 'notEmpty', label: 'is not empty', needsValue: false },
  ],
  date: [
    { value: 'is', label: 'is', needsValue: true },
    { value: 'gt', label: 'is after', needsValue: true },
    { value: 'lt', label: 'is before', needsValue: true },
    { value: 'empty', label: 'is empty', needsValue: false },
    { value: 'notEmpty', label: 'is not empty', needsValue: false },
  ],
  select: [
    { value: 'is', label: 'is', needsValue: true },
    { value: 'empty', label: 'is empty', needsValue: false },
    { value: 'notEmpty', label: 'is not empty', needsValue: false },
  ],
  person: [
    { value: 'is', label: 'is', needsValue: true },
    { value: 'empty', label: 'is empty', needsValue: false },
    { value: 'notEmpty', label: 'is not empty', needsValue: false },
  ],
  checkbox: [
    { value: 'checked', label: 'is checked', needsValue: false },
    { value: 'unchecked', label: 'is not checked', needsValue: false },
  ],
};

/** Whether a row's cell in the filtered column passes the filter. */
export function passes(filter: TableFilter, col: TableColumn | undefined, raw: string, people?: PeopleLookup): boolean {
  return matchValue(queryValue(col, raw, people), filter.op, (filter.value ?? '').trim());
}

/**
 * The rows a table shows: all of them without a filter (or with one on a column that is gone),
 * else the header row plus the rows whose cell passes. Order kept.
 */
export function visibleRows<R extends { id: string }>(
  el: Pick<TableElement, 'header' | 'filter' | 'cols'> & { rows: R[] },
  get: (rowId: string, colId: string) => string,
  people?: PeopleLookup,
): R[] {
  const f = el.filter;
  const col = f ? el.cols.find((c) => c.id === f.colId) : undefined;
  if (!f || !col) return el.rows;
  return el.rows.filter((r, i) => (el.header && i === 0) || passes(f, col, get(r.id, col.id), people));
}

// ------------------------------------------------------------------ typing values

/**
 * What to store for `text` typed into (or pasted / imported into) a cell of `col`: the canonical
 * value, '' to clear it, or — when the text doesn't read as that type — the text itself as plain
 * RichText, so nothing typed is ever lost (it shows as unreadable until fixed).
 */
export function valueFor(col: TableColumn | undefined, text: string, people?: PeopleLookup): string {
  const t = text.trim();
  if (!t) return '';
  switch (typeOf(col)) {
    case 'text':
      return plainToRichText(text);
    case 'number':
      return parseNumber(t) ?? plainToRichText(t);
    case 'date':
      return parseDate(t) ?? plainToRichText(t);
    case 'checkbox':
      return parseCheckbox(t) === false ? '' : 'true';
    case 'select': {
      const hit = col?.options?.find((o) => o.label.trim().toLowerCase() === t.toLowerCase());
      return plainToRichText(hit?.label ?? t);
    }
    case 'person':
      return people?.idOf?.(t) ?? (people?.name(t) ? t : plainToRichText(t));
  }
}

/** Whether a stored value is readable as its column's type (else it is drawn as unreadable text). */
export function isValid(col: TableColumn | undefined, raw: string): boolean {
  if (!raw) return true;
  switch (typeOf(col)) {
    case 'number':
      return parseNumber(raw) !== null;
    case 'date':
      return isISODate(raw);
    case 'checkbox':
      return raw === 'true';
    default:
      return true;
  }
}

/**
 * Changing a column's type: the column as it becomes (a select gets an option for every distinct
 * value its cells hold) and each cell's new value, read from its old one's text. Values that don't
 * read as the new type are kept as text (see valueFor), so converting back loses nothing typed.
 */
export function convertColumn(
  col: TableColumn,
  to: TableColumnType,
  cells: Array<{ rowId: string; raw: string }>,
  people?: PeopleLookup,
  newId: () => string = () => nanoid(8),
): { col: TableColumn; cells: Array<{ rowId: string; raw: string }> } {
  const from = typeOf(col);
  const text = (raw: string) => (from === 'checkbox' ? (raw === 'true' ? 'true' : '') : from === 'person' ? (people?.name(raw) ?? '') : displayRaw(from, raw));
  let next: TableColumn = { id: col.id, w: col.w, ...(to === 'text' ? {} : { type: to }) };
  if (to === 'select') {
    const options: TableSelectOption[] = [...(col.options ?? [])];
    for (const c of cells) {
      const label = text(c.raw).trim();
      if (label && !options.some((o) => o.label.toLowerCase() === label.toLowerCase()) && options.length < 50)
        options.push({ id: newId(), label, color: OPTION_COLORS[options.length % OPTION_COLORS.length] });
    }
    next = { ...next, options };
  } else if (col.options?.length) next = { ...next, options: col.options };
  const nextCells = cells.map((c) => {
    if (from === 'text' && to === 'text') return c;
    const v = text(c.raw);
    if (to === 'text') return { rowId: c.rowId, raw: v ? plainToRichText(v) : '' };
    return { rowId: c.rowId, raw: valueFor(next, v, people) };
  });
  return { col: next, cells: nextCells };
}

/** A stored value's plain text by its column type (numbers and dates as stored, not formatted). */
function displayRaw(type: TableColumnType, raw: string): string {
  return type === 'text' ? richTextToPlain(raw).replace(/\n+$/, '') : richTextToPlain(raw);
}

/**
 * The type a pasted / imported column reads as (fieldText.ts `inferFieldType`): number, checkbox or
 * date when every non-empty value is one (at least two values), else text. Selects, links and
 * people are never guessed.
 */
export function inferType(values: string[]): TableColumnType {
  if (values.filter((v) => v.trim()).length < 2) return 'text';
  const t = inferFieldType(values, { choices: false, dayFirst: false });
  return t === 'number' || t === 'date' || t === 'checkbox' ? t : 'text';
}
