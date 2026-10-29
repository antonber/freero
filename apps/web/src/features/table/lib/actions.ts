// Table actions shared by the tool, element (keys, paste), format toolbar and commands.
import { nanoid } from 'nanoid';
import { tableCellKey, type TableColumn, type TableColumnType, type TableElement, type TableFilter, type TableSelectOption } from '@freero/shared';
import { measureRichText, plainToRichText, type Editor, type Point } from '@engine';
import {
  cellPart,
  CELL_BORDER,
  CELL_PAD,
  fitColumnWidths,
  insertCol,
  insertRow,
  moveFrom,
  newTable,
  parseCellPart,
  removeCol,
  removeRow,
  resizeRow,
  sumH,
  sumW,
  toCsv,
  type Move,
} from './model';
import { convertColumn, inferType, OPTION_COLORS, sortedRows, typeOf, valueFor, visibleRows, type PeopleLookup } from './columns';
import { CELLS, cellText, plainGrid, setCellFill, setCellText, writeContent } from './cells';

/** The single selected table, if the selection is exactly one table. */
export function selectedTable(editor: Editor): TableElement | null {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return el?.type === 'table' ? el : null;
}

// The last cell edited in each table (local UI state): toolbar actions (fill, insert / delete a
// row or column) apply to it after the edit ended.
const lastCell = new Map<string, string>();
export const rememberCell = (tableId: string, part: string) => lastCell.set(tableId, part);

/** The cell toolbar actions apply to: the one being edited, else the last one edited. */
export function activeCell(editor: Editor, el: TableElement): { rowId: string; colId: string } | null {
  const part = editor.getEditingId() === el.id ? editor.getEditingPart() : lastCell.get(el.id);
  const cell = parseCellPart(part);
  if (!cell || !el.rows.some((r) => r.id === cell.rowId) || !el.cols.some((c) => c.id === cell.colId)) return null;
  return cell;
}

export function editCell(editor: Editor, tableId: string, rowId: string, colId: string, selectAll = false) {
  editor.startEditing(tableId, { part: cellPart(rowId, colId), selectAll });
}

/** Creates a table centered on `at` and starts typing in its first cell. */
export function placeTable(editor: Editor, at: Point, rows = 3, cols = 3): string {
  const id = editor.create(newTable(at, rows, cols), { select: true });
  const el = id ? editor.getElement<TableElement>(id) : undefined;
  if (el) editCell(editor, el.id, el.rows[0].id, el.cols[0].id);
  return id;
}

/** Spreadsheet paste: a table holding `grid`, its first row as the header. One undo step. */
export function createFromGrid(editor: Editor, grid: string[][], at: Point): string {
  const base = newTable(at, grid.length, grid[0].length, { colWidths: fitColumnWidths(grid) });
  // Columns whose values all read as numbers, dates or yes / no become typed (the first row is the
  // header, so it is left out of the guess).
  const cols: TableColumn[] = base.cols.map((c, i) => {
    const type = grid.length > 2 ? inferType(grid.slice(1).map((r) => r[i] ?? '')) : 'text';
    return type === 'text' ? c : { ...c, type };
  });
  const table = { ...base, cols, id: nanoid() };
  editor.transact(() => {
    editor.create(table, { select: true });
    grid.forEach((row, r) =>
      row.forEach((text, c) => {
        const value = r === 0 ? plainToRichText(text) : valueFor(cols[c], text);
        if (text && value) setCellText(editor, table.id, table.rows[r].id, table.cols[c].id, value);
      }),
    );
    // Rows tall enough for their longest (wrapped) cell.
    const el = editor.getElement<TableElement>(table.id);
    if (el) fitRows(editor, el);
  });
  return table.id;
}

/** Height a cell's text needs at its column width. */
function neededHeight(html: string, colW: number, fontSize: number, bold: boolean): number {
  if (!html) return 0;
  // The cell's 1 px right / bottom borders take room from the text too.
  const m = measureRichText(html, { fontSize, fontWeight: bold ? 600 : 400, width: Math.max(1, colW - CELL_PAD * 2 - CELL_BORDER), padding: CELL_PAD });
  return Math.ceil(m.h) + CELL_BORDER;
}

