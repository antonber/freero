// SVG → PNG and PDF on the server (#33), without a browser: resvg (MPL-2.0) compiled to WASM — no
// native binary, no system fonts — with the self-hosted Inter faces (OFL-1.1, @fontsource/inter) as
// its only fonts, and a PDF written here around the picture (one page, the image's own size).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync, inflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);
// Latin, Latin Extended, Cyrillic, Greek and Vietnamese, regular and bold.
const SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'vietnamese'];
const WEIGHTS = [400, 600, 700];

/** WOFF 1.0 → sfnt (TrueType / OpenType), which resvg reads: each table is zlib-compressed in WOFF. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF 1.0 file');
  const numTables = woff.readUInt16BE(12);
  const tables: Array<{ tag: number; checksum: number; data: Buffer }> = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({ tag: woff.readUInt32BE(at), checksum: woff.readUInt32BE(at + 16), data: compLength < origLength ? inflateSync(raw) : Buffer.from(raw) });
  }
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    log++;
  }
  const header = Buffer.alloc(12 + 16 * numTables);
  header.writeUInt32BE(woff.readUInt32BE(4), 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(log, 8);
  header.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let offset = header.length;
  const bodies: Buffer[] = [];
  tables.forEach((t, i) => {
    header.writeUInt32BE(t.tag, 12 + i * 16);
    header.writeUInt32BE(t.checksum, 12 + i * 16 + 4);
    header.writeUInt32BE(offset, 12 + i * 16 + 8);
    header.writeUInt32BE(t.data.length, 12 + i * 16 + 12);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

let ready: Promise<Uint8Array[]> | null = null;
/** Loads the WASM module and the fonts once per process (on first use, not at startup). */
function fonts(): Promise<Uint8Array[]> {
  ready ??= (async () => {
    await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const out: Uint8Array[] = [];
    for (const s of SUBSETS)
      for (const w of WEIGHTS) {
        let file: string;
        try {
          file = require.resolve(`@fontsource/inter/files/inter-${s}-${w}-normal.woff`);
        } catch {
          continue;
        }
        out.push(new Uint8Array(woffToSfnt(fs.readFileSync(file))));
      }
    return out;
  })();
  ready.catch(() => (ready = null));
  return ready;
}

/** The SVG rasterised at `scale` (1 = one pixel per board unit): RGBA pixels and the PNG. */
export async function rasterize(svg: string, scale: number): Promise<{ png: Buffer; pixels: Uint8Array; width: number; height: number }> {
  const fontBuffers = await fonts();
  const r = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }, fitTo: { mode: 'zoom', value: scale }, background: '#ffffff' });
  try {
    const img = r.render();
    try {
      return { png: Buffer.from(img.asPng()), pixels: img.pixels, width: img.width, height: img.height };
    } finally {
      img.free();
    }
  } finally {
    r.free();
  }
}

/**
 * A one-page PDF holding the picture at its size (72 dpi points = pixels / scale, so a page is the
 * board's own size): the RGB image and its alpha as a soft mask, both deflated.
 */
export function pdfOf(pixels: Uint8Array, width: number, height: number, pageW: number, pageH: number, title: string): Buffer {
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  for (let i = 0, j = 0, k = 0; i < pixels.length; i += 4, j += 3, k++) {
    rgb[j] = pixels[i];
    rgb[j + 1] = pixels[i + 1];
    rgb[j + 2] = pixels[i + 2];
    alpha[k] = pixels[i + 3];
  }
  const img = deflateSync(rgb);
  const mask = deflateSync(alpha);
  const w = Math.round(pageW * 100) / 100;
  const h = Math.round(pageH * 100) / 100;
  const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  // PDF strings: only printable ASCII, the delimiters escaped.
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1').slice(0, 200);
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 6 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 5 0 R /Length ${img.length} >>\nstream\n`), img, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>\nstream\n`), mask, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Title (${safeTitle}) /Producer (Freero) >>`),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(at);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(parts);
}
