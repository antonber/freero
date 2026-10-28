// CSV of stickies and task cards (KAI-136): RFC 4180 reading and writing, the columns Freero
// exports, and turning imported rows into work items. Pure: no editor, no DOM.
import type { CardStatus, ItemInput } from '@freero/shared';

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
}

export const EXPORT_HEADER = ['Type', 'Text', 'Description', 'Color', 'Tags', 'Status', 'Assignee', 'Due date', 'Frame'];
/** Tags inside one cell. */
export const TAG_SEPARATOR = '; ';

export const exportRows = (items: ItemRow[]): string[][] => [
  EXPORT_HEADER,
  ...items.map((r) => [r.type, r.text, r.description, r.color, r.tags.join(TAG_SEPARATOR), r.status, r.assignee, r.due, r.frame]),
];

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
export function parseDue(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 9999;
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return ok(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (dmy) {
    const [a, b, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    return ok(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  return null;
}

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
    out.push({ item, tagNames });
  }
  return out;
}
