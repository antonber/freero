// Kanban edits: every one is a single Editor.transact (one undo step), after which the engine's
// arrange pass re-stacks the columns.
import { nanoid } from 'nanoid';
import type { BoardElement, CardStatus, KanbanColumn, KanbanElement } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { DEFAULT_COL_W, MAX_COL_W, MIN_COL_W, boardWidth, colLeft, colWidth, columnOrder, columnsOfChildren, kanbanWidth, reflowMoves } from './layout';
import { COLUMN_COLORS, DEFAULT_COLUMNS } from './constants';

export function newKanban(at: Point): NewElement<'kanban'> {
  const columns = DEFAULT_COLUMNS.map((c) => ({ ...c, id: nanoid(8) }));
  const w = kanbanWidth(columns.length, DEFAULT_COL_W);
  return {
    type: 'kanban',
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - 160),
    w,
    h: 320,
    title: 'Kanban',
    columns,
    colW: DEFAULT_COL_W,
    // New boards colour their cards by column; boards from before keep their cards' own colours.
    colorCards: true,
  };
}

function fresh(editor: Editor, id: string): KanbanElement | null {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' && !k.locked ? k : null;
}

/**
 * Replaces the board's column geometry (columns, colW), carrying every item along with its column.
 * Cards of a removed column join `fallbackId` and take its status, as a drop would.
 */
function setGeometry(editor: Editor, id: string, next: KanbanColumn[], colW: number, fallbackId: string | null = null) {
  const k = fresh(editor, id);
  if (!k || !next.length) return;
  const all = editor.getElements();
  const nextK = { ...k, columns: next, colW };
  const moves = reflowMoves(k, nextK, all, fallbackId);
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
    editor.update<KanbanElement>(id, { columns: next, colW, w: boardWidth(nextK) });
    if (moves.length) editor.moveBy(moves);
    if (statusPatches.length) editor.updateMany(statusPatches as Array<{ id: string; patch: ElementPatch }>);
  });
}

const setColumns = (editor: Editor, id: string, next: KanbanColumn[], fallbackId: string | null = null) => {
  const k = fresh(editor, id);
  if (k) setGeometry(editor, id, next, k.colW, fallbackId);
};

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
  moveColumnTo(editor, id, colId, i + dir);
}

/** Puts column `colId` at position `to` (0-based, in the order without it); its items go with it. */
export function moveColumnTo(editor: Editor, id: string, colId: string, to: number) {
  const k = fresh(editor, id);
  if (!k) return;
  const i = k.columns.findIndex((c) => c.id === colId);
  if (i < 0 || to < 0 || to >= k.columns.length || to === i) return;
  const rest = k.columns.filter((c) => c.id !== colId);
  setColumns(editor, id, [...rest.slice(0, to), k.columns[i], ...rest.slice(to)]);
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

export function patchColumn(editor: Editor, id: string, colId: string, patch: Partial<Omit<KanbanColumn, 'id' | 'collapsed'>>) {
  const k = fresh(editor, id);
  if (!k) return;
  // Cards coloured by their column are drawn in its new colour: nothing is written on them.
  editor.update<KanbanElement>(id, { columns: k.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) });
}

/** Folds a column to a narrow strip (title + count) or opens it again; the items stay in it. */
export function setCollapsed(editor: Editor, id: string, colId: string, collapsed: boolean) {
  const k = fresh(editor, id);
  if (!k || !k.columns.some((c) => c.id === colId && !!c.collapsed !== collapsed)) return;
  setColumns(editor, id, k.columns.map((c) => (c.id !== colId ? c : collapsed ? { ...c, collapsed: true } : withoutCollapsed(c))));
}

const withoutCollapsed = ({ collapsed: _c, ...c }: KanbanColumn): KanbanColumn => c;

/** Changes every column's width; items move with their column (and re-stack at the new width). */
export function setColumnWidth(editor: Editor, id: string, colW: number) {
  const k = fresh(editor, id);
  const w = Math.round(Math.max(MIN_COL_W, Math.min(MAX_COL_W, colW)));
  if (!k || k.colW === w) return;
  setGeometry(editor, id, k.columns, w);
}

export const columnPart = (colId: string) => `col:${colId}`;
export const partColumn = (part: string | null) => (part?.startsWith('col:') ? part.slice(4) : null);

export function renameColumn(editor: Editor, id: string, colId: string) {
  editor.select([id]);
  editor.startEditing(id, { part: columnPart(colId), selectAll: true });
}

