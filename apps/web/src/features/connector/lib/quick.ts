// Quick-connect: where a connected copy of an item goes when you click its "+" handle.
import type { BoardElement } from '@freero/shared';
import type { Editor, Point, Rect } from '@engine';
import { aabb, sideNormal, type Side } from './geometry';

/** Gap between an item and its connected copy (world units). */
export const QUICK_GAP = 96;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Offset that places a copy of `el` beside its `side` (along the side's rotated normal). When
 * that spot is taken, the copy steps sideways (perpendicular to the side) until it is free, so
 * repeated clicks fan out instead of stacking copies on top of each other.
 */
export function nextToSide(
  el: BoardElement,
  side: Side,
  occupied: Rect[],
): Point {
  const n = sideNormal(el, side);
  const along = side === 'left' || side === 'right' ? el.w : el.h;
  const across = side === 'left' || side === 'right' ? el.h : el.w;
  const t = { x: -n.y, y: n.x };
  const base = { x: n.x * (along + QUICK_GAP), y: n.y * (along + QUICK_GAP) };
  const box = aabb(el);
  for (let i = 0; i < 8; i++) {
    // 0, +1, -1, +2, -2 … steps of one item + half a gap
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const step = k * (across + QUICK_GAP / 2);
    const off = { x: Math.round(base.x + t.x * step), y: Math.round(base.y + t.y * step) };
    const r = { x: box.x + off.x, y: box.y + off.y, w: box.w, h: box.h };
    if (!occupied.some((o) => overlaps(o, r))) return off;
  }
  return { x: Math.round(base.x), y: Math.round(base.y) };
}

/**
 * True when a quick-connect "+" of `el` drawn at `world` (radius `r`, world units) would sit on
 * another item — a mind-map sibling just above, the next sticky in a dense grid. That "+" is left
 * out: it would cover the item and take the clicks meant for it, and a copy on that side would
 * have to fan out anyway. Containers around the item (frames) and lines don't count.
 */
export function quickSpotTaken(editor: Editor, el: BoardElement, world: Point, r: number): boolean {
  return editor
    .elementsInRect({ x: world.x - r, y: world.y - r, w: 2 * r, h: 2 * r }, 'intersect')
    .some((o) => o.id !== el.id && o.attachedTo !== el.id && o.type !== 'connector' && !editor.getDefinition(o.type)?.container);
}

/** Boxes of the items that a new copy must not land on. */
export function occupiedRects(editor: Editor, around: BoardElement, radius: number): Rect[] {
  const b = aabb(around);
  const area = { x: b.x - radius, y: b.y - radius, w: b.w + 2 * radius, h: b.h + 2 * radius };
  return editor
    .elementsInRect(area, 'intersect')
    .filter((o) => o.id !== around.id && o.type !== 'connector' && !editor.getDefinition(o.type)?.container)
    .map(aabb);
}
