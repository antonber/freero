// Non-destructive crop math (unit-tested). All rects here are in the image ELEMENT's local,
// unrotated frame: (0,0) = its top-left before this crop session, world units.
//
//   F = where the whole picture sits      C = the crop window (becomes the element's box)
//
// The element shows C; `crop` stores C as fractions of F, so the file itself never changes.
import type { ImageCrop, ImageElement } from '@freero/shared';
import type { Point, Rect } from '@engine';

export const FULL: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };

export interface CropDraft {
  full: Rect;
  window: Rect;
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const EPS = 1e-4;

/** The stored crop, or the whole picture; garbage from another client reads as the whole picture. */
export function cropOf(el: Pick<ImageElement, 'crop'>): ImageCrop {
  const c = el.crop;
  if (!c || ![c.x, c.y, c.w, c.h].every(Number.isFinite) || c.w <= 0 || c.h <= 0) return FULL;
  const w = Math.min(1, c.w);
  const h = Math.min(1, c.h);
  return { x: Math.min(Math.max(0, c.x), 1 - w), y: Math.min(Math.max(0, c.y), 1 - h), w, h };
}

/**
 * What the box actually shows, as fractions of the picture: the stored crop, narrowed (centered)
 * to the box's proportions when they differ — the same "cover" fit an uncropped image gets.
 */
export function visibleCrop(el: Pick<ImageElement, 'w' | 'h' | 'naturalW' | 'naturalH' | 'crop'>): ImageCrop {
  const c = cropOf(el);
  if (!(el.naturalW > 0 && el.naturalH > 0 && el.w > 0 && el.h > 0)) return c;
  const box = el.w / el.h;
  const shown = (el.naturalW * c.w) / (el.naturalH * c.h);
  if (Math.abs(shown - box) < 1e-6 * box) return c;
  if (shown > box) {
    const w = (c.w * box) / shown;
    return { ...c, x: c.x + (c.w - w) / 2, w };
  }
  const h = (c.h * shown) / box;
  return { ...c, y: c.y + (c.h - h) / 2, h };
}

/** The draft a crop session starts from: the window is the element's box. */
export function startDraft(el: Pick<ImageElement, 'w' | 'h' | 'naturalW' | 'naturalH' | 'crop'>): CropDraft {
  const c = visibleCrop(el);
  const fw = el.w / c.w;
  const fh = el.h / c.h;
  return { full: { x: 0 - c.x * fw, y: 0 - c.y * fh, w: fw, h: fh }, window: { x: 0, y: 0, w: el.w, h: el.h } };
}

/** Drags a handle of the crop window by (dx, dy), keeping it inside the picture and at least `min`. */
export function resizeWindow(d: CropDraft, start: Rect, handle: CropHandle, dx: number, dy: number, min: number): CropDraft {
  const f = d.full;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes('w')) left = Math.min(Math.max(f.x, left + dx), right - min);
  if (handle.includes('e')) right = Math.max(Math.min(f.x + f.w, right + dx), left + min);
  if (handle.includes('n')) top = Math.min(Math.max(f.y, top + dy), bottom - min);
  if (handle.includes('s')) bottom = Math.max(Math.min(f.y + f.h, bottom + dy), top + min);
  return { full: f, window: { x: left, y: top, w: right - left, h: bottom - top } };
}

/** Pans the picture under the window by (dx, dy); the window never leaves the picture. */
export function panPicture(d: CropDraft, startFull: Rect, dx: number, dy: number): CropDraft {
  const c = d.window;
  const x = Math.min(c.x, Math.max(c.x + c.w - startFull.w, startFull.x + dx));
  const y = Math.min(c.y, Math.max(c.y + c.h - startFull.h, startFull.y + dy));
  return { full: { ...startFull, x, y }, window: c };
}

const rotate = (p: Point, deg: number): Point => {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
};

/**
 * The element patch that shows `rect` (a local rect: the new box) of the picture `full`: box
 * placed so the content stays exactly where it was on the board, even when the item is rotated.
 */
function boxFor(el: Pick<ImageElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>, rect: Rect, full: Rect) {
  const off = rotate({ x: rect.x + rect.w / 2 - el.w / 2, y: rect.y + rect.h / 2 - el.h / 2 }, el.rotation || 0);
  const cx = el.x + el.w / 2 + off.x;
  const cy = el.y + el.h / 2 + off.y;
  const crop: ImageCrop = {
    x: (rect.x - full.x) / full.w,
    y: (rect.y - full.y) / full.h,
    w: rect.w / full.w,
    h: rect.h / full.h,
  };
  const whole = Math.abs(crop.x) < EPS && Math.abs(crop.y) < EPS && Math.abs(crop.w - 1) < EPS && Math.abs(crop.h - 1) < EPS;
  return { x: cx - rect.w / 2, y: cy - rect.h / 2, w: rect.w, h: rect.h, crop: whole ? null : crop };
}

/** Patch applying a crop session: the window becomes the box. */
export function applyDraft(el: ImageElement, d: CropDraft) {
  return boxFor(el, d.window, d.full);
}

/** Patch undoing the crop: the whole picture at the scale it is shown now, content kept in place. */
export function resetCrop(el: ImageElement) {
  const { full } = startDraft(el);
  return boxFor(el, full, full);
}

/** Natural size of what the box shows (the cropped part), for aspect checks. */
export function shownNaturalSize(el: Pick<ImageElement, 'naturalW' | 'naturalH' | 'crop'>): { w: number; h: number } {
  const c = cropOf(el);
  return { w: el.naturalW * c.w, h: el.naturalH * c.h };
}
