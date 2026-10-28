// Frame grid auto-layout: a frame with `layout: { kind: 'grid', cols, gap }` keeps its children in
// a grid (reading order, `cols` columns, columns as wide as the widest item, rows as tall as their
// tallest) and hugs them. Applied by the engine's arrange pass after every local change, so an item
// dropped in takes the slot it was dropped on. Pure.
import type { BoardElement, FrameElement, FrameGridLayout } from '@freero/shared';
import type { ElementPatch } from '@engine';

export const GRID_GAPS = [
  { id: 's', label: 'S', gap: 16 },
  { id: 'm', label: 'M', gap: 32 },
  { id: 'l', label: 'L', gap: 64 },
];
export const DEFAULT_GRID: FrameGridLayout = { kind: 'grid', cols: 3, gap: 32 };
export const MAX_COLS = 12;

const EPS = 0.01;
const cx = (el: BoardElement) => el.x + el.w / 2;
const cy = (el: BoardElement) => el.y + el.h / 2;

/**
 * The order items take: the laid-out ones by their current rows (top to bottom, left to right);
 * an item that was moved slots into the row its center is in, between the items left and right of
 * it — or after everything when dropped below the last row.
 */
function ordered(items: BoardElement[], moved: (el: BoardElement) => boolean): BoardElement[] {
  // Rows of the items that stayed: one joins the current row when its top is above the middle of
  // the row's first item (a laid-out grid's rows exactly; a rough layout's rows when turned on).
  const still = items.filter((el) => !moved(el)).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Array<{ top: number; bottom: number; firstH: number; ids: Set<string> }> = [];
  for (const el of still) {
    const row = rows[rows.length - 1];
    if (row && el.y < row.top + row.firstH / 2) {
      row.ids.add(el.id);
      row.bottom = Math.max(row.bottom, el.y + el.h);
    } else rows.push({ top: el.y, bottom: el.y + el.h, firstH: el.h, ids: new Set([el.id]) });
  }
  const rowOf = (el: BoardElement): number => {
    const own = rows.findIndex((r) => r.ids.has(el.id));
    if (own >= 0) return own;
    const y = cy(el);
    if (rows.length && y > rows[rows.length - 1].bottom) return rows.length; // below everything: last
    let r = 0;
    for (let i = 0; i < rows.length; i++) if (y >= rows[i].top) r = i;
    return r;
  };
  return [...items].sort((a, b) => rowOf(a) - rowOf(b) || cx(a) - cx(b) || (a.id < b.id ? -1 : 1));
}

export function planGrid(
  frame: FrameElement,
  children: BoardElement[],
  previous: ReadonlyMap<string, BoardElement | null>,
): Array<{ id: string; patch: ElementPatch }> | null {
  const layout = frame.layout;
  if (!layout || layout.kind !== 'grid' || !children.length) return null;
  const cols = Math.max(1, Math.min(MAX_COLS, Math.round(layout.cols)));
  const gap = Math.max(0, layout.gap);
  const fBefore = (previous.get(frame.id) as FrameElement | null | undefined) ?? frame;
  // Moved = its position relative to the frame changed in this change (dragged, created, nudged).
  const moved = (el: BoardElement) => {
    const p = previous.get(el.id);
    if (p === undefined) return false;
    if (p === null || p.frameId !== frame.id) return true;
    return Math.abs(p.x - fBefore.x - (el.x - frame.x)) > EPS || Math.abs(p.y - fBefore.y - (el.y - frame.y)) > EPS;
  };
  const items = ordered(children, moved);
  const colW = Math.max(...items.map((el) => el.w));
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  let y = frame.y + gap;
  for (let r = 0; r < items.length; r += cols) {
    const row = items.slice(r, r + cols);
    row.forEach((el, c) => {
      const x = frame.x + gap + c * (colW + gap);
      const patch: Record<string, unknown> = {};
      if (Math.abs(el.x - x) > EPS) patch.x = x;
      if (Math.abs(el.y - y) > EPS) patch.y = y;
      if (Object.keys(patch).length) patches.push({ id: el.id, patch: patch as ElementPatch });
    });
    y += Math.max(...row.map((el) => el.h)) + gap;
  }
  const w = gap + Math.min(cols, items.length) * (colW + gap);
  const h = y - frame.y;
  if (Math.abs(frame.w - w) > EPS || Math.abs(frame.h - h) > EPS) patches.push({ id: frame.id, patch: { w, h, preset: 'custom' } as ElementPatch });
  return patches.length ? patches : null;
}
