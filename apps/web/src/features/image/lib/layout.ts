// Pure placement math for inserted images (unit-tested).
import type { Point, Rect } from '@engine';

export const MAX_INSERT_SIDE = 600;
export const GRID_GAP = 24;

/** Natural size scaled down (never up) so the longer side is at most `max`. */
export function fitSize(naturalW: number, naturalH: number, max = MAX_INSERT_SIDE): { w: number; h: number } {
  const nw = naturalW > 0 ? naturalW : max;
  const nh = naturalH > 0 ? naturalH : max;
  const s = Math.min(1, max / Math.max(nw, nh));
  return { w: Math.max(1, Math.round(nw * s)), h: Math.max(1, Math.round(nh * s)) };
}

/**
 * Lays out boxes of different sizes in a near-square grid of rows (each row as tall as its
 * tallest item, items vertically centered in it), the whole block centered on `center`.
 */
export function gridLayout(sizes: Array<{ w: number; h: number }>, center: Point, gap = GRID_GAP): Rect[] {
  if (!sizes.length) return [];
  const cols = Math.ceil(Math.sqrt(sizes.length));
  const rows: Array<Array<{ w: number; h: number; i: number }>> = [];
  sizes.forEach((s, i) => {
    if (i % cols === 0) rows.push([]);
    rows[rows.length - 1].push({ ...s, i });
  });
  const rowW = rows.map((r) => r.reduce((sum, s) => sum + s.w, 0) + gap * (r.length - 1));
  const rowH = rows.map((r) => Math.max(...r.map((s) => s.h)));
  const totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
  const out: Rect[] = new Array(sizes.length);
  let y = center.y - totalH / 2;
  rows.forEach((r, ri) => {
    let x = center.x - rowW[ri] / 2;
    for (const s of r) {
      out[s.i] = { x: Math.round(x), y: Math.round(y + (rowH[ri] - s.h) / 2), w: s.w, h: s.h };
      x += s.w + gap;
    }
    y += rowH[ri] + gap;
  });
  return out;
}

/**
 * gridLayout, but the whole batch is scaled down (never up) so it fits in `avail` (the visible
 * part of the board, in world units): dropping five photos at 100% zoom keeps them all in view.
 */
export function fitGridLayout(
  sizes: Array<{ w: number; h: number }>,
  center: Point,
  avail: { w: number; h: number },
  gap = GRID_GAP,
): Rect[] {
  const first = gridLayout(sizes, center, gap);
  if (!first.length) return first;
  const minX = Math.min(...first.map((r) => r.x));
  const minY = Math.min(...first.map((r) => r.y));
  const maxX = Math.max(...first.map((r) => r.x + r.w));
  const maxY = Math.max(...first.map((r) => r.y + r.h));
  const s = Math.min(1, avail.w / (maxX - minX), avail.h / (maxY - minY));
  if (s >= 1) return first;
  const scaled = sizes.map(({ w, h }) => ({ w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }));
  return gridLayout(scaled, center, gap * s);
}

/** Box with the same width and center as `box`, height matching the natural aspect. */
export function naturalAspectBox(box: Rect, naturalW: number, naturalH: number): Rect {
  if (!(naturalW > 0 && naturalH > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const h = Math.round((box.w * naturalH) / naturalW);
  return { x: box.x, y: Math.round(box.y + (box.h - h) / 2), w: box.w, h };
}

/**
 * Box for a replaced picture: the new natural aspect, its longer side matching the old box's
 * longer side, centered where the old one was (so a portrait replacing a landscape doesn't
 * balloon to twice the height).
 */
export function replacementBox(box: Rect, naturalW: number, naturalH: number): Rect {
  if (!(naturalW > 0 && naturalH > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const s = Math.max(box.w, box.h) / Math.max(naturalW, naturalH);
  const w = Math.max(1, Math.round(naturalW * s));
  const h = Math.max(1, Math.round(naturalH * s));
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}
