// Kanban geometry and the layout plan the engine applies after every local change
// (ElementDefinition.arrange). Pure: unit-tested without an editor.
import type { BoardElement, CardStatus, KanbanColumn, KanbanElement } from '@freero/shared';
import type { ElementPatch } from '@engine';

/** Board title band. */
export const HEADER_H = 52;
/** Column header (title, count, menu). */
export const COL_HEAD_H = 44;
/** Between columns and around them. */
export const GAP = 12;
/** Inside a column, around its items. */
export const PAD = 10;
/** Between stacked items. */
export const ITEM_GAP = 10;
/** An empty column still offers this much room to drop into. */
export const MIN_BODY = 180;
export const DEFAULT_COL_W = 280;
export const MIN_COL_W = 160;

const EPS = 0.01;

export const kanbanWidth = (n: number, colW: number) => GAP + n * (colW + GAP);
/** Column i's left edge, element-local. */
export const colLeft = (colW: number, i: number) => GAP + i * (colW + GAP);
/** Width items get inside a column. */
export const innerWidth = (colW: number) => colW - 2 * PAD;
/** colW that makes n columns fill a kanban `w` wide. */
export const colWFor = (w: number, n: number) => Math.max(MIN_COL_W, (w - GAP) / Math.max(1, n) - GAP);

/** Column index under a world x (clamped: just left/right of the board counts as the edge column). */
export function columnIndexAt(k: Pick<KanbanElement, 'x' | 'colW' | 'columns'>, worldX: number): number {
  const i = Math.floor((worldX - k.x - GAP / 2) / (k.colW + GAP));
  return Math.max(0, Math.min(k.columns.length - 1, i));
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
 * stale boards are never rewritten by whoever happens to edit next).
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
  const byCol: Array<Array<{ el: BoardElement; key: number }>> = k.columns.map(() => []);
  // Where the board itself was (it may have moved in the same change, carrying its items).
  const kBefore = (previous.get(k.id) as KanbanElement | null | undefined) ?? k;

  for (const el of items) {
    let col = columnIndexAt(k, centerX(el));
    let key = centerY(el);
    const prev = previous.get(el.id);
    if (el.type === 'card' && prev !== undefined) {
      const want: CardStatus | null = k.columns[col]?.status ?? null;
      const status = el.status ?? null;
      const movedIn =
        prev === null ||
        prev.frameId !== k.id ||
        kBefore.columns[columnIndexAt(kBefore, centerX(prev))]?.id !== k.columns[col]?.id;
      const statusChanged = prev !== null && prev.type === 'card' && (prev.status ?? null) !== status;
      if (want && status !== want) {
        const statusCol = status ? k.columns.findIndex((c) => c.status === status) : -1;
        if (!movedIn && statusChanged && statusCol >= 0) {
          // Status changed where the card stood (format toolbar): it moves to that column, last.
          col = statusCol;
          key = Number.POSITIVE_INFINITY;
        } else if (movedIn) {
          patches.push({ id: el.id, patch: { status: want } as ElementPatch });
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
    const x = k.x + colLeft(colW, col) + PAD;
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
      const existing = patches.find((p) => p.id === el.id);
      if (Object.keys(patch).length) {
        if (existing) Object.assign(existing.patch, patch);
        else patches.push({ id: el.id, patch: patch as ElementPatch });
      }
      y += h + ITEM_GAP;
    }
    tallest = Math.max(tallest, list.length ? y - ITEM_GAP - top : 0);
  });

  const h = HEADER_H + COL_HEAD_H + Math.max(MIN_BODY, tallest + 2 * PAD) + GAP;
  const w = kanbanWidth(n, colW);
  const own: Record<string, unknown> = {};
  if (Math.abs(k.h - h) > EPS) own.h = h;
  if (Math.abs(k.w - w) > EPS) own.w = w;
  if (Object.keys(own).length) patches.push({ id: k.id, patch: own as ElementPatch });
  return { patches, counts };
}

/**
 * Moves that keep every item in its column when the columns change (added, removed,
 * reordered): each item travels by its column's change of position. Items of a removed column
 * go to `fallbackId`'s column.
 */
export function reflowMoves(
  k: KanbanElement,
  next: KanbanColumn[],
  all: BoardElement[],
  fallbackId: string | null,
): Array<{ id: string; dx: number; dy: number }> {
  const at = columnsOfChildren(k, all);
  const step = k.colW + GAP;
  const out: Array<{ id: string; dx: number; dy: number }> = [];
  for (const [id, oldIdx] of at) {
    const colId = k.columns[oldIdx].id;
    let newIdx = next.findIndex((c) => c.id === colId);
    // A removed column's items join the fallback column (and take its status, as a drop would).
    if (newIdx < 0) newIdx = fallbackId ? next.findIndex((c) => c.id === fallbackId) : -1;
    if (newIdx < 0) continue;
    const dx = (newIdx - oldIdx) * step;
    if (dx) out.push({ id, dx, dy: 0 });
  }
  return out;
}
