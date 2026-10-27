// Hit-testing and viewport culling over the render-ordered element list.
import type { BoardElement, ElementType } from '@freero/shared';
import type { ElementDefinition, Point, Rect } from '../api';
import { elementAABB, elementInsideRect, elementIntersectsRect, rectsIntersect, worldToLocal } from './geometry';

export type DefLookup = (type: ElementType) => ElementDefinition<any> | undefined;

/**
 * How far (screen px) off an element's drawn shape a click still hits it. Callers pass
 * HIT_TOLERANCE_PX / zoom, so it is the same on screen at every zoom.
 */
export const HIT_TOLERANCE_PX = 4;

/**
 * Topmost element under `point`. `ordered` is in render order (bottom → top), so we walk it
 * backwards. `tolerance` (world units) grows thin targets so they stay clickable when zoomed out.
 */
export function hitTestElements(
  ordered: readonly BoardElement[],
  point: Point,
  getDef: DefLookup,
  opts: { exclude?: string[]; types?: ElementType[]; tolerance?: number } = {},
): BoardElement | null {
  const tol = opts.tolerance ?? 0;
  const exclude = opts.exclude && opts.exclude.length ? new Set(opts.exclude) : null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const el = ordered[i];
    if (exclude?.has(el.id)) continue;
    if (opts.types && !opts.types.includes(el.type)) continue;
    if (hitTestElement(el, point, getDef, tol)) return el;
  }
  return null;
}

export function hitTestElement(el: BoardElement, point: Point, getDef: DefLookup, tol = 0): boolean {
  const aabb = elementAABB(el);
  if (
    point.x < aabb.x - tol ||
    point.y < aabb.y - tol ||
    point.x > aabb.x + aabb.w + tol ||
    point.y > aabb.y + aabb.h + tol
  )
    return false;
  const local = worldToLocal(el, point);
  const def = getDef(el.type);
  if (def?.hitTest) return def.hitTest(el, local, { tolerance: tol });
  if (def?.distanceTo) return def.distanceTo(el, local) <= tol;
  return local.x >= -tol && local.y >= -tol && local.x <= el.w + tol && local.y <= el.h + tol;
}

export function elementsInRect(
  ordered: readonly BoardElement[],
  rect: Rect,
  mode: 'intersect' | 'contain' = 'intersect',
): BoardElement[] {
  return ordered.filter((el) => (mode === 'contain' ? elementInsideRect(el, rect) : elementIntersectsRect(el, rect)));
}

/** Elements whose AABB touches `rect` (viewport culling). Cheap linear scan. */
export function cull(ordered: readonly BoardElement[], rect: Rect): BoardElement[] {
  const out: BoardElement[] = [];
  for (const el of ordered) {
    if (rectsIntersect(elementAABB(el), rect)) out.push(el);
  }
  return out;
}

/** Render order: frames (containers) first, then everything else by z, ties by id. */
export function compareRenderOrder(a: BoardElement, b: BoardElement): number {
  const fa = a.type === 'frame' ? 0 : 1;
  const fb = b.type === 'frame' ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
