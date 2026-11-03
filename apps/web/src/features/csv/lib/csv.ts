// CSV of stickies and task cards (KAI-136): RFC 4180 reading and writing, the columns Freero
// exports, and turning imported rows into work items. A kanban's cards bring their fields (step
// 2f): exported as one column per field, and an import onto a new kanban makes its columns from
// one CSV column (Stage) and a typed field from each other one. Pure: no editor, no DOM.
import { fieldNameProblem, inferFieldType, parseDateText, type CardStatus, type FieldType, type ItemInput } from '@freero/shared';

/** Splits CSV/TSV text into rows of cells (quotes, doubled quotes, newlines inside quotes, CRLF). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Tab when the first line has tabs (a spreadsheet's copy), ';' when it has more of those than commas, else ','. */
export function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  if (count('\t') > 0) return '\t';
  return count(';') > count(',') ? ';' : ',';
}

/**
 * One CSV cell: quoted when it holds a delimiter, quote or line break; text a spreadsheet would
 * run as a formula (=, +, -, @, or a leading tab / CR) gets a leading apostrophe so it stays text.
 */
export function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const toCsv = (rows: string[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Undoes the formula guard on import ("'=SUM(A1)" exported by Freero reads back as "=SUM(A1)"). */
export const unguard = (v: string): string => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

/** What an exported row says about one sticky or card (names, not ids). */
export interface ItemRow {
  type: 'sticky' | 'card';
  text: string;
  description: string;
  color: string;
  tags: string[];
  status: string;
  assignee: string;
  due: string;
  frame: string;
  /** A kanban card's field values as text, by field name (its Stage too). */
  fields?: Record<string, string>;
  /** [#142] A two-sided card's back text (undefined: one-sided). */
  back?: string;
}

/** The column a flip card's back goes in (only when some exported card has one). */
export const BACK_HEADER = 'Back';

export const EXPORT_HEADER = ['Type', 'Text', 'Description', 'Color', 'Tags', 'Status', 'Assignee', 'Due date', 'Frame'];
/** Tags inside one cell. */
export const TAG_SEPARATOR = '; ';

/**
 * The CSV: Freero's columns, then one per kanban field the cards have (by name, in the order they
 * first come; a name Freero's own columns use gets " (field)").
 */
export function exportRows(items: ItemRow[]): string[][] {
  const names: string[] = [];
  for (const r of items) for (const n of Object.keys(r.fields ?? {})) if (!names.includes(n)) names.push(n);
  // Flip cards (#142) export both sides: the front is Text, the back its own column.
  const backs = items.some((r) => r.back !== undefined);
  const header = backs ? [...EXPORT_HEADER, BACK_HEADER] : EXPORT_HEADER;
  const own = new Set(header.map((h) => h.toLowerCase()));
  return [
    [...header, ...names.map((n) => (own.has(n.toLowerCase()) ? `${n} (field)` : n))],
    ...items.map((r) => [
      r.type,
      r.text,
      r.description,
      r.color,
      r.tags.join(TAG_SEPARATOR),
      r.status,
      r.assignee,
      r.due,
      r.frame,
      ...(backs ? [r.back ?? ''] : []),
      ...names.map((n) => r.fields?.[n] ?? ''),
    ]),
  ];
}

/** The fields an imported column can fill. */
export type Field = 'text' | 'description' | 'tags' | 'status' | 'assignee' | 'due' | 'color' | 'type';
export const FIELDS: ReadonlyArray<{ field: Field; label: string; aliases: string[] }> = [
  { field: 'text', label: 'Text / title', aliases: ['text', 'title', 'name', 'summary', 'idea', 'note', 'task'] },
  { field: 'description', label: 'Description', aliases: ['description', 'details', 'notes', 'body'] },
  { field: 'tags', label: 'Tags', aliases: ['tags', 'tag', 'labels', 'label', 'category'] },
  { field: 'status', label: 'Status', aliases: ['status', 'state', 'stage', 'column'] },
  { field: 'assignee', label: 'Assignee', aliases: ['assignee', 'owner', 'assigned to', 'assigned', 'who'] },
  { field: 'due', label: 'Due date', aliases: ['due date', 'due', 'deadline', 'date'] },
  { field: 'color', label: 'Color', aliases: ['color', 'colour'] },
  { field: 'type', label: 'Sticky or card', aliases: ['type', 'kind'] },
];

export type Mapping = Partial<Record<Field, number>>;

/** Columns matched to fields by their header (the first column is the text when nothing matches). */
export function guessMapping(header: string[]): Mapping {
  const norm = header.map((h) => h.trim().toLowerCase());
  const out: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const i = norm.findIndex((h, j) => !used.has(j) && f.aliases.includes(h));
    if (i >= 0) {
      out[f.field] = i;
      used.add(i);
    }
  }
  if (out.text === undefined && header.length) out.text = [...header.keys()].find((j) => !used.has(j)) ?? 0;
  return out;
}

export function parseStatus(v: string): CardStatus | null {
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!s) return null;
  if (['done', 'complete', 'completed', 'closed', 'finished', 'resolved'].includes(s)) return 'done';
  if (['doing', 'in progress', 'wip', 'started', 'active', 'in review', 'review'].includes(s)) return 'doing';
  if (['todo', 'to do', 'open', 'backlog', 'new', 'not started', 'planned'].includes(s)) return 'todo';
  return null;
}

