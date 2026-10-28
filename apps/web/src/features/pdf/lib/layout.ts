// PDF item geometry and the page grid of "Place all pages". Pure.
import type { Rect } from '@engine';

/** Paging bar under the page (world units). */
export const FOOT_H = 40;
/** Width a new PDF item gets (world units). */
export const ITEM_W = 420;
/** Pages placed as images: at most this many (a 300-page manual would bury the board). */
export const MAX_PLACED_PAGES = 60;
/** Raster width of a placed page image (px). */
export const PLACED_PAGE_PX = 1400;

export const itemHeight = (w: number, pageW: number, pageH: number) => Math.round((w * pageH) / Math.max(1, pageW)) + FOOT_H;

/** Columns for n pages: a roughly square block, never wider than 6. */
export const gridCols = (n: number) => Math.max(1, Math.min(6, Math.ceil(Math.sqrt(n))));

/**
 * Pages laid out left to right, top to bottom, each `width` wide (height by its own aspect), rows
 * as tall as their tallest page, `gap` apart. Rects relative to the block's top-left.
 */
export function pageGrid(pages: Array<{ w: number; h: number }>, width: number, gap: number): { rects: Rect[]; w: number; h: number } {
  const cols = gridCols(pages.length);
  const rects: Rect[] = [];
  let y = 0;
  for (let i = 0; i < pages.length; i += cols) {
    const row = pages.slice(i, i + cols).map((p) => ({ w: width, h: (width * p.h) / Math.max(1, p.w) }));
    row.forEach((p, c) => rects.push({ x: c * (width + gap), y, w: p.w, h: p.h }));
    y += Math.max(...row.map((p) => p.h)) + gap;
  }
  return { rects, w: Math.min(cols, pages.length) * (width + gap) - gap, h: Math.max(0, y - gap) };
}
