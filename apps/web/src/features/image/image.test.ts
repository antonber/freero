// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Editor } from '@engine';
import { imageUrlFromPaste } from './lib/files';
import { INLINE_FALLBACK_MAX_BYTES, storeImage } from './lib/insert';
import { fitGridLayout, fitSize, gridLayout, naturalAspectBox, replacementBox } from './lib/layout';

describe('placing inserted images', () => {
  it('scales big images down to fit 600px keeping their aspect, and never blows small ones up', () => {
    expect(fitSize(3000, 1500)).toEqual({ w: 600, h: 300 });
    expect(fitSize(1000, 4000)).toEqual({ w: 150, h: 600 });
    expect(fitSize(120, 80)).toEqual({ w: 120, h: 80 });
  });

  it('several dropped images of different sizes do not overlap and stay centered on the drop point', () => {
    const sizes = [
      { w: 600, h: 300 },
      { w: 150, h: 600 },
      { w: 400, h: 400 },
      { w: 200, h: 100 },
      { w: 300, h: 500 },
    ];
    const rects = gridLayout(sizes, { x: 1000, y: 500 });
    rects.forEach((r, i) => expect({ w: r.w, h: r.h }).toEqual(sizes[i]));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i], rects[j]];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    expect(Math.abs((minY + maxY) / 2 - 500)).toBeLessThanOrEqual(1);
    expect(minX).toBeLessThan(1000);
    expect(maxX).toBeGreaterThan(1000);
  });

  it('a batch too big for the visible area is shrunk to stay in view, each image keeping its aspect', () => {
    const sizes = [
      { w: 600, h: 338 },
      { w: 300, h: 600 },
      { w: 300, h: 300 },
    ];
    const rects = fitGridLayout(sizes, { x: 0, y: 0 }, { w: 1150, h: 675 });
    expect(Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x))).toBeLessThanOrEqual(1150);
    expect(Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y))).toBeLessThanOrEqual(675);
    rects.forEach((r, i) => expect(r.w / r.h).toBeCloseTo(sizes[i].w / sizes[i].h, 1));
  });

  it('reset to natural aspect keeps the image centered where it was', () => {
    const box = naturalAspectBox({ x: 100, y: 100, w: 400, h: 400 }, 1600, 900);
    expect(box).toEqual({ x: 100, y: 188, w: 400, h: 225 });
  });
});

describe('replace image', () => {
  it('a portrait replacing a landscape keeps the footprint and center instead of ballooning in height', () => {
    expect(replacementBox({ x: 0, y: 0, w: 600, h: 338 }, 500, 1000)).toEqual({ x: 150, y: -131, w: 300, h: 600 });
  });
});

describe('paste detection', () => {
  it('claims image links and data URLs but leaves sentences that merely contain a link to text', () => {
    expect(imageUrlFromPaste('https://example.com/cat.png', null)).toBe('https://example.com/cat.png');
    expect(imageUrlFromPaste('data:image/png;base64,iVBORw0KGgo=', null)).toMatch(/^data:image\/png/);
    expect(imageUrlFromPaste('see https://example.com/cat.png for details', null)).toBeNull();
    // Copying an image in a browser gives HTML with an <img> and no plain text.
    expect(imageUrlFromPaste(null, '<meta charset="utf-8"><img src="https://cdn.example.com/a.jpg?w=1&amp;h=2" alt="">')).toBe(
      'https://cdn.example.com/a.jpg?w=1&h=2',
    );
    // Rich text that happens to include an image is still text.
    expect(imageUrlFromPaste('Quarterly notes', '<p>Quarterly notes <img src="https://x.test/i.png"></p>')).toBeNull();
  });
});

describe('upload fallback', () => {
  const failingEditor = { host: { uploadImage: () => Promise.reject(new Error('offline')) } } as unknown as Editor;

  it('when the upload fails, a small image is kept inline and a large one is refused instead of bloating the board', async () => {
    const small = new Blob([new Uint8Array(2048)], { type: 'image/png' });
    const large = new Blob([new Uint8Array(INLINE_FALLBACK_MAX_BYTES + 1)], { type: 'image/png' });
    const a = await storeImage(failingEditor, small);
    expect('url' in a && a.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(await storeImage(failingEditor, large)).toEqual({ error: 'too-large' });
  });
});
