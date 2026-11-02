// Kanban geometry and the layout plan the engine applies after every local change
// (ElementDefinition.arrange). Pure: unit-tested without an editor.
import {
  KANBAN_LAYOUT,
  kanbanBoardWidth,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanColumnWidth,
  type BoardElement,
  type CardStatus,
  type KanbanElement,
  type Rect,
} from '@freero/shared';
import type { DragPreview, ElementPatch } from '@engine';

// The geometry lives in @freero/shared: the server places cards in columns with it too (trackers).
/** Board title band. */
export const HEADER_H = KANBAN_LAYOUT.headerH;
/** Column header (title, count, menu). */
export const COL_HEAD_H = KANBAN_LAYOUT.colHeadH;
/** Between columns and around them. */
export const GAP = KANBAN_LAYOUT.gap;
/** Inside a column, around its items. */
export const PAD = KANBAN_LAYOUT.pad;
/** Between stacked items. */
export const ITEM_GAP = KANBAN_LAYOUT.itemGap;
/** A collapsed column's strip. */
export const COLLAPSED_W = KANBAN_LAYOUT.collapsedW;
/** An empty column still offers this much room to drop into. */
export const MIN_BODY = 180;
export const DEFAULT_COL_W = 280;
export const MIN_COL_W = 160;
export const MAX_COL_W = 640;

const EPS = 0.01;

type Geometry = Pick<KanbanElement, 'colW' | 'columns'>;

/** Width of `n` expanded columns `colW` wide (a new board, the minimum size). */
export const kanbanWidth = (n: number, colW: number) => GAP + n * (colW + GAP);
/** The board's width for its columns (collapsed ones are narrow). */
export const boardWidth = (k: Geometry) => kanbanBoardWidth(k);
/** Column i's left edge, element-local. */
export const colLeft = (k: Geometry, i: number) => kanbanColumnLeft(k, i);
/** Column i's width. */
export const colWidth = (k: Geometry, i: number) => kanbanColumnWidth(k, i);
/** Width items get inside a column (also in a collapsed one, where they are folded away). */
export const innerWidth = (colW: number) => colW - 2 * PAD;

/** Column index under a world x (clamped: just left/right of the board counts as the edge column). */
export function columnIndexAt(k: Pick<KanbanElement, 'x' | 'colW' | 'columns'>, worldX: number): number {
  return kanbanColumnAt(k, worldX);
}

/** Items a kanban lays out: its direct children, except lines and nested containers. */
export function isStackable(el: BoardElement, kanbanId: string): boolean {
  return el.frameId === kanbanId && el.type !== 'connector' && el.type !== 'pen' && el.type !== 'frame' && el.type !== 'kanban' && !el.locked;
}

const centerX = (el: BoardElement) => el.x + el.w / 2;
const centerY = (el: BoardElement) => el.y + el.h / 2;

/** Which column each stackable child is in now (by its center). */
export function columnsOfChildren(k: KanbanElement, children: BoardElement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of children) if (isStackable(el, k.id)) out.set(el.id, columnIndexAt(k, centerX(el)));
  return out;
}

/** True while `el` sits in a collapsed column of `k` (folded away: not drawn, still counted). */
export function inCollapsedColumn(k: KanbanElement, el: BoardElement): boolean {
  return isStackable(el, k.id) && !!k.columns[columnIndexAt(k, centerX(el))]?.collapsed;
}

/** A child's stack order in its column: top to bottom. */
export function columnOrder(k: KanbanElement, all: BoardElement[], colIdx: number): BoardElement[] {
  return all
    .filter((el) => isStackable(el, k.id) && columnIndexAt(k, centerX(el)) === colIdx)
    .sort((a, b) => centerY(a) - centerY(b) || a.y - b.y || (a.id < b.id ? -1 : 1));
}

export interface LayoutPlan {
  patches: Array<{ id: string; patch: ElementPatch }>;
  /** Items per column after the layout (WIP counts). */
  counts: number[];
}

