// Text box sizing rules (pure, unit-tested; the measuring is the engine's measureRichText).
//
// - autoWidth: the box hugs its content: width = widest line, nothing wraps.
// - fixed width: text wraps at w; height always follows the content.
// - Resizing (resize: 'scale'): corner handles scale w, h and fontSize together → stays autoWidth.
//   Side handles change w alone → the box switches to fixed width and wraps there.
//   Double-clicking a side handle (fitToContent) switches it back to auto width.
// normalize(next, prev) tells these apart by what changed since `prev`.
import type { FontFamily, TextElement } from '@freero/shared';
import { measureRichText } from '@engine';

export type MeasureFn = (wrapWidth: number | null) => { w: number; h: number };

/** Inner padding in world px; proportional to the font so corner scaling stays linear. */
export const textPadding = (fontSize: number) => Math.max(2, Math.round(fontSize * 0.3 * 10) / 10);

/**
 * Size of a text element's box for `html` (what ElementText renders, padding included).
 * `wrapWidth` null = no wrapping (auto width); otherwise the box is that wide.
 */
export function measureTextBox(html: string, family: FontFamily, fontSize: number, wrapWidth: number | null): { w: number; h: number } {
  const pad = textPadding(fontSize);
  const m = measureRichText(html, {
    fontFamily: family,
    fontSize,
    padding: pad,
    width: wrapWidth === null ? undefined : Math.max(1, wrapWidth - pad * 2),
  });
  // An empty box still shows a caret-wide box, one line tall.
  return { w: wrapWidth ?? Math.max(Math.ceil(pad * 2 + fontSize * 0.6), m.w), h: m.h };
}

const EPS = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

type Laid = Pick<TextElement, 'w' | 'h' | 'fontSize' | 'autoWidth'>;

/** True when this change is a side-handle drag: width alone changed on an auto-width box. */
function sideResized(el: Laid, prev: Laid | undefined): boolean {
  return !!prev && el.autoWidth && prev.autoWidth && el.w !== prev.w && el.h === prev.h && el.fontSize === prev.fontSize;
}

export function layoutText(el: Laid, prev: Laid | undefined, measure: MeasureFn): Partial<TextElement> | null {
  const patch: Partial<TextElement> = {};
  let auto = el.autoWidth;
  if (sideResized(el, prev)) {
    // Keep the width the user dragged to and wrap there from now on.
    patch.autoWidth = false;
    auto = false;
  }
  if (auto) {
    const natural = measure(null);
    if (!near(el.w, natural.w)) patch.w = natural.w;
    if (!near(el.h, natural.h)) patch.h = natural.h;
  } else {
    const wrapped = measure(el.w);
    if (!near(el.h, wrapped.h)) patch.h = wrapped.h;
  }
  return Object.keys(patch).length ? patch : null;
}
