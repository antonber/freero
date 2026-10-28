// Reading order of board items: rows top to bottom, left to right within a row. A box joins the
// current row when it starts above the middle of the row's first box. Tab / Shift+Tab walk
// `readingOrderByFrame` (a frame's contents right after the frame).
import type { BoardElement } from '@freero/shared';
import { elementAABB } from './geometry';

export function readingOrder<T extends Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>(items: T[]): T[] {
  const boxed = items.map((item) => ({ item, r: elementAABB(item) })).sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const out: T[] = [];
  let i = 0;
  while (i < boxed.length) {
    const first = boxed[i].r;
    const rowEnd = first.y + first.h / 2;
    let j = i;
    while (j < boxed.length && boxed[j].r.y < rowEnd) j++;
    if (j === i) j = i + 1;
    out.push(...boxed.slice(i, j).sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y).map((b) => b.item));
    i = j;
  }
  return out;
}

/**
 * Reading order that finishes a frame before moving on (keyboard walking, the live region's
 * "2 of 14"): the board's top level — frames and the items outside any frame — in reading order,
 * each frame directly followed by its own contents in reading order (nested frames alike). An
 * item whose frame isn't in `items` counts as top level.
 */
export function readingOrderByFrame<T extends Pick<BoardElement, 'id' | 'x' | 'y' | 'w' | 'h' | 'rotation' | 'frameId'>>(items: T[]): T[] {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = item.frameId && item.frameId !== item.id && ids.has(item.frameId) ? item.frameId : null;
    const list = kids.get(parent);
    if (list) list.push(item);
    else kids.set(parent, [item]);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const item of readingOrder(kids.get(parent) ?? [])) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      walk(item.id);
    }
  };
  walk(null);
  // A frameId cycle (two frames naming each other) leaves items unreached: read them last.
  for (const item of readingOrder(items.filter((i) => !seen.has(i.id)))) out.push(item);
  return out;
}

/** Stacking classes: frames always render below everything else (see compareRenderOrder). */
const stackClass = (el: BoardElement) => (el.type === 'frame' ? 0 : 1);

function overlaps(a: BoardElement, b: BoardElement): boolean {
  const r = elementAABB(a);
  const s = elementAABB(b);
  return r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y;
}

/**
 * The z values that move each selected item one step up (dir 1) or down (dir -1) the stacking
 * order (Bring forward / Send backward): past the next item it overlaps, within its stacking
 * class. Items it doesn't overlap are passed over (stepping past them changes nothing visible),
 * and it never passes another selected item, so the selection keeps its own order. Riders
 * (`attachedTo`) travel with their item and stay right above it. `ordered` is the board in render
 * order without hidden items (they are no obstacles). Only moved elements get a new z, between
 * their new neighbours.
 */
export function planStackStep(ordered: BoardElement[], selected: ReadonlySet<string>, dir: 1 | -1): Array<{ id: string; z: number }> {
  const out: Array<{ id: string; z: number }> = [];
  for (const cls of [0, 1]) {
    const inClass = ordered.filter((el) => stackClass(el) === cls);
    const ids = new Set(inClass.map((el) => el.id));
    const hosted = (el: BoardElement) => !!el.attachedTo && ids.has(el.attachedTo);
    const ridersOf = new Map<string, BoardElement[]>();
    for (const el of inClass) if (hosted(el)) ridersOf.set(el.attachedTo!, [...(ridersOf.get(el.attachedTo!) ?? []), el]);
    // Units: an item plus the riders stacked on it, in render order.
    const units: BoardElement[][] = inClass.filter((el) => !hosted(el)).map((el) => [el, ...(ridersOf.get(el.id) ?? [])]);
    const isSel = (u: BoardElement[]) => selected.has(u[0].id);
    const movers = units.filter(isSel);
    // Stepping up, the top-most selected unit goes first (and the bottom-most stepping down).
    for (const unit of dir === 1 ? movers.reverse() : movers) {
      const from = units.indexOf(unit);
      let to = -1;
      for (let i = from + dir; i >= 0 && i < units.length && !isSel(units[i]); i += dir) {
        if (overlaps(unit[0], units[i][0])) {
          to = i;
          break;
        }
      }
      if (to < 0) continue;
      units.splice(from, 1);
      units.splice(to, 0, unit);
      const below = units[to - 1];
      const above = units[to + 1];
      const lo = below ? below[below.length - 1].z : above[0].z - unit.length - 1;
      const hi = above ? above[0].z : lo + unit.length + 1;
      unit.forEach((el, k) => {
        const z = lo + ((hi - lo) * (k + 1)) / (unit.length + 1);
        unit[k] = { ...el, z };
        out.push({ id: el.id, z });
      });
    }
  }
  return out;
}
