// Table actions shared by the tool, element (keys, paste), format toolbar and commands.
import { nanoid } from 'nanoid';
import { tableCellKey, type TableElement } from '@freero/shared';
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
  toCsv,
  type Move,
} from './model';
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
  const table = { ...newTable(at, grid.length, grid[0].length, { colWidths: fitColumnWidths(grid) }), id: nanoid() };
  editor.transact(() => {
    editor.create(table, { select: true });
    grid.forEach((row, r) =>
      row.forEach((text, c) => {
        if (text) setCellText(editor, table.id, table.rows[r].id, table.cols[c].id, plainToRichText(text));
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
  const to = moveFrom(el, rowId, colId, move);
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

/** Downloads the table as a .csv file (plain cell text). */
export function exportCsv(editor: Editor, el: TableElement) {
  const csv = toCsv(plainGrid(editor.collection<string>(CELLS), el));
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
