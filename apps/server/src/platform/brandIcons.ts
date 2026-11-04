// The icons the app packages for other platforms carry (the Teams app and Copilot agent, the
// Atlassian, Zoom and Google Meet apps, the Power Automate connector), drawn from Freero's own mark —
// apps/web/public/freero.svg: the white "F" (three rectangles) and the mint dot on the brand purple,
// in a 64-unit square. Rasterised here (4×4 supersampling, no dependency) so every instance builds
// its packages without image tools:
// - colorIcon(size), 192×192 by default: the mark on a full-bleed purple square (hosts round the
//   corners themselves; the mark fills under 70% of it, as Microsoft's connector icons require);
// - outline.png, 32×32: the mark alone in white on transparent, as Teams requires of outline icons.
import { crc32, deflateSync } from 'node:zlib';

const PURPLE = [0x5b, 0x3f, 0xf0] as const;
const MINT = [0x2e, 0xe6, 0xb8] as const;
const WHITE = [0xff, 0xff, 0xff] as const;

/** The "F": `M21 46V18h22v6H28v6h12v6H28v10z` as the rectangles it is made of. */
const F_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [21, 18, 28, 46],
  [21, 18, 43, 24],
  [21, 30, 40, 36],
];
const DOT = { cx: 45, cy: 43, r: 4 };

const inF = (x: number, y: number) => F_RECTS.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
const inDot = (x: number, y: number) => (x - DOT.cx) ** 2 + (y - DOT.cy) ** 2 <= DOT.r ** 2;

type Rgb = readonly [number, number, number];

/** Draws `size`×`size` RGBA pixels: `paint(x, y)` (in pixels) gives the colour there, or null for transparent. */
function raster(size: number, paint: (x: number, y: number) => Rgb | null): Buffer {
  const S = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = paint(px + (sx + 0.5) / S, py + (sy + 0.5) / S);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      const o = (py * size + px) * 4;
      if (a) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (S * S)) * 255);
    }
  return out;
}

/** A PNG (8-bit RGBA, no interlace) of `size`×`size` pixels. */
function png(size: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** The brand purple of the icons' background (hosts that ask for an icon colour get this one). */
export const BRAND_COLOR = '#5B3FF0';

/** color.png: `size`×`size` (192 by default), the mark on a full-bleed brand square (freero.svg's framing, without its rounded corners). */
export function colorIcon(size = 192): Buffer {
  const u = (p: number) => (p / size) * 64;
  return png(size, raster(size, (px, py) => (inDot(u(px), u(py)) ? MINT : inF(u(px), u(py)) ? WHITE : PURPLE)));
}

/** outline.png: 32×32, the mark in white on transparent, filling the square with a small margin. */
export function outlineIcon(): Buffer {
  const size = 32;
  // The mark spans x 21–49 and y 18–47: centred, 28 px tall.
  const k = 29 / 28;
  const ux = (p: number) => 35 + (p - size / 2) * k;
  const uy = (p: number) => 32.5 + (p - size / 2) * k;
  return png(size, raster(size, (px, py) => (inF(ux(px), uy(py)) || inDot(ux(px), uy(py)) ? WHITE : null)));
}