/** Grows rows whose text no longer fits (never shrinks: a row someone made taller stays). */
export function fitRows(editor: Editor, el: TableElement, onlyRow?: string): void {
  const coll = editor.collection<string>(CELLS);
  let next = el;
  el.rows.forEach((r, i) => {
    if (onlyRow && r.id !== onlyRow) return;
    const need = Math.max(0, ...el.cols.map((c) => neededHeight(cellText(coll, el.id, r.id, c.id), c.w, el.fontSize, el.header && i === 0)));
    if (need > r.h) next = { ...next, ...resizeRow(next, r.id, need) } as TableElement;
  });
  if (next !== el) editor.update<TableElement>(el.id, { rows: next.rows, h: next.h });
}

/** Writes a cell's text (from the cell editor) and grows its row when the text needs it. */
export function commitCell(editor: Editor, tableId: string, rowId: string, colId: string, html: string): void {
  editor.transact(() => {
    setCellText(editor, tableId, rowId, colId, html);
    const el = editor.getElement<TableElement>(tableId);
    if (el) fitRows(editor, el, rowId);
  });
}

/** Moves the cell editor (Tab / arrows); Tab on the last cell adds a row first. */
export function moveCell(editor: Editor, el: TableElement, rowId: string, colId: string, move: Move): boolean {
  // Rows a filter hides are skipped (they keep their place in `el.rows`).
  const to = moveFrom({ rows: shownRows(editor, el), cols: el.cols }, rowId, colId, move);
  if (!to) return false;
  if (to === 'append') {
    if (!editor.can('editor')) return false;
    const newRow = nanoid();
    editor.stopEditing();
    editor.update<TableElement>(el.id, insertRow(el, el.rows.length, () => newRow));
    editCell(editor, el.id, newRow, el.cols[0].id);
    return true;
  }
  editCell(editor, el.id, to.rowId, to.colId, true);
  return true;
}

// ------------------------------------------------------------------ structure (toolbar / commands)

export function addRow(editor: Editor, el: TableElement, where: 'above' | 'below') {
  const cell = activeCell(editor, el);
  const i = cell ? el.rows.findIndex((r) => r.id === cell.rowId) : el.rows.length - 1;
  editor.update<TableElement>(el.id, insertRow(el, where === 'above' ? i : i + 1));
}

export function addCol(editor: Editor, el: TableElement, where: 'left' | 'right') {
  const cell = activeCell(editor, el);
  const i = cell ? el.cols.findIndex((c) => c.id === cell.colId) : el.cols.length - 1;
  editor.update<TableElement>(el.id, insertCol(el, where === 'left' ? i : i + 1));
}

/** Deletes the active cell's row (else the last row) and its cell records, in one step. */
export function deleteRow(editor: Editor, el: TableElement) {
  const rowId = activeCell(editor, el)?.rowId ?? el.rows[el.rows.length - 1].id;
  const patch = removeRow(el, rowId);
  if (!patch) return;
  editor.stopEditing();
  editor.transact(() => {
    for (const c of el.cols) clearCell(editor, el.id, rowId, c.id);
    editor.update<TableElement>(el.id, patch);
  });
}

export function deleteCol(editor: Editor, el: TableElement) {
  const colId = activeCell(editor, el)?.colId ?? el.cols[el.cols.length - 1].id;
  const patch = removeCol(el, colId);
  if (!patch) return;
  editor.stopEditing();
  editor.transact(() => {
    for (const r of el.rows) clearCell(editor, el.id, r.id, colId);
    editor.update<TableElement>(el.id, patch);
  });
}

function clearCell(editor: Editor, tableId: string, rowId: string, colId: string) {
  setCellText(editor, tableId, rowId, colId, '');
  setCellFill(editor, tableId, rowId, colId, '');
}

/** Fill of the active cell, or of every cell when no cell is active. */
export function fillCells(editor: Editor, el: TableElement, fill: string) {
  const cell = activeCell(editor, el);
  editor.transact(() => {
    if (cell) setCellFill(editor, el.id, cell.rowId, cell.colId, fill);
    else for (const r of el.rows) for (const c of el.cols) setCellFill(editor, el.id, r.id, c.id, fill);
  });
}

export function currentFill(editor: Editor, el: TableElement): string {
  const cell = activeCell(editor, el);
  return cell ? (editor.collection<string>(CELLS).get(tableCellKey('f', el.id, cell.rowId, cell.colId)) ?? '') : '';
}

