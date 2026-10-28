// Sizes of the items and how a dropped batch is laid out.
import type { Point, Rect } from '@engine';

/** File cards and audio players are drawn at this size and scale uniformly with their box. */
export const CARD_W = 320;
export const CARD_H = 84;
/** A new video's width; its height follows the picture (within limits). */
export const VIDEO_W = 480;
const VIDEO_MIN_H = 160;
const VIDEO_MAX_H = 720;
const GAP = 24;

export function videoSize(naturalW: number, naturalH: number): { w: number; h: number } {
  if (!naturalW || !naturalH) return { w: VIDEO_W, h: Math.round((VIDEO_W * 9) / 16) };
  const h = Math.round((VIDEO_W * naturalH) / naturalW);
  if (h <= VIDEO_MAX_H && h >= VIDEO_MIN_H) return { w: VIDEO_W, h };
  // Very tall (portrait phone video) or very wide: keep the ratio, fit the limit.
  const fh = Math.min(VIDEO_MAX_H, Math.max(VIDEO_MIN_H, h));
  return { w: Math.round((fh * naturalW) / naturalH), h: fh };
}

/** How wide a row of dropped items may get before the next one starts a new row. */
const MAX_ROW_W = 1100;

/**
 * Items in reading order, side by side in rows no wider than MAX_ROW_W (an item wider than that
 * gets a row of its own), each row vertically centered on its line, the whole block centered on
 * `center`. Never overlapping.
 */
export function rowLayout(sizes: ReadonlyArray<{ w: number; h: number }>, center: Point): Rect[] {
  const rows: Array<{ items: number[]; w: number; h: number }> = [];
  sizes.forEach(({ w, h }, i) => {
    const row = rows[rows.length - 1];
    if (row && row.w + GAP + w <= MAX_ROW_W) {
      row.items.push(i);
      row.w += GAP + w;
      row.h = Math.max(row.h, h);
    } else rows.push({ items: [i], w, h });
  });
  const totalH = rows.reduce((s, r) => s + r.h, 0) + GAP * Math.max(0, rows.length - 1);
  const out: Rect[] = new Array(sizes.length);
  let y = center.y - totalH / 2;
  for (const row of rows) {
    let x = center.x - row.w / 2;
    for (const i of row.items) {
      const { w, h } = sizes[i];
      out[i] = { x: Math.round(x), y: Math.round(y + (row.h - h) / 2), w, h };
      x += w + GAP;
    }
    y += row.h + GAP;
  }
  return out;
}

export function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}
