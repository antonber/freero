// Kanban edits: every one is a single Editor.transact (one undo step), after which the engine's
// arrange pass re-stacks the columns.
import { nanoid } from 'nanoid';
import type { CardStatus, KanbanColumn, KanbanElement } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { DEFAULT_COL_W, colLeft, columnsOfChildren, kanbanWidth, reflowMoves } from './layout';
import { COLUMN_COLORS, DEFAULT_COLUMNS } from './constants';

export function newKanban(at: Point): NewElement<'kanban'> {
  const columns = DEFAULT_COLUMNS.map((c) => ({ ...c, id: nanoid(8) }));
  const w = kanbanWidth(columns.length, DEFAULT_COL_W);
  return { type: 'kanban', x: Math.round(at.x - w / 2), y: Math.round(at.y - 160), w, h: 320, title: 'Kanban', columns, colW: DEFAULT_COL_W };
}

function fresh(editor: Editor, id: string): KanbanElement | null {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' && !k.locked ? k : null;
}

/** Replaces the columns, carrying every item along with its column. */
function setColumns(editor: Editor, id: string, next: KanbanColumn[], fallbackId: string | null = null) {
  const k = fresh(editor, id);
  if (!k || !next.length) return;
  const all = editor.getElements();
  const moves = reflowMoves(k, next, all, fallbackId);
  const removed = new Set(k.columns.filter((c) => !next.some((n) => n.id === c.id)).map((c) => c.id));
  const fallback = next.find((c) => c.id === fallbackId);
  const statusPatches: Array<{ id: string; patch: { status: CardStatus } }> = [];
  if (removed.size && fallback?.status) {
    for (const [elId, idx] of columnsOfChildren(k, all)) {
      const el = editor.getElement(elId);
      if (el?.type === 'card' && removed.has(k.columns[idx].id) && el.status !== fallback.status)
        statusPatches.push({ id: elId, patch: { status: fallback.status } });
    }
  }
  editor.transact(() => {
    editor.update<KanbanElement>(id, { columns: next, w: kanbanWidth(next.length, k.colW) });
    if (moves.length) editor.moveBy(moves);
    if (statusPatches.length) editor.updateMany(statusPatches as Array<{ id: string; patch: ElementPatch }>);
  });
}

export function addColumn(editor: Editor, id: string, afterIndex?: number): string | null {
  const k = fresh(editor, id);
  if (!k) return null;
  const at = afterIndex === undefined ? k.columns.length : afterIndex + 1;
  const col: KanbanColumn = { id: nanoid(8), title: 'New column', status: null, color: COLUMN_COLORS[k.columns.length % COLUMN_COLORS.length] };
  setColumns(editor, id, [...k.columns.slice(0, at), col, ...k.columns.slice(at)]);
  return col.id;
}

export function moveColumn(editor: Editor, id: string, colId: string, dir: -1 | 1) {
  const k = fresh(editor, id);
  if (!k) return;
  const i = k.columns.findIndex((c) => c.id === colId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= k.columns.length) return;
  const next = [...k.columns];
  [next[i], next[j]] = [next[j], next[i]];
  setColumns(editor, id, next);
}

/** Removes a column; its items join the neighbouring column. The last column can't go. */
export function removeColumn(editor: Editor, id: string, colId: string) {
  const k = fresh(editor, id);
  if (!k || k.columns.length < 2) return;
  const i = k.columns.findIndex((c) => c.id === colId);
  if (i < 0) return;
  const fallback = k.columns[i > 0 ? i - 1 : 1].id;
  setColumns(editor, id, k.columns.filter((c) => c.id !== colId), fallback);
}

export function patchColumn(editor: Editor, id: string, colId: string, patch: Partial<Omit<KanbanColumn, 'id'>>) {
  const k = fresh(editor, id);
  if (!k) return;
  editor.update<KanbanElement>(id, { columns: k.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) });
}

/** Changes every column's width; items move with their column (and re-stack at the new width). */
export function setColumnWidth(editor: Editor, id: string, colW: number) {
  const k = fresh(editor, id);
  if (!k || k.colW === colW) return;
  const moves: Array<{ id: string; dx: number; dy: number }> = [];
  for (const [elId, idx] of columnsOfChildren(k, editor.getElements())) {
    const dx = colLeft(colW, idx) - colLeft(k.colW, idx);
    if (dx) moves.push({ id: elId, dx, dy: 0 });
  }
  editor.transact(() => {
    editor.update<KanbanElement>(id, { colW, w: kanbanWidth(k.columns.length, colW) });
    if (moves.length) editor.moveBy(moves);
  });
}

export const columnPart =(colId: string) => `col:${colId}`;
export const partColumn = (part: string | null) => (part?.startsWith('col:') ? part.slice(4) : null);

export function renameColumn(editor: Editor, id: string, colId: string) {
  editor.select([id]);
  editor.startEditing(id, { part: columnPart(colId), selectAll: true });
}
