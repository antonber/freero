// Open Graph / Twitter card images (1200×630 PNG), one per page, drawn at build time from an SVG
// in Freero's own design (ink background, the canvas dot grid, sticky notes and two labelled
// cursors: a person and the agent working for them) and rendered with resvg (WASM, no native code).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { LOGO_MARK_PATHS } from './brand';
import { woffToSfnt } from './woff';

const require = createRequire(import.meta.url);
const W = 1200;
const H = 630;

let fonts: Uint8Array[] | null = null;
async function ready(): Promise<Uint8Array[]> {
  if (fonts) return fonts;
  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  fonts = [400, 600, 700].map((w) => new Uint8Array(woffToSfnt(fs.readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`)))));
  return fonts;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const render = (svg: string, fontBuffers: Uint8Array[]) => new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Inter' } });

function textWidth(text: string, size: number, weight: number, fontBuffers: Uint8Array[]): number {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size * 1.5}" font-family="Inter" font-weight="${weight}" font-size="${size}">${xml(text)}</text></svg>`;
  return render(svg, fontBuffers).getBBox()?.width ?? text.length * size * 0.6;
}

/** Greedy word wrap into at most `maxLines` lines no wider than `width`; null if it doesn't fit. */
function wrap(text: string, size: number, width: number, maxLines: number, fontBuffers: Uint8Array[]): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, 700, fontBuffers) <= width) line = next;
    else {
      if (!line) return null;
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines && lines.every((l) => textWidth(l, size, 700, fontBuffers) <= width) ? lines : null;
}

function sticky(x: number, y: number, rot: number, fill: string, lines: string[]): string {
  const text = lines.map((l, i) => `<text x="22" y="${48 + i * 30}" font-family="Inter" font-weight="600" font-size="22" fill="#17162b">${xml(l)}</text>`).join('');
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="4" y="8" width="190" height="170" rx="6" fill="#000" opacity="0.25"/><rect width="190" height="170" rx="6" fill="${fill}"/>${text}</g>`;
}

function cursor(x: number, y: number, color: string, label: string, fontBuffers: Uint8Array[]): string {
  const w = textWidth(label, 18, 600, fontBuffers) + 24;
  return `<g transform="translate(${x} ${y})"><path d="M0 0 L0 26 L7 20 L12 31 L17 29 L12 18 L21 18 Z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><rect x="16" y="30" width="${w}" height="30" rx="15" fill="${color}"/><text x="${16 + 12}" y="51" font-family="Inter" font-weight="600" font-size="18" fill="#fff">${xml(label)}</text></g>`;
}

/** The PNG for a page: `kicker` (small, mint) above `title` (large, white). */
export async function ogImage(kicker: string, title: string): Promise<Buffer> {
  const fontBuffers = await ready();
  const textWidthMax = 660;
  let size = 68;
  let lines = wrap(title, size, textWidthMax, 3, fontBuffers);
  while (!lines && size > 40) {
    size -= 4;
    lines = wrap(title, size, textWidthMax, 4, fontBuffers);
  }
  if (!lines) throw new Error(`OG title too long to fit: "${title}"`);
  const lineH = Math.round(size * 1.14);
  const kickerY = lines.length > 3 ? 210 : 236;
  const titleTop = kickerY + Math.round(size * 1.1) + 14;
  const titleSvg = lines.map((l, i) => `<text x="80" y="${titleTop + i * lineH}" font-family="Inter" font-weight="700" font-size="${size}" fill="#ffffff">${xml(l)}</text>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#2c2b49"/></pattern>
  <radialGradient id="glow" cx="0.85" cy="0.2" r="0.7"><stop offset="0" stop-color="#5b3ff0" stop-opacity="0.55"/><stop offset="1" stop-color="#5b3ff0" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="#17162b"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<g transform="translate(80 64) scale(0.875)">${LOGO_MARK_PATHS}</g>
<text x="146" y="104" font-family="Inter" font-weight="700" font-size="40" fill="#ffffff">freero</text>
<text x="80" y="${kickerY}" font-family="Inter" font-weight="600" font-size="28" fill="#2ee6b8">${xml(kicker)}</text>
${titleSvg}
${sticky(790, 96, -4, '#ffe58a', ['Interview', 'themes'])}
${sticky(975, 250, 5, '#b8f5e2', ['Ship the', 'pilot first'])}
${sticky(770, 372, -3, '#d9d0ff', ['Open', 'questions'])}
${cursor(1005, 168, '#d6336c', 'Maria', fontBuffers)}
${cursor(880, 500, '#5b3ff0', 'Agent for Maria', fontBuffers)}
<rect x="0" y="${H - 10}" width="${W}" height="10" fill="#5b3ff0"/>
</svg>`;
  return Buffer.from(render(svg, fontBuffers).render().asPng());
}

/** The logo mark as a square PNG (Organization logo in JSON-LD; apple-touch-icon). */
export async function logoPng(size: number): Promise<Buffer> {
  const fontBuffers = await ready();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${LOGO_MARK_PATHS}</svg>`;
  return Buffer.from(render(svg, fontBuffers).render().asPng());
}