/** Downloads the table as a .csv file: typed cells in the form spreadsheets read back, people by name. */
export async function exportCsv(editor: Editor, el: TableElement) {
  const people = el.cols.some((c) => typeOf(c) === 'person') ? await peopleLookup(editor) : undefined;
  const csv = toCsv(plainGrid(editor.collection<string>(CELLS), el, { mode: 'export', people }));
  // BOM: spreadsheet apps then read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'table.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  editor.host.notify('Table exported as CSV', 'success');
}

export { writeContent };

// ------------------------------------------------------------------ typed columns (KAI-123)

/** The board's people as a lookup (member directory, presence as a fallback). */
export async function peopleLookup(editor: Editor): Promise<PeopleLookup> {
  const byId = new Map<string, string>();
  for (const p of editor.getPeers()) if (p.user) byId.set(p.user.id, p.user.name);
  byId.set(editor.host.user.id, editor.host.user.name);
  try {
    for (const m of await editor.host.listMembers()) byId.set(m.id, m.name);
  } catch {
    // presence names only
  }
  return lookupFrom(byId);
}

export function lookupFrom(byId: ReadonlyMap<string, string>): PeopleLookup {
  return {
    name: (id) => byId.get(id),
    idOf: (text) => {
      const t = text.trim().toLowerCase();
      for (const [id, name] of byId) if (name.trim().toLowerCase() === t) return id;
      return undefined;
    },
  };
}

const rawCell = (editor: Editor, tableId: string) => {
  const coll = editor.collection<string>(CELLS);
  return (rowId: string, colId: string) => cellText(coll, tableId, rowId, colId);
};

/**
 * Changes a column's type and converts its cells (header row excluded) in one undo step. Values
 * that don't read as the new type stay as text, so nothing typed is lost.
 */
export async function setColumnType(editor: Editor, tableId: string, colId: string, type: TableColumnType): Promise<void> {
  const el0 = editor.getElement<TableElement>(tableId);
  const col0 = el0?.cols.find((c) => c.id === colId);
  if (!el0 || !col0 || typeOf(col0) === type) return;
  const people = type === 'person' || typeOf(col0) === 'person' ? await peopleLookup(editor) : undefined;
  // Read again after the wait: someone may have changed the table meanwhile.
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  if (!el || !col || typeOf(col) === type) return;
  const get = rawCell(editor, el.id);
  const body = el.rows.slice(el.header ? 1 : 0);
  const out = convertColumn(col, type, body.map((r) => ({ rowId: r.id, raw: get(r.id, col.id) })), people);
  editor.stopEditing();
  editor.transact(() => {
    for (const c of out.cells) if (c.raw !== get(c.rowId, col.id)) setCellText(editor, el.id, c.rowId, col.id, c.raw);
    const filter = el.filter?.colId === colId ? null : el.filter;
    const groupBy = el.groupBy === colId && type !== 'select' ? null : el.groupBy;
    editor.update<TableElement>(el.id, {
      cols: el.cols.map((c) => (c.id === colId ? out.col : c)),
      ...(filter !== el.filter ? { filter } : {}),
      ...(groupBy !== el.groupBy ? { groupBy, view: 'grid' as const, w: sumW(el.cols), h: sumH(el.rows) } : {}),
    });
  });
}

/** Sorts the rows (not the header row) by a column, as a lasting reorder everyone sees: one undo step. */
export function sortByColumn(editor: Editor, tableId: string, colId: string, dir: 'asc' | 'desc', people?: PeopleLookup): void {
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  if (!el || !col) return;
  const get = rawCell(editor, el.id);
  const rows = sortedRows(el.rows, el.header, col, dir, (rowId) => get(rowId, colId), people);
  if (rows.every((r, i) => r === el.rows[i])) return;
  editor.update<TableElement>(el.id, { rows });
}

export function setFilter(editor: Editor, tableId: string, filter: TableFilter | null): void {
  const el = editor.getElement<TableElement>(tableId);
  if (!el) return;
  editor.stopEditing();
  editor.update<TableElement>(el.id, { filter });
}

/** Rows drawn: everything but filtered-out rows (see TableElement.filter). */
export function shownRows(editor: Editor, el: TableElement): TableElement['rows'] {
  return visibleRows(el, rawCell(editor, el.id));
}