/** YYYY-MM-DD from an ISO date or a date a spreadsheet writes (31/12/2026 is read day-first, 12/31/2026 month-first). */
export const parseDue = (v: string): string | null => parseDateText(v);

export interface ImportOptions {
  /** What a row becomes unless its "Sticky or card" column says otherwise. */
  as: 'sticky' | 'card';
  mapping: Mapping;
  /** Board members by lower-cased name → id (assignees). */
  people: ReadonlyMap<string, string>;
}

/** A row turned into a work item, and the tag NAMES it carries (the board's tag ids come later). */
export interface ImportedRow {
  item: ItemInput;
  tagNames: string[];
  /** The row's cells as read (a kanban import's Stage and field columns). */
  cells: string[];
}

/** Rows (header excluded) → items. Rows without text are skipped. */
export function rowsToItems(rows: string[][], o: ImportOptions): ImportedRow[] {
  const cell = (r: string[], f: Field) => (o.mapping[f] === undefined ? '' : unguard(r[o.mapping[f]!] ?? '').trim());
  const out: ImportedRow[] = [];
  for (const r of rows) {
    const text = cell(r, 'text');
    if (!text) continue;
    const typed = cell(r, 'type').toLowerCase();
    const type = typed === 'card' || typed === 'task' ? 'card' : typed === 'sticky' || typed === 'note' ? 'sticky' : o.as;
    const tagNames = cell(r, 'tags')
      .split(/[;,|]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const assignee = cell(r, 'assignee').toLowerCase();
    const item: ItemInput = {
      type,
      text,
      ...(cell(r, 'color') ? { color: cell(r, 'color').toLowerCase() } : {}),
      ...(type === 'card'
        ? {
            description: cell(r, 'description'),
            status: parseStatus(cell(r, 'status')),
            assigneeId: (assignee && o.people.get(assignee)) || null,
            dueDate: parseDue(cell(r, 'due')),
          }
        : { status: parseStatus(cell(r, 'status')) }),
    };
    out.push({ item, tagNames, cells: r.map(unguard) });
  }
  return out;
}

// ---- onto a kanban, with fields ----

/** Headers a kanban's columns are read from, most likely first. */
const COLUMN_HEADERS = ['stage', 'column', 'phase', 'list', 'lane', 'status', 'state'];

/** The CSV column the kanban's columns come from: one headed Stage, Column, Phase…, Status; else none. */
export function guessColumnsFrom(header: string[]): number | undefined {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const name of COLUMN_HEADERS) {
    const i = norm.indexOf(name);
    if (i >= 0) return i;
  }
  return undefined;
}

/** What a CSV column becomes on the kanban: a typed field, or nothing ('skip'). */
export type FieldChoice = FieldType | 'skip';

export interface FieldColumn {
  column: number;
  name: string;
  type: FieldChoice;
  /** Why it is skipped by default (a name a card's own field has, an empty column…). */
  note?: string;
}

/** Columns Freero's own export writes that are not fields (where the card was, what it is). */
const NOT_FIELDS = new Set(['frame', 'color', 'colour', 'type']);

/**
 * The CSV columns that become the new kanban's fields, in file order, each with the type its
 * cells read as (`inferFieldType`): every column not already mapped to a card's own field and not
 * the one the columns come from. Columns named like a card's own field, repeated names and empty
 * columns are offered but skipped.
 */
export function fieldColumns(header: string[], body: string[][], mapping: Mapping, columnsFrom: number | undefined): FieldColumn[] {
  const mapped = new Set(Object.values(mapping));
  const out: FieldColumn[] = [];
  const taken: Array<{ id: string; name: string; type: FieldType }> = [];
  header.forEach((h, i) => {
    if (mapped.has(i) || i === columnsFrom) return;
    const name = h.trim().slice(0, 60) || `Column ${i + 1}`;
    if (NOT_FIELDS.has(name.toLowerCase())) return;
    const values = body.map((r) => unguard(r[i] ?? '').trim()).filter(Boolean);
    const problem = fieldNameProblem(taken, name);
    if (problem) return out.push({ column: i, name, type: 'skip', note: problem });
    if (!values.length) return out.push({ column: i, name, type: 'skip', note: 'No values' });
    const type = inferFieldType(values);
    taken.push({ id: String(i), name, type });
    out.push({ column: i, name, type });
  });
  return out;
}