/**
 * Where everything goes. Each item stacks in the column under its center, in the order of
 * their centers top to bottom. A task card the change moved into a column with a status takes
 * that status; a card whose status was changed where it stood (not moved) goes to the column
 * with that status instead. Cards the change didn't touch keep their status (remote edits and
 * stale boards are never rewritten by whoever happens to edit next). Colours are never written:
 * a card coloured by its column is drawn so (view.ts), and keeps its own colour for when it leaves.
 */
export function planLayout(
  k: KanbanElement,
  all: BoardElement[],
  previous: ReadonlyMap<string, BoardElement | null>,
): LayoutPlan {
  const n = k.columns.length;
  const colW = k.colW;
  const inner = innerWidth(colW);
  const items = all.filter((el) => isStackable(el, k.id));
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  const own = (id: string): Record<string, unknown> => {
    let p = patches.find((x) => x.id === id);
    if (!p) patches.push((p = { id, patch: {} as ElementPatch }));
    return p.patch as Record<string, unknown>;
  };
  const byCol: Array<Array<{ el: BoardElement; key: number }>> = k.columns.map(() => []);
  // Where the board itself was (it may have moved in the same change, carrying its items).
  const kBefore = (previous.get(k.id) as KanbanElement | null | undefined) ?? k;

  for (const el of items) {
    let col = columnIndexAt(k, centerX(el));
    let key = centerY(el);
    const prev = previous.get(el.id);
    if (el.type === 'card' && prev !== undefined) {
      const status = el.status ?? null;
      const movedIn =
        prev === null ||
        prev.frameId !== k.id ||
        kBefore.columns[columnIndexAt(kBefore, centerX(prev))]?.id !== k.columns[col]?.id;
      const statusChanged = prev !== null && prev.type === 'card' && (prev.status ?? null) !== status;
      const want: CardStatus | null = k.columns[col]?.status ?? null;
      if (want && status !== want) {
        const statusCol = status ? k.columns.findIndex((c) => c.status === status) : -1;
        if (!movedIn && statusChanged && statusCol >= 0) {
          // Status changed where the card stood (format toolbar): it moves to that column, last.
          col = statusCol;
          key = Number.POSITIVE_INFINITY;
        } else if (movedIn) {
          own(el.id).status = want;
        }
      }
    }
    byCol[col].push({ el, key });
  }

  const counts: number[] = [];
  let tallest = 0;
  const top = k.y + HEADER_H + COL_HEAD_H + PAD;
  byCol.forEach((list, col) => {
    list.sort((a, b) => a.key - b.key || a.el.y - b.el.y || (a.el.id < b.el.id ? -1 : 1));
    counts.push(list.length);
    const collapsed = !!k.columns[col].collapsed;
    // A collapsed column keeps its items stacked as usual, centered on its strip (so their
    // centers say which column they are in); they are folded away, so they don't size the board.
    const x = collapsed ? k.x + colLeft(k, col) + COLLAPSED_W / 2 - inner / 2 : k.x + colLeft(k, col) + PAD;
    let y = top;
    for (const { el } of list) {
      // Task cards take the column's width (their height follows); other items shrink to fit.
      const w = el.type === 'card' || el.w > inner ? inner : el.w;
      const h = el.type === 'card' || w === el.w ? el.h : (el.h * w) / el.w;
      const ix = el.type === 'card' || w === inner ? x : x + (inner - w) / 2;
      const patch: Record<string, unknown> = {};
      if (Math.abs(el.x - ix) > EPS) patch.x = ix;
      if (Math.abs(el.y - y) > EPS) patch.y = y;
      if (Math.abs(el.w - w) > EPS) patch.w = w;
      if (Math.abs(el.h - h) > EPS) patch.h = h;
      if (el.rotation) patch.rotation = 0;
      // Items sit on the board, never under it.
      if (el.z <= k.z) patch.z = k.z + 1 + patches.length / 1000;
      if (Object.keys(patch).length) Object.assign(own(el.id), patch);
      y += h + ITEM_GAP;
    }
    if (!collapsed) tallest = Math.max(tallest, list.length ? y - ITEM_GAP - top : 0);
  });

  const h = HEADER_H + COL_HEAD_H + Math.max(MIN_BODY, tallest + 2 * PAD) + GAP;
  const w = n ? boardWidth(k) : kanbanWidth(0, colW);
  const self: Record<string, unknown> = {};
  if (Math.abs(k.h - h) > EPS) self.h = h;
  if (Math.abs(k.w - w) > EPS) self.w = w;
  if (Object.keys(self).length) patches.push({ id: k.id, patch: self as ElementPatch });
  return { patches: patches.filter((p) => Object.keys(p.patch).length), counts };
}

