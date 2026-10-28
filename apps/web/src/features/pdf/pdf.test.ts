import { describe, expect, it } from 'vitest';
import { pageGrid } from './lib/layout';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('place all pages', () => {
  it('lays mixed portrait and landscape pages out in reading order without any two overlapping', () => {
    const pages = [
      { w: 612, h: 792 }, // letter portrait
      { w: 842, h: 595 }, // A4 landscape
      { w: 612, h: 792 },
      { w: 595, h: 842 }, // A4 portrait (taller)
      { w: 612, h: 792 },
    ];
    const { rects, w, h } = pageGrid(pages, 300, 20);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j]), `${i}/${j}`).toBe(false);
    // Reading order: each page is right of the previous one, or starts a lower row.
    for (let i = 1; i < rects.length; i++) expect(rects[i].x > rects[i - 1].x || rects[i].y > rects[i - 1].y).toBe(true);
    // The block's size covers every page (the free spot search uses it).
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(h + 1e-6);
    }
  });
});
