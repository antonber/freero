// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Editor } from '@engine';
import { imageUrlFromPaste } from './lib/files';
import { INLINE_FALLBACK_MAX_BYTES, storeImage } from './lib/insert';
import type { ImageElement } from '@freero/shared';
import { fitGridLayout, fitSize, gridLayout, naturalAspectBox, replacementBox } from './lib/layout';
import { applyDraft, panPicture, resetCrop, resizeWindow, startDraft, visibleCrop } from './lib/crop';

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

describe('cropping', () => {
  const image = (patch: Partial<ImageElement> = {}): ImageElement =>
    ({ id: 'i', type: 'image', x: 100, y: 50, w: 400, h: 300, rotation: 0, z: 1, src: 'a.png', naturalW: 800, naturalH: 600, createdBy: 'u', createdAt: 0, updatedAt: 0, ...patch }) as ImageElement;

  /** Where on the board a point of the PICTURE (fractions u, v of the file) is drawn. */
  const worldOf = (el: ImageElement, u: number, v: number) => {
    const f = startDraft(el).full;
    const lx = f.x + u * f.w - el.w / 2;
    const ly = f.y + v * f.h - el.h / 2;
    const r = (el.rotation * Math.PI) / 180;
    return { x: el.x + el.w / 2 + lx * Math.cos(r) - ly * Math.sin(r), y: el.y + el.h / 2 + lx * Math.sin(r) + ly * Math.cos(r) };
  };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  };

  it('cropping a rotated image leaves the kept part exactly where it was, and reset brings the rest back around it', () => {
    const el = image({ rotation: 30 });
    const before = worldOf(el, 0.6, 0.7);
    let d = startDraft(el);
    d = resizeWindow(d, d.window, 'nw', 120, 60, 10);
    d = resizeWindow(d, d.window, 'se', -40, -20, 10);
    const cropped = { ...el, ...applyDraft(el, d) } as ImageElement;
    expect(cropped.w).toBeCloseTo(240);
    expect(cropped.h).toBeCloseTo(220);
    near(worldOf(cropped, 0.6, 0.7), before);
    const reset = { ...cropped, ...resetCrop(cropped) } as ImageElement;
    expect(reset.crop).toBeNull();
    expect(reset.w).toBeCloseTo(400);
    expect(reset.h).toBeCloseTo(300);
    near(worldOf(reset, 0.6, 0.7), before);
  });

  it('the crop window never leaves the picture: not by its handles, not by panning the picture away', () => {
    const el = image();
    let d = startDraft(el);
    d = resizeWindow(d, d.window, 'se', -200, -150, 10); // 200 × 150 window at the top-left
    const grown = resizeWindow(d, d.window, 'nw', -500, -500, 10);
    expect(grown.window).toMatchObject({ x: 0, y: 0 });
    const panned = panPicture(d, d.full, -10_000, 10_000);
    // The picture moved as far as it can: its right/top edges now meet the window's.
    expect(panned.full.x + panned.full.w).toBeCloseTo(d.window.x + d.window.w);
    expect(panned.full.y).toBeCloseTo(d.window.y);
    const crop = applyDraft(el, panned).crop!;
    expect(crop.x + crop.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(crop.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('a stretched, uncropped image starts crop mode showing what it showed (centered cover), not a squashed picture', () => {
    // 800 × 600 picture in a 600 × 300 box shows a 2:1 band from the middle.
    const c = visibleCrop(image({ w: 600, h: 300 }));
    expect(c.w).toBeCloseTo(1);
    expect(c.h).toBeCloseTo(2 / 3);
    expect(c.y).toBeCloseTo(1 / 6);
  });
});
