// Does an eraser sweep (the segment the pointer moved along, with a radius) touch an element?
// The element's own definition says how far a point is from its ink (`distanceTo`, e.g. the
// pen's); we only walk the sweep in its local (unrotated, scaled) space.
import type { BoardElement } from '@freero/shared';
import { worldToLocal, type Point } from '@engine';

export type DistanceTo = (element: BoardElement, local: Point) => number;

/**
 * True when the eraser moving from `from` to `to` (world) with `radius` (world units) comes
 * within `radius` of the ink. The sweep is sampled every radius/2, so a fast flick between two
 * pointer events still erases what it jumped over.
 */
export function sweepTouches(distanceTo: DistanceTo, el: BoardElement, from: Point, to: Point, radius: number): boolean {
  const a = worldToLocal(el, from);
  const b = worldToLocal(el, to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.min(400, Math.max(1, Math.ceil(len / Math.max(0.5, radius / 2))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (distanceTo(el, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) <= radius) return true;
  }
  return false;
}