/**
 * Puts an item of the kanban at the bottom of column `colId`: its value for the column field
 * (card details, `card.setValues`). The layout pass then stacks it there and, as for a drop, sets
 * the column's status and colour. One undo step with the caller's transaction.
 */
export function moveToColumn(editor: Editor, itemId: string, colId: string): boolean {
  const el = editor.getElement(itemId);
  const k = el?.frameId ? fresh(editor, el.frameId) : null;
  const to = k ? k.columns.findIndex((c) => c.id === colId) : -1;
  if (!el || !k || to < 0 || el.locked) return false;
  const all = editor.getElements();
  if (columnsOfChildren(k, all).get(el.id) === to) return false;
  const below = columnOrder(k, all, to).reduce((y, o) => Math.max(y, o.y + o.h), k.y);
  const cx = k.x + colLeft(k, to) + colWidth(k, to) / 2;
  editor.moveBy([{ id: el.id, dx: cx - (el.x + el.w / 2), dy: below + 1 + el.h / 2 - (el.y + el.h / 2) }]);
  return true;
}

// ---- moving items with the keyboard ----

export type MoveDir = 'left' | 'right' | 'up' | 'down';

/** The kanban the selection sits in, when all of it is stacked items of one unlocked board. */
export function selectionKanban(editor: Editor): { k: KanbanElement; items: BoardElement[] } | null {
  const sel = editor.getSelection();
  if (!sel.length) return null;
  const items = sel.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el);
  const kid = items[0]?.frameId;
  const k = kid ? fresh(editor, kid) : null;
  if (!k || items.length !== sel.length) return null;
  if (!items.every((el) => el.frameId === k.id && !el.locked && el.type !== 'connector' && el.type !== 'pen' && el.type !== 'frame' && el.type !== 'kanban')) return null;
  return { k, items };
}

/** Whether `dir` can move the selection anywhere (an edge column / the top of a column can't). */
export function canMove(editor: Editor, dir: MoveDir): boolean {
  const s = selectionKanban(editor);
  if (!s) return false;
  const all = editor.getElements();
  const cols = columnsOfChildren(s.k, all);
  const idx = s.items.map((el) => cols.get(el.id) ?? 0);
  if (dir === 'left') return idx.some((i) => i > 0);
  if (dir === 'right') return idx.some((i) => i < s.k.columns.length - 1);
  // Up / down: within one column only.
  if (new Set(idx).size !== 1) return false;
  const order = columnOrder(s.k, all, idx[0]);
  const ids = new Set(s.items.map((el) => el.id));
  const at = order.map((el) => ids.has(el.id));
  return dir === 'up' ? at.indexOf(true) > 0 : at.lastIndexOf(true) < order.length - 1;
}

/**
 * Moves the selected items one column left / right (to the same height, so they land next to
 * where they were) or one place up / down in their column. One undo step; the layout pass stacks
 * them and, as for a drop, sets the new column's status and colour.
 */
export function moveSelection(editor: Editor, dir: MoveDir): boolean {
  const s = selectionKanban(editor);
  if (!s || !canMove(editor, dir)) return false;
  const { k, items } = s;
  const all = editor.getElements();
  const cols = columnsOfChildren(k, all);
  const mid = (i: number) => k.x + colLeft(k, i) + colWidth(k, i) / 2;
  const moves: Array<{ id: string; dx: number; dy: number }> = [];
  if (dir === 'left' || dir === 'right') {
    const step = dir === 'left' ? -1 : 1;
    for (const el of items) {
      const i = cols.get(el.id) ?? 0;
      const j = Math.max(0, Math.min(k.columns.length - 1, i + step));
      if (j !== i) moves.push({ id: el.id, dx: mid(j) - (el.x + el.w / 2), dy: 0 });
    }
  } else {
    const order = columnOrder(k, all, cols.get(items[0].id) ?? 0);
    const ids = new Set(items.map((el) => el.id));
    const first = order.findIndex((el) => ids.has(el.id));
    const last = order.length - 1 - [...order].reverse().findIndex((el) => ids.has(el.id));
    // The neighbour hops over the moving block: the block's centers go just past the neighbour's.
    const other = dir === 'up' ? order[first - 1] : order[last + 1];
    const cy = other.y + other.h / 2;
    const block = order.filter((el) => ids.has(el.id));
    block.forEach((el, n) => {
      const target = dir === 'up' ? cy - (block.length - n) * 0.01 : cy + (n + 1) * 0.01;
      moves.push({ id: el.id, dx: 0, dy: target - (el.y + el.h / 2) });
    });
  }
  if (!moves.length) return false;
  editor.transact(() => editor.moveBy(moves));
  return true;
}
