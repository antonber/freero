// Table structure (pure, unit-tested). The element holds rows and columns (stable ids + sizes);
// cell contents live in the `tableCells` collection (lib/cells.ts). Every structural change goes
// through these helpers so the element's w / h always equal the sum of its columns / rows.
import { nanoid } from 'nanoid';
import type { TableElement } from '@freero/shared';
import type { ElementPatch, NewElement, Point } from '@engine';

export const COL_W = 160;
export const ROW_H = 44;
export const MIN_COL_W = 48;
export const MIN_ROW_H = 32;
export const FONT_SIZE = 14;
/** Inner padding of a cell (world px). */
export const CELL_PAD = 8;
/** Cell border width (table.css), plus a pixel of rounding slack. */
export const CELL_BORDER = 2;
export const HEADER_FILL = '#ECE9FB';

type Track = { id: string; w?: number; h?: number };
type Structure = Pick<TableElement, 'rows' | 'cols'>;

export const sumW = (cols: TableElement['cols']) => cols.reduce((s, c) => s + c.w, 0);
export const sumH = (rows: TableElement['rows']) => rows.reduce((s, r) => s + r.h, 0);

/** Part name (Editor.startEditing `part`) of a cell. */
export const cellPart = (rowId: string, colId: string) => `${rowId}:${colId}`;
export function parseCellPart(part: string | null | undefined): { rowId: string; colId: string } | null {
  const m = part ? /^([\w-]+):([\w-]+)$/.exec(part) : null;
  return m ? { rowId: m[1], colId: m[2] } : null;
}

export function newTable(
  at: Point,
  rows: number,
  cols: number,
  opts: { colWidths?: number[]; header?: boolean; newId?: () => string } = {},
): NewElement<'table'> {
  const id = opts.newId ?? nanoid;
  const c = Array.from({ length: cols }, (_, i) => ({ id: id(), w: Math.round(opts.colWidths?.[i] ?? COL_W) }));
  const r = Array.from({ length: rows }, () => ({ id: id(), h: ROW_H }));
  const w = sumW(c);
  const h = sumH(r);
  return {
    type: 'table',
    rows: r,
    cols: c,
    header: opts.header ?? true,
    fontSize: FONT_SIZE,
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - h / 2),
    w,
    h,
  };
}

/** Patch that inserts a row at `index` (0 = top), as tall as its neighbour. */
export function insertRow(el: Structure, index: number, newId: () => string = nanoid): ElementPatch<TableElement> {
  const i = Math.max(0, Math.min(el.rows.length, index));
  const like = el.rows[Math.min(i, el.rows.length - 1)];
  const rows = [...el.rows.slice(0, i), { id: newId(), h: like ? Math.max(ROW_H, Math.min(like.h, ROW_H * 2)) : ROW_H }, ...el.rows.slice(i)];
  return { rows, h: sumH(rows) };
}

export function insertCol(el: Structure, index: number, newId: () => string = nanoid): ElementPatch<TableElement> {
  const i = Math.max(0, Math.min(el.cols.length, index));
  const like = el.cols[Math.min(i, el.cols.length - 1)];
  const cols = [...el.cols.slice(0, i), { id: newId(), w: like?.w ?? COL_W }, ...el.cols.slice(i)];
  return { cols, w: sumW(cols) };
}

/** Patch that removes a row (never the last one: a table keeps at least one row). */
export function removeRow(el: Structure, rowId: string): ElementPatch<TableElement> | null {
  if (el.rows.length <= 1 || !el.rows.some((r) => r.id === rowId)) return null;
  const rows = el.rows.filter((r) => r.id !== rowId);
  return { rows, h: sumH(rows) };
}

export function removeCol(el: Structure, colId: string): ElementPatch<TableElement> | null {
  if (el.cols.length <= 1 || !el.cols.some((c) => c.id === colId)) return null;
  const cols = el.cols.filter((c) => c.id !== colId);
  return { cols, w: sumW(cols) };
}

/** Patch for dragging the divider after column `colId` to make it `w` wide (the table grows). */
export function resizeCol(el: Structure, colId: string, w: number): ElementPatch<TableElement> {
  const cols = el.cols.map((c) => (c.id === colId ? { ...c, w: Math.round(Math.max(MIN_COL_W, w)) } : c));
  return { cols, w: sumW(cols) };
}

export function resizeRow(el: Structure, rowId: string, h: number): ElementPatch<TableElement> {
  const rows = el.rows.map((r) => (r.id === rowId ? { ...r, h: Math.round(Math.max(MIN_ROW_H, h)) } : r));
  return { rows, h: sumH(rows) };
}

/** Sizes scaled proportionally so they add up to `total` (each at least `min`). */
function scaleTracks<T extends Track>(tracks: T[], key: 'w' | 'h', total: number, min: number): T[] {
  const sum = tracks.reduce((s, t) => s + (t[key] ?? 0), 0) || 1;
  const k = total / sum;
  const out = tracks.map((t) => ({ ...t, [key]: Math.max(min, Math.round((t[key] ?? 0) * k)) }));
  // Rounding: the last track takes up the difference so the table edge lands where it was dragged.
  const diff = Math.round(total) - out.reduce((s, t) => s + (t[key] as number), 0);
  const last = out[out.length - 1];
  if (last) (last as Record<string, unknown>)[key] = Math.max(min, (last[key] as number) + diff);
  return out;
}

