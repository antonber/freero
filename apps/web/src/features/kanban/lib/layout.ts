// Kanban geometry and the layout plan the engine applies after every local change
// (ElementDefinition.arrange). The plan itself is @freero/shared's `planKanban`: the server lays a
// kanban out by the same rule after a change it writes (an agent setting a card's field). Pure.
import {
  KANBAN_LAYOUT,
  KANBAN_PLAN,
  isStackable,
  kanbanBoardWidth,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanColumnWidth,
  kanbanLaneAt,
  planKanban,
  type BoardElement,
  type KanbanElement,
  type Rect,
} from '@freero/shared';
import type { DragPreview, ElementPatch } from '@engine';

export { beyondLimit, filteredOut, isStackable, laneField, reflowMoves } from '@freero/shared';

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
/** A swimlane's header band. */
export const LANE_HEAD_H = KANBAN_LAYOUT.laneHeadH;
/** A collapsed column's strip. */
export const COLLAPSED_W = KANBAN_LAYOUT.collapsedW;
/** An empty column still offers this much room to drop into. */
export const MIN_BODY = KANBAN_PLAN.minBody;
export const DEFAULT_COL_W = 280;
export const MIN_COL_W = 160;
export const MAX_COL_W = 640;

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

/** A child's stack order in its column (and swimlane `lane`, an index in `k.lanes`): top to bottom. */
export function columnOrder(k: KanbanElement, all: BoardElement[], colIdx: number, lane = -1): BoardElement[] {
  return all
    .filter((el) => isStackable(el, k.id) && columnIndexAt(k, centerX(el)) === colIdx && (lane < 0 || kanbanLaneAt(k, centerY(el)) === lane))
    .sort((a, b) => centerY(a) - centerY(b) || a.y - b.y || (a.id < b.id ? -1 : 1));
}

export interface LayoutPlan {
  patches: Array<{ id: string; patch: ElementPatch }>;
  /** Items per column after the layout (WIP counts: every swimlane, folded-away items too). */
  counts: number[];
}

/** Room under a column's (or cell's) visible items for its "N more" line. */
export const MORE_H = KANBAN_PLAN.moreH;
/** An empty swimlane still offers this much room to drop into. */
export const MIN_LANE_BODY = KANBAN_PLAN.minLaneBody;

/** Where everything goes after a change (@freero/shared `planKanban`: stacking, status, swimlanes, limits, filter, sort). */
export function planLayout(k: KanbanElement, all: BoardElement[], previous: ReadonlyMap<string, BoardElement | null>): LayoutPlan {
  const { patches, counts } = planKanban(k, all, previous);
  return { patches: patches as LayoutPlan['patches'], counts };
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
  // The moving items count as moved (a drop): they take the row under them, not their stored one.
  const { patches } = planLayout(k, board, new Map([...joining].map((id) => [id, null])));
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
