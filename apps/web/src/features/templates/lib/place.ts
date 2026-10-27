// Pure placement + instantiation (unit-tested): where a template lands and the elements it
// becomes. No editor access here; insert.ts feeds in the board's state.
import type { NewElement, Point, Rect } from '@engine';
import type { TemplateCategory, TemplateDef } from './types';

export function boundsOf(els: Array<{ x: number; y: number; w: number; h: number }>): Rect | null {
  if (!els.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of els) {
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w);
    y1 = Math.max(y1, e.y + e.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Moves an element, including absolute nested points (connector endpoints, waypoints). */
export function translate(el: NewElement, dx: number, dy: number): NewElement {
  const out = { ...el, x: el.x + dx, y: el.y + dy } as NewElement;
  if (el.type === 'connector') {
    const c = el as NewElement<'connector'>;
    const o = out as NewElement<'connector'>;
    o.start = { ...c.start, x: c.start.x + dx, y: c.start.y + dy };
    o.end = { ...c.end, x: c.end.x + dx, y: c.end.y + dy };
    if (c.waypoints) o.waypoints = c.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return out;
}

export interface BoardSnapshot {
  /** Top-left of a free spot for content of `size` (the editor's findFreeSpot). */
  place(size: { w: number; h: number }): Point;
  /** Highest frame index on the board, or -1 without frames. */
  maxFrameIndex: number;
}

/**
 * The elements to create for `def` on a board in state `board`: fresh ids (from `newId`),
 * moved into the free spot the board offers, frames numbered after existing frames.
 */
export function instantiate(def: TemplateDef, board: BoardSnapshot, newId: () => string): NewElement[] {
  const els = def.build(newId);
  const b = boundsOf(els) ?? { x: 0, y: 0, w: 0, h: 0 };
  const spot = board.place({ w: b.w, h: b.h });
  const off = { x: spot.x - b.x, y: spot.y - b.y };
  let frameIndex = board.maxFrameIndex;
  return els.map((el) => {
    const moved = translate(el, off.x, off.y);
    if (moved.type === 'frame') (moved as NewElement<'frame'>).index = ++frameIndex;
    return moved;
  });
}

/** Templates matching a free-text query and an optional category. */
export function filterTemplates(all: TemplateDef[], query: string, category: TemplateCategory | null): TemplateDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((t) => {
    if (category && !t.categories.includes(category)) return false;
    if (!words.length) return true;
    const hay = [t.name, t.description, ...t.keywords, ...t.categories].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