/**
 * normalize: resizing the whole table with the engine's handles scales its columns / rows
 * proportionally; otherwise w / h follow the columns / rows.
 */
export function layoutTable(el: TableElement, prev?: TableElement): ElementPatch<TableElement> | null {
  let { cols, rows } = el;
  if (prev && el.w !== prev.w && Math.abs(el.w - sumW(cols)) > 0.5) cols = scaleTracks(cols, 'w', el.w, MIN_COL_W);
  if (prev && el.h !== prev.h && Math.abs(el.h - sumH(rows)) > 0.5) rows = scaleTracks(rows, 'h', el.h, MIN_ROW_H);
  const patch: ElementPatch<TableElement> = {};
  if (cols !== el.cols) patch.cols = cols;
  if (rows !== el.rows) patch.rows = rows;
  if (sumW(cols) !== el.w) patch.w = sumW(cols);
  if (sumH(rows) !== el.h) patch.h = sumH(rows);
  return Object.keys(patch).length ? patch : null;
}

/** The cell under `local` (element-local, unrotated), or null outside the grid. */
export function cellAt(el: Structure, local: Point): { rowId: string; colId: string; row: number; col: number } | null {
  let x = 0;
  let col = -1;
  for (let i = 0; i < el.cols.length; i++) {
    if (local.x >= x && local.x < x + el.cols[i].w) col = i;
    x += el.cols[i].w;
  }
  let y = 0;
  let row = -1;
  for (let i = 0; i < el.rows.length; i++) {
    if (local.y >= y && local.y < y + el.rows[i].h) row = i;
    y += el.rows[i].h;
  }
  if (row < 0 || col < 0) return null;
  return { rowId: el.rows[row].id, colId: el.cols[col].id, row, col };
}

export type Move = 'next' | 'prev' | 'up' | 'down' | 'left' | 'right';

/**
 * The cell a key moves to from (rowId, colId): Tab = next / prev in reading order (wrapping to
 * the next / previous row), arrows = the neighbour. null at the edge. `'append'` = Tab on the
 * very last cell: add a row (spreadsheet habit).
 */
export function moveFrom(el: Structure, rowId: string, colId: string, move: Move): { rowId: string; colId: string } | 'append' | null {
  const r = el.rows.findIndex((x) => x.id === rowId);
  const c = el.cols.findIndex((x) => x.id === colId);
  if (r < 0 || c < 0) return null;
  const nr = el.rows.length;
  const nc = el.cols.length;
  let [tr, tc] = [r, c];
  switch (move) {
    case 'next':
      if (c + 1 < nc) tc = c + 1;
      else if (r + 1 < nr) [tr, tc] = [r + 1, 0];
      else return 'append';
      break;
    case 'prev':
      if (c > 0) tc = c - 1;
      else if (r > 0) [tr, tc] = [r - 1, nc - 1];
      else return null;
      break;
    case 'up': tr = r - 1; break;
    case 'down': tr = r + 1; break;
    case 'left': tc = c - 1; break;
    case 'right': tc = c + 1; break;
  }
  if (tr < 0 || tr >= nr || tc < 0 || tc >= nc) return null;
  return { rowId: el.rows[tr].id, colId: el.cols[tc].id };
}

// ------------------------------------------------------------------ CSV / TSV

/**
 * Spreadsheet clipboard text → rows of cells, or null when it isn't a table. Tab-separated
 * (what spreadsheets put on the clipboard) or comma-separated with a consistent column count;
 * double-quoted fields may hold separators, quotes ("") and line breaks.
 */
export function parseDelimited(text: string | null, maxRows = 200, maxCols = 50): string[][] | null {
  if (!text) return null;
  const src = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.includes('\n') && !src.includes('\t')) return null;
  const sep = src.includes('\t') ? '\t' : ',';
  const rows = splitDelimited(src, sep);
  if (!rows || rows.length > maxRows) return null;
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2 || width > maxCols) return null;
  if (sep === ',') {
    // Prose with commas is not a CSV: every line must have the same number of fields, and there
    // must be at least two lines.
    if (rows.length < 2 || rows.some((r) => r.length !== width)) return null;
  } else if (rows.length < 1) return null;
  return rows.map((r) => [...r.map((c) => c.trim()), ...Array(width - r.length).fill('')]);
}

function splitDelimited(src: string, sep: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
      atStart = true;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atStart = true;
    } else {
      cell += ch;
      atStart = false;
    }
  }
  if (quoted) return null;
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Rows of plain cell texts → CSV (RFC 4180 quoting; CRLF line ends, like spreadsheets write). */
export function toCsv(grid: string[][]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return grid.map((r) => r.map(q).join(',')).join('\r\n');
}

/** Column widths that fit pasted text (rough: 7.5 px per character at the table's font). */
export function fitColumnWidths(grid: string[][]): number[] {
  const n = Math.max(...grid.map((r) => r.length));
  return Array.from({ length: n }, (_, c) => {
    const longest = Math.max(0, ...grid.map((r) => Math.max(0, ...(r[c] ?? '').split('\n').map((l) => l.length))));
    return Math.round(Math.min(320, Math.max(96, longest * 7.5 + CELL_PAD * 2 + 8)));
  });
}
