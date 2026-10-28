// Placing a library shape: click = next to what's in view (findFreeSpot), drag = where dropped.
import type { ShapeKind } from '@freero/shared';
import type { Editor, Point } from '@engine';
import { LIBRARY_KINDS, type LibraryShape } from './library';
import { nextShapeStyle } from './actions';

/** Drag payload (text/plain) a library tile carries onto the canvas; shape's importData claims it. */
const DRAG_PREFIX = 'freero-shape:';

export const encodeDrag = (s: LibraryShape) => `${DRAG_PREFIX}${s.kind}:${s.w}x${s.h}`;

export function decodeDrag(text: string | null): { kind: ShapeKind; w: number; h: number } | null {
  const m = text?.trim().match(/^freero-shape:([A-Za-z]+):(\d{1,4})x(\d{1,4})$/);
  if (!m || !(LIBRARY_KINDS as string[]).includes(m[1])) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  if (w < 8 || h < 8) return null;
  return { kind: m[1] as ShapeKind, w, h };
}

/** Creates the shape centered on `at` (or in a free spot near the view), selected. */
export function insertShape(editor: Editor, s: { kind: ShapeKind; w: number; h: number }, at?: Point): string {
  const pos = at ? { x: at.x - s.w / 2, y: at.y - s.h / 2 } : editor.findFreeSpot({ w: s.w, h: s.h });
  return editor.create({ ...nextShapeStyle(editor, s.kind), x: Math.round(pos.x), y: Math.round(pos.y), w: s.w, h: s.h }, { select: true });
}