/**
 * Where a drag would land if dropped now (drawn while dragging, never written): the moving items
 * whose center is over the board join it, and everything is planned as the drop's own layout
 * pass will plan it. Returns the other items' new spots (they make room) and the moving items'
 * slots (the drop indicator).
 */
export function planDrop(k: KanbanElement, all: BoardElement[], moving: BoardElement[]): DragPreview | null {
  const inside = (el: BoardElement) => {
    const cx = centerX(el);
    const cy = centerY(el);
    return cx >= k.x && cx <= k.x + k.w && cy >= k.y && cy <= k.y + k.h;
  };
  const joining = new Set(moving.filter((el) => el.type !== 'connector' && el.type !== 'pen' && !el.locked && inside(el)).map((el) => el.id));
  if (!joining.size) return null;
  const movingIds = new Set(moving.map((el) => el.id));
  const board = all
    .filter((el) => !movingIds.has(el.id) || joining.has(el.id))
    .map((el) => (joining.has(el.id) && el.frameId !== k.id ? { ...el, frameId: k.id } : el));
  const { patches } = planLayout(k, board, new Map());
  const byId = new Map(patches.map((p) => [p.id, p.patch as Record<string, number | undefined>]));
  const moves: DragPreview['moves'] = [];
  const slots: Rect[] = [];
  for (const el of board) {
    if (el.frameId !== k.id || el.id === k.id) continue;
    const p = byId.get(el.id);
    if (joining.has(el.id)) slots.push({ x: p?.x ?? el.x, y: p?.y ?? el.y, w: p?.w ?? el.w, h: p?.h ?? el.h });
    else if (p && (p.x !== undefined || p.y !== undefined)) moves.push({ id: el.id, x: p.x ?? el.x, y: p.y ?? el.y });
  }
  return { moves, slots };
}

/**
 * Moves that keep every item in its column when the columns change (added, removed, reordered,
 * collapsed, resized): each item travels by its column's change of position (center to center).
 * Items of a removed column go to `fallbackId`'s column.
 */
export function reflowMoves(
  k: KanbanElement,
  next: Geometry,
  all: BoardElement[],
  fallbackId: string | null,
): Array<{ id: string; dx: number; dy: number }> {
  const at = columnsOfChildren(k, all);
  const mid = (g: Geometry, i: number) => colLeft(g, i) + colWidth(g, i) / 2;
  const out: Array<{ id: string; dx: number; dy: number }> = [];
  for (const [id, oldIdx] of at) {
    const colId = k.columns[oldIdx].id;
    let newIdx = next.columns.findIndex((c) => c.id === colId);
    // A removed column's items join the fallback column (and take its status, as a drop would).
    if (newIdx < 0) newIdx = fallbackId ? next.columns.findIndex((c) => c.id === fallbackId) : -1;
    if (newIdx < 0) continue;
    const dx = mid(next, newIdx) - mid(k, oldIdx);
    if (Math.abs(dx) > EPS) out.push({ id, dx, dy: 0 });
  }
  return out;
}

