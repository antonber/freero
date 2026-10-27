// One eraser sweep (pointer moved from → to) over the board. The engine wraps the tool's whole
// pointer-down → up in one gesture, so a drag that cuts or deletes many strokes is ONE undo step.
import type { PenElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { cutStroke } from './cut';
import { sweepTouches } from './sweep';

/** 'partial' cuts through strokes (default); 'stroke' deletes every stroke it touches, whole. */
export type EraserMode = 'partial' | 'stroke';

function strokesNear(editor: Editor, from: Point, to: Point, r: number): PenElement[] {
  const box = {
    x: Math.min(from.x, to.x) - r,
    y: Math.min(from.y, to.y) - r,
    w: Math.abs(to.x - from.x) + 2 * r,
    h: Math.abs(to.y - from.y) + 2 * r,
  };
  return editor.elementsInRect(box, 'intersect').filter((el): el is PenElement => el.type === 'pen' && !el.locked);
}

/**
 * Erases along the segment `from` → `to` with `radius` (world units). Partial mode replaces each
 * touched stroke by the pieces left on either side of the eraser (same style, z, frame, group and
 * rotation); stroke mode deletes the touched strokes (the pen says where its ink is).
 */
export function eraseSweep(editor: Editor, from: Point, to: Point, radius: number, mode: EraserMode): void {
  const near = strokesNear(editor, from, to, radius);
  if (!near.length) return;
  if (mode === 'stroke') {
    const distanceTo = editor.getDefinition('pen')?.distanceTo;
    if (!distanceTo) return;
    const hits = near.filter((el) => sweepTouches(distanceTo, el, from, to, radius)).map((el) => el.id);
    if (hits.length) editor.remove(hits);
    return;
  }
  const remove: string[] = [];
  const create: NewElement<'pen'>[] = [];
  for (const el of near) {
    const pieces = cutStroke(el, from, to, radius);
    if (!pieces) continue;
    remove.push(el.id);
    const { id: _id, updatedAt: _u, ...style } = el;
    for (const piece of pieces) create.push({ ...style, ...piece });
  }
  if (!remove.length) return;
  editor.transact(() => {
    editor.remove(remove);
    if (create.length) editor.createMany(create);
  });
}
