// pdf.js, lazy-loaded (its ~1 MB only downloads once a board shows or imports a PDF), plus two
// small LRU caches: opened documents by src, and rendered page rasters by (src, page, scale).
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

/** Loads pdf.js and points it at its worker (a same-origin asset, allowed by worker-src 'self'). */
export function loadPdfJs(): Promise<PdfJs> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  lib.catch(() => (lib = null));
  return lib;
}

class Lru<V> {
  private map = new Map<string, V>();
  constructor(
    private max: number,
    private onEvict?: (v: V) => void,
  ) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V) {
    this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.max) {
      const [k, old] = this.map.entries().next().value as [string, V];
      this.map.delete(k);
      this.onEvict?.(old);
    }
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

const docs = new Lru<Promise<PDFDocumentProxy>>(4, (p) => void p.then((d) => d.destroy()).catch(() => {}));
const rasters = new Lru<Promise<Raster>>(24);

export interface Raster {
  /** data: URL (PNG): exports inline it as-is, no blob: fetch needed. */
  url: string;
  w: number;
  h: number;
}

function dataUrlBytes(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bytesOf(src: string): Promise<Uint8Array> {
  if (src.startsWith('data:')) return dataUrlBytes(src);
  const res = await fetch(src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`PDF not available (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Parses PDF bytes. Fonts are drawn as paths (no eval); nothing is fetched from elsewhere. */
export async function openBytes(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
}

/** The document at `src`, opened once and shared by every item showing it. */
export function openDocument(src: string): Promise<PDFDocumentProxy> {
  let p = docs.get(src);
  if (!p) {
    p = bytesOf(src).then(openBytes);
    p.catch(() => docs.delete(src));
    docs.set(src, p);
  }
  return p;
}

/** Lets an upload reuse the document it already parsed instead of downloading it again. */
export function rememberDocument(src: string, doc: PDFDocumentProxy) {
  docs.set(src, Promise.resolve(doc));
}

/** Page size in PDF points (1/72 in) at scale 1. */
export async function pageSize(doc: PDFDocumentProxy, page: number): Promise<{ w: number; h: number }> {
  const p = await doc.getPage(page);
  const v = p.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

/** Longest raster side we ever draw (memory: a 4096² RGBA canvas is 64 MB). */
const MAX_PX = 4096;

async function draw(doc: PDFDocumentProxy, page: number, scale: number): Promise<HTMLCanvasElement> {
  const p = await doc.getPage(page);
  let viewport = p.getViewport({ scale });
  const big = Math.max(viewport.width, viewport.height);
  if (big > MAX_PX) viewport = p.getViewport({ scale: (scale * MAX_PX) / big });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  // White paper under transparent pages.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Page `page` of `src` rendered at `scale` (pixels per PDF point), cached. */
export function renderPage(src: string, page: number, scale: number): Promise<Raster> {
  const key = `${src}#${page}@${scale.toFixed(3)}`;
  let r = rasters.get(key);
  if (!r) {
    r = openDocument(src)
      .then((doc) => draw(doc, page, scale))
      .then((c) => ({ url: c.toDataURL('image/png'), w: c.width, h: c.height }));
    r.catch(() => rasters.delete(key));
    rasters.set(key, r);
  }
  return r;
}

/** A page as a JPEG blob about `widthPx` wide (for placing pages as board images). */
export async function pageBlob(doc: PDFDocumentProxy, page: number, widthPx: number): Promise<{ blob: Blob; w: number; h: number }> {
  const { w } = await pageSize(doc, page);
  const canvas = await draw(doc, page, widthPx / w);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not encode the page');
  return { blob, w: canvas.width, h: canvas.height };
}

/**
 * Raster scale for a page area shown `screenW` px wide: quantized to steps of √2 so zooming
 * re-renders a few times, not every frame, and the cache hits when you come back.
 */
export function rasterScale(pageW: number, screenW: number, dpr: number): number {
  const want = Math.max(0.25, (screenW * dpr) / Math.max(1, pageW));
  const step = Math.SQRT2;
  return Math.pow(step, Math.ceil(Math.log(want) / Math.log(step)));
}
