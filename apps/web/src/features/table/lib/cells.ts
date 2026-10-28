// Cell contents: one record per cell in the feature-owned `tableCells` collection (layout in
// @freero/shared TableElement). Every cell is its own last-writer-wins key, so people typing
// into different cells at once never overwrite each other, and structural edits (add / remove a
// row or column) never re-key existing cells. The collection is `undoable` (feature.ts): cell
// edits are undone like element edits, in the same steps.
import { tableCellKey, type TableCopyContent, type TableElement } from '@freero/shared';
import { richTextToPlain, type Collection, type Editor } from '@engine';

export const CELLS = 'tableCells';

/** What copy / duplicate carry for a table: cell part ("rowId:colId") → content (@freero/shared). */
export type TableContent = TableCopyContent;

const cells = (editor: Editor) => editor.collection<string>(CELLS);

export function cellText(coll: Pick<Collection<string>, 'get'>, tableId: string, rowId: string, colId: string): string {
  return coll.get(tableCellKey('t', tableId, rowId, colId)) ?? '';
}

export function cellFill(coll: Pick<Collection<string>, 'get'>, tableId: string, rowId: string, colId: string): string {
  return coll.get(tableCellKey('f', tableId, rowId, colId)) ?? '';
}

/** Writes one cell's text (an empty text deletes the record). Owner-scoped editor only. */
export function setCellText(editor: Editor, tableId: string, rowId: string, colId: string, html: string): void {
  const key = tableCellKey('t', tableId, rowId, colId);
  const coll = cells(editor);
  const empty = !richTextToPlain(html).trim();
  if (empty) {
    if (coll.get(key) !== undefined) coll.delete(key);
  } else if (coll.get(key) !== html) coll.set(key, html);
}

export function setCellFill(editor: Editor, tableId: string, rowId: string, colId: string, fill: string): void {
  const key = tableCellKey('f', tableId, rowId, colId);
  const coll = cells(editor);
  if (!fill) {
    if (coll.get(key) !== undefined) coll.delete(key);
  } else if (coll.get(key) !== fill) coll.set(key, fill);
}

/** Every cell's content of a table (for copy / duplicate). */
export function readContent(editor: Editor, el: Pick<TableElement, 'id' | 'rows' | 'cols'>): TableContent {
  const coll = cells(editor);
  const out: TableContent = {};
  for (const r of el.rows)
    for (const c of el.cols) {
      const t = cellText(coll, el.id, r.id, c.id);
      const f = cellFill(coll, el.id, r.id, c.id);
      if (t || f) out[`${r.id}:${c.id}`] = { ...(t ? { t } : {}), ...(f ? { f } : {}) };
    }
  return out;
}

/** Writes copied content into (the cells of) table `tableId`. */
export function writeContent(editor: Editor, tableId: string, content: TableContent): void {
  for (const [part, v] of Object.entries(content)) {
    const [rowId, colId] = part.split(':');
    if (!rowId || !colId) continue;
    if (v.t) setCellText(editor, tableId, rowId, colId, v.t);
    if (v.f) setCellFill(editor, tableId, rowId, colId, v.f);
  }
}

/** Plain text of every cell, row by row (CSV export, clipboard text). */
export function plainGrid(coll: Pick<Collection<string>, 'get'>, el: Pick<TableElement, 'id' | 'rows' | 'cols'>): string[][] {
  return el.rows.map((r) => el.cols.map((c) => richTextToPlain(cellText(coll, el.id, r.id, c.id)).replace(/\n+$/, '')));
}