export function addOption(editor: Editor, tableId: string, colId: string, label: string): TableSelectOption | null {
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  const name = label.trim();
  if (!el || !col || !name) return null;
  const existing = col.options?.find((o) => o.label.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const opts = col.options ?? [];
  const opt = { id: nanoid(8), label: name, color: OPTION_COLORS[opts.length % OPTION_COLORS.length] };
  editor.update<TableElement>(el.id, { cols: el.cols.map((c) => (c.id === colId ? { ...c, options: [...opts, opt] } : c)) });
  return opt;
}

/** Renames / recolours an option; cells holding the old label take the new one in the same step. */
export function patchOption(editor: Editor, tableId: string, colId: string, optionId: string, patch: Partial<Omit<TableSelectOption, 'id'>>): void {
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  const opt = col?.options?.find((o) => o.id === optionId);
  if (!el || !col || !opt) return;
  const label = patch.label?.trim();
  if (patch.label !== undefined && (!label || col.options!.some((o) => o.id !== optionId && o.label.toLowerCase() === label.toLowerCase()))) return;
  const next = { ...opt, ...patch, ...(label ? { label } : {}) };
  const get = rawCell(editor, el.id);
  editor.transact(() => {
    if (label && label !== opt.label)
      for (const r of el.rows.slice(el.header ? 1 : 0))
        if (valueFor(col, get(r.id, colId)) === plainToRichText(opt.label)) setCellText(editor, el.id, r.id, colId, plainToRichText(label));
    editor.update<TableElement>(el.id, { cols: el.cols.map((c) => (c.id === colId ? { ...c, options: col.options!.map((o) => (o.id === optionId ? next : o)) } : c)) });
  });
}

/** Removes an option; cells that held it are cleared in the same step. */
export function removeOption(editor: Editor, tableId: string, colId: string, optionId: string): void {
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  const opt = col?.options?.find((o) => o.id === optionId);
  if (!el || !col || !opt) return;
  const get = rawCell(editor, el.id);
  editor.transact(() => {
    for (const r of el.rows.slice(el.header ? 1 : 0)) if (valueFor(col, get(r.id, colId)) === plainToRichText(opt.label)) setCellText(editor, el.id, r.id, colId, '');
    editor.update<TableElement>(el.id, { cols: el.cols.map((c) => (c.id === colId ? { ...c, options: col.options!.filter((o) => o.id !== optionId) } : c)) });
  });
}

// ------------------------------------------------------------------ board view

export const BOARD = { colW: 220, gap: 12, head: 40, cardH: 76, cardGap: 8, pad: 12 };

/** The select columns a board view can group by. */
export const groupColumns = (el: Pick<TableElement, 'cols'>) => el.cols.filter((c) => typeOf(c) === 'select');

/**
 * Switches between the grid and the board view. The board view is sized to show every card;
 * back on the grid, the size follows the columns and rows again.
 */
export function setView(editor: Editor, tableId: string, view: 'grid' | 'board', groupBy?: string): void {
  const el = editor.getElement<TableElement>(tableId);
  if (!el) return;
  editor.stopEditing();
  if (view === 'grid') {
    if ((el.view ?? 'grid') === 'grid') return;
    editor.update<TableElement>(el.id, { view: 'grid', w: sumW(el.cols), h: sumH(el.rows) });
    return;
  }
  const group = el.cols.find((c) => c.id === groupBy && typeOf(c) === 'select') ?? groupColumns(el)[0];
  if (!group) return;
  const get = rawCell(editor, el.id);
  const rows = shownRows(editor, el).slice(el.header ? 1 : 0);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const label = valueFor(group, get(r.id, group.id));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const lanes = (group.options?.length ?? 0) + 1;
  const most = Math.max(1, ...counts.values());
  const w = Math.max(el.view === 'board' ? el.w : 0, BOARD.gap + lanes * (BOARD.colW + BOARD.gap));
  // A card: its title plus up to three fields (lib/views.tsx BoardView).
  const cardH = 40 + 19 * Math.min(3, Math.max(0, el.cols.length - 2));
  const h = Math.max(240, BOARD.head + BOARD.pad + most * (Math.max(BOARD.cardH, cardH) + BOARD.cardGap) + BOARD.pad);
  editor.update<TableElement>(el.id, { view: 'board', groupBy: group.id, w, h });
}

/** Board view: a card dropped into another column takes that column's option (or none). */
export function moveRowToGroup(editor: Editor, tableId: string, rowId: string, colId: string, label: string): void {
  const el = editor.getElement<TableElement>(tableId);
  const col = el?.cols.find((c) => c.id === colId);
  if (!el || !col || !el.rows.some((r) => r.id === rowId)) return;
  setCellText(editor, el.id, rowId, colId, label ? plainToRichText(label) : '');
}
