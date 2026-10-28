// Getting PDFs onto the board, and laying their pages out as images.
import type { PdfElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { openBytes, openDocument, pageBlob, pageSize, rememberDocument } from './render';
import { ITEM_W, MAX_PLACED_PAGES, PLACED_PAGE_PX, itemHeight, pageGrid } from './layout';

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message && e.message !== 'Upload failed' ? e.message : fallback);

/**
 * Uploads a PDF and places a document item for it (centered on `at`, or in a free spot near the
 * view). The file is parsed first, so a broken file never reaches the server.
 */
export async function insertPdf(editor: Editor, file: File, at?: Point): Promise<string | null> {
  let doc;
  try {
    doc = await openBytes(new Uint8Array(await file.arrayBuffer()));
  } catch {
    editor.host.notify(`“${file.name}” isn't a PDF Freero can open.`, 'error');
    return null;
  }
  const first = await pageSize(doc, 1);
  let url: string;
  try {
    ({ url } = await editor.host.uploadFile(file));
  } catch (e) {
    editor.host.notify(message(e, `Couldn't upload “${file.name}”. Try again later.`), 'error');
    void doc.destroy();
    return null;
  }
  rememberDocument(url, doc);
  const w = ITEM_W;
  const h = itemHeight(w, first.w, first.h);
  const pos = at ? { x: at.x - w / 2, y: at.y - h / 2 } : editor.findFreeSpot({ w, h });
  const el: NewElement<'pdf'> = {
    type: 'pdf',
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    w,
    h,
    src: url,
    name: file.name.replace(/\.pdf$/i, ''),
    page: 1,
    pageCount: doc.numPages,
  };
  return editor.create(el, { select: true }) || null;
}

/** Opens the system file picker for PDFs (must run inside the click's user activation). */
export function pickPdf(editor: Editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void insertPdf(editor, file);
  };
  input.click();
}

/** Shows another page (everyone sees the same page: it is board content). */
export function turnPage(editor: Editor, id: string, delta: number) {
  const el = editor.getElement<PdfElement>(id);
  if (!el || !el.pageCount) return;
  const page = Math.max(1, Math.min(el.pageCount, el.page + delta));
  if (page !== el.page) editor.update<PdfElement>(id, { page });
}

/** "Place all pages": every page as an image, in a grid beside the document. One undo step. */
export async function placeAllPages(editor: Editor, id: string): Promise<void> {
  const el = editor.getElement<PdfElement>(id);
  if (!el) return;
  let doc;
  try {
    doc = await openDocument(el.src);
  } catch {
    editor.host.notify("Couldn't open this PDF.", 'error');
    return;
  }
  const n = Math.min(doc.numPages, MAX_PLACED_PAGES);
  if (doc.numPages > n) editor.host.notify(`Placing the first ${n} of ${doc.numPages} pages.`, 'info');
  else editor.host.notify(`Placing ${n} ${n === 1 ? 'page' : 'pages'}…`, 'info');
  const pages: Array<{ url: string; w: number; h: number }> = new Array(n);
  let next = 0;
  let failed: unknown = null;
  // A few uploads at a time: fast, without flooding the upload rate limit.
  const worker = async () => {
    while (next < n && !failed) {
      const i = next++;
      try {
        const { blob, w, h } = await pageBlob(doc, i + 1, PLACED_PAGE_PX);
        const { url } = await editor.host.uploadImage(blob);
        pages[i] = { url, w, h };
      } catch (e) {
        failed = e;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (failed) {
    editor.host.notify(message(failed, "Couldn't place the pages. Try again later."), 'error');
    return;
  }
  const cur = editor.getElement<PdfElement>(id) ?? el;
  const pageW = cur.w;
  const gap = Math.round(pageW * 0.06);
  const grid = pageGrid(pages, pageW, gap);
  const spot = editor.findFreeSpot({ w: grid.w, h: grid.h }, { near: { x: cur.x + cur.w + gap + grid.w / 2, y: cur.y + grid.h / 2 } });
  const ids = editor.createMany(
    pages.map((p, i) => ({
      type: 'image',
      x: Math.round(spot.x + grid.rects[i].x),
      y: Math.round(spot.y + grid.rects[i].y),
      w: Math.round(grid.rects[i].w),
      h: Math.round(grid.rects[i].h),
      src: p.url,
      naturalW: p.w,
      naturalH: p.h,
      alt: `${cur.name} — page ${i + 1}`,
    })) as NewElement[],
    { select: true },
  );
  if (ids.length) editor.zoomToFit(ids, { animate: true });
}
