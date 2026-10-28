// Where reaction stamps go: overlapping the top-right corner of each reacted-to element,
// stepping left when that corner already carries a stamp so reactions line up instead of stacking.
import type { BoardElement } from '@freero/shared';
import type { Editor, Point, Rect } from '@engine';

export function reactionSize(target: Rect): number {
  return Math.round(Math.max(28, Math.min(64, Math.min(target.w, target.h) * 0.3)));
}

const overlapRatio = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
};

/** Top-left of a `size` stamp for `target`, avoiding `taken` stamp boxes (mutated: the slot is added). */
export function reactionSlot(target: Rect, size: number, taken: Rect[]): Point {
  const step = size * 0.8;
  let box = { x: target.x + target.w - size * 0.7, y: target.y - size * 0.3, w: size, h: size };
  for (let i = 0; i < 12 && taken.some((t) => overlapRatio(t, box) > 0.35); i++) box = { ...box, x: box.x - step };
  taken.push(box);
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

/** Element types a stamp can ride on: not other stamps, lines or containers (frames carry it anyway). */
export function canCarryStamp(editor: Pick<Editor, 'getDefinition'>, el: BoardElement): boolean {
  return el.type !== 'emoji' && el.type !== 'connector' && !editor.getDefinition(el.type)?.container;
}

/**
 * The element a stamp centered at `p` sits on (topmost that can carry it), or null. A reaction's
 * slot overlaps its target's top-right corner with its center inside the target, so a stamp
 * dropped back on the same spot stays attached.
 */
export function stampTargetAt(editor: Pick<Editor, 'elementsInRect' | 'getDefinition'>, p: Point, exclude?: string): BoardElement | null {
  let best: BoardElement | null = null;
  for (const el of editor.elementsInRect({ x: p.x - 0.5, y: p.y - 0.5, w: 1, h: 1 }, 'intersect')) {
    if (el.id === exclude || !canCarryStamp(editor, el)) continue;
    if (!best || el.z > best.z) best = el;
  }
  return best;
}
