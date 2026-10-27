// Frames → PDF: one page per frame, in frame `index` order (the presentation order).
import { jsPDF } from 'jspdf';
import type { Rect } from '@engine';

export interface PdfFrame extends Rect {
  id: string;
  title: string;
  index: number;
}

export type PageSize = 'fit' | 'a4';

/** jsPDF can't make pages longer than this (pt). */
const MAX_PAGE_PT = 14400;
const PX_TO_PT = 0.75;
const A4_LANDSCAPE = { w: 841.89, h: 595.28 };
const A4_MARGIN = 28;

export interface PdfOptions {
  pageSize: PageSize;
  /** Renders one frame to a PNG/JPEG data URL. */
  render(frame: PdfFrame): Promise<string>;
  onProgress?(done: number, total: number): void;
  /** Checked between pages; stops early when aborted. */
  signal?: AbortSignal;
}

export function framesInPageOrder<T extends { index: number }>(frames: T[]): T[] {
  return frames
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.index - b.f.index || a.i - b.i)
    .map(({ f }) => f);
}

function fitPage(f: Rect): { w: number; h: number } {
  let w = f.w * PX_TO_PT;
  let h = f.h * PX_TO_PT;
  const k = Math.min(1, MAX_PAGE_PT / Math.max(w, h));
  w = Math.max(36, w * k);
  h = Math.max(36, h * k);
  return { w, h };
}

const orientation = (p: { w: number; h: number }) => (p.w >= p.h ? 'landscape' : 'portrait');

/** Builds the PDF (not saved). Returns null when aborted or there are no frames. */
export async function buildFramesPdf(frames: PdfFrame[], opts: PdfOptions): Promise<jsPDF | null> {
  const ordered = framesInPageOrder(frames);
  if (!ordered.length) return null;
  let pdf: jsPDF | null = null;
  opts.onProgress?.(0, ordered.length);
  for (let i = 0; i < ordered.length; i++) {
    if (opts.signal?.aborted) return null;
    const frame = ordered[i];
    const page = opts.pageSize === 'a4' ? A4_LANDSCAPE : fitPage(frame);
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [page.w, page.h], orientation: orientation(page), compress: true });
    else pdf.addPage([page.w, page.h], orientation(page));

    const dataUrl = await opts.render(frame);
    if (opts.signal?.aborted) return null;
    const kind = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    if (opts.pageSize === 'a4') {
      const k = Math.min((page.w - A4_MARGIN * 2) / frame.w, (page.h - A4_MARGIN * 2) / frame.h);
      const w = frame.w * k;
      const h = frame.h * k;
      pdf.addImage(dataUrl, kind, (page.w - w) / 2, (page.h - h) / 2, w, h, undefined, 'FAST');
    } else {
      pdf.addImage(dataUrl, kind, 0, 0, page.w, page.h, undefined, 'FAST');
    }
    opts.onProgress?.(i + 1, ordered.length);
  }
  if (pdf) pdf.setProperties({ title: ordered.map((f) => f.title).join(', '), creator: 'Freero' });
  return pdf;
}
