// The Layers list as fixed-height rows (a group head, then its items unless collapsed), so only
// the rows in view are mounted: boards with thousands of items open the panel instantly.
import type { BoardElement } from '@freero/shared';
import type { OutlineGroup } from './outline';

/** Heights (px) the CSS gives each kind of row (.fr-layers__head / .fr-layers__row). */
export const HEAD_H = 36;
export const ROW_H = 34;
/** Space above every group head but the first. */
export const GROUP_GAP = 6;

interface RowBase {
  /** Stable React key and keyboard-cursor id. */
  key: string;
  /** Frame id, or 'board' for items not in a frame. */
  groupKey: string;
  group: OutlineGroup;
  /** Offset from the top of the list. */
  top: number;
}
export type LayerRow = (RowBase & { kind: 'head' }) | (RowBase & { kind: 'item'; el: BoardElement; index: number });

export const groupKeyOf = (g: OutlineGroup) => g.frame?.id ?? 'board';
export const rowHeight = (r: LayerRow) => (r.kind === 'head' ? HEAD_H : ROW_H);

export function layoutRows(groups: OutlineGroup[], collapsed: ReadonlySet<string>): { rows: LayerRow[]; height: number } {
  const rows: LayerRow[] = [];
  let top = 0;
  groups.forEach((group, gi) => {
    const groupKey = groupKeyOf(group);
    if (gi > 0) top += GROUP_GAP;
    rows.push({ kind: 'head', key: `g:${groupKey}`, groupKey, group, top });
    top += HEAD_H;
    if (collapsed.has(groupKey)) return;
    group.items.forEach((el, index) => {
      rows.push({ kind: 'item', key: el.id, groupKey, group, el, index, top });
      top += ROW_H;
    });
  });
  return { rows, height: top };
}

/** First row whose bottom is below `y` (rows are sorted by top). */
function firstEndingAfter(rows: LayerRow[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rowHeight(rows[mid]) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** [from, to) of the rows to mount for a viewport, plus `overscan` rows either side. */
export function visibleRange(rows: LayerRow[], scrollTop: number, viewport: number, overscan = 8): [number, number] {
  const from = firstEndingAfter(rows, scrollTop);
  let to = from;
  while (to < rows.length && rows[to].top < scrollTop + viewport) to++;
  return [Math.max(0, from - overscan), Math.min(rows.length, to + overscan)];
}

/** The scrollTop that brings `row` fully into view with the least movement, or null if it already is. */
export function scrollToShow(row: LayerRow, scrollTop: number, viewport: number): number | null {
  const bottom = row.top + rowHeight(row);
  if (row.top < scrollTop) return row.top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return null;
}

/** Insertion slot (0..n) in a group's items for a pointer at list offset `y` (row midpoints). */
export function slotAt(rows: LayerRow[], groupKey: string, y: number): number {
  const items = rows.filter((r): r is Extract<LayerRow, { kind: 'item' }> => r.kind === 'item' && r.groupKey === groupKey);
  const i = items.findIndex((r) => y < r.top + ROW_H / 2);
  return i < 0 ? items.length : i;
}
