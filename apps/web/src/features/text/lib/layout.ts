// Text box sizing rules (pure, unit-tested). The DOM measuring lives in ./measure.ts.
//
// - autoWidth: the box hugs its content: width = widest line, nothing wraps.
// - fixed width: text wraps at w; height always follows the content.
// - Resizing (resize: 'scale'): corner handles scale w and fontSize together → stays autoWidth.
//   Side handles change w only → the box switches to fixed width and wraps there.
//
// normalize() only sees the NEXT element, not what changed, so an auto-width box remembers the
// width it last laid itself out at (`autoW`). If w differs from it, someone resized the box.
import type { TextElement } from '@freero/shared';

export type MeasureFn = (wrapWidth: number | null) => { w: number; h: number };

/** Hidden derived field: the width auto-layout last set (see header). */
export type LaidOutText = TextElement & { autoW?: number };

/** Inner padding in world px; proportional to the font so corner scaling stays linear. */
export const textPadding = (fontSize: number) => Math.max(2, Math.round(fontSize * 0.3 * 10) / 10);

const EPS = 0.5;
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= EPS;

/** True when a w change came with a matching font scale (corner handle), not a side handle. */
function scaledTogether(newW: number, naturalW: number): boolean {
  return Math.abs(naturalW - newW) <= Math.max(3, newW * 0.06);
}

export function layoutText(el: LaidOutText, measure: MeasureFn): Partial<LaidOutText> | null {
  const patch: Partial<LaidOutText> = {};
  if (el.autoWidth) {
    const resized = el.autoW !== undefined && !near(el.autoW, el.w);
    const natural = measure(null);
    if (resized && !scaledTogether(el.w, natural.w)) {
      // Side handle: keep the width the user dragged to and wrap there from now on.
      patch.autoWidth = false;
      patch.autoW = undefined;
      const wrapped = measure(el.w);
      if (!near(el.h, wrapped.h)) patch.h = wrapped.h;
      return patch;
    }
    if (!near(el.w, natural.w)) patch.w = natural.w;
    if (!near(el.h, natural.h)) patch.h = natural.h;
    if (!near(el.autoW, natural.w)) patch.autoW = natural.w;
  } else {
    const wrapped = measure(el.w);
    if (!near(el.h, wrapped.h)) patch.h = wrapped.h;
    if (el.autoW !== undefined) patch.autoW = undefined;
  }
  return Object.keys(patch).length ? patch : null;
}
