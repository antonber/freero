// Getting images onto the board: upload (or fall back), measure, lay out, create once.
import type { Editor, NewElement, Point, Rect } from '@engine';
import { dataUrlToBlob, isImageFile, naturalSizeOf, readAsDataUrl } from './files';
import { fitGridLayout, fitSize } from './layout';
import { addPending } from './pending';

/** When the upload service fails, images up to this size are kept inline as data URLs. */
export const INLINE_FALLBACK_MAX_BYTES = 512 * 1024;
const MAX_FILES = 30;

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

/** Most of the visible board area, in world units: inserted batches are scaled to fit it. */
function visibleArea(editor: Editor) {
  const { width, height } = editor.getViewportSize();
  const { zoom } = editor.getCamera();
  return { w: (width * 0.8) / zoom, h: (height * 0.75) / zoom };
}

/**
 * Stores an image blob: server upload first; if that fails (offline, server down), small images
 * become data URLs in the board and large ones are refused. Returns null when refused.
 */
export async function storeImage(editor: Editor, blob: Blob): Promise<{ url: string } | { error: 'too-large' | 'unreadable' }> {
  try {
    const { url } = await editor.host.uploadImage(blob);
    if (url) return { url };
  } catch {
    // fall through to the inline fallback
  }
  if (blob.size > INLINE_FALLBACK_MAX_BYTES) return { error: 'too-large' };
  try {
    return { url: await readAsDataUrl(blob) };
  } catch {
    return { error: 'unreadable' };
  }
}

function reportFailures(editor: Editor, tooLarge: number, unreadable: number) {
  if (tooLarge)
    editor.host.notify(
      tooLarge === 1
        ? `Couldn't upload that image, and it's too large to keep offline (max ${kb(INLINE_FALLBACK_MAX_BYTES)}). Try again later.`
        : `Couldn't upload ${tooLarge} images, and they're too large to keep offline (max ${kb(INLINE_FALLBACK_MAX_BYTES)} each).`,
      'error',
    );
  if (unreadable) editor.host.notify(unreadable === 1 ? "That file isn't an image Freero can read." : `${unreadable} files aren't images Freero can read.`, 'error');
}

/**
 * Moves a laid-out batch, as a block, into the nearest free spot around the view. On a busy board
 * that spot can be partly off-screen, so the camera then glides to it (same zoom or further out):
 * the person always sees where the upload lands.
 */
function intoFreeSpot(editor: Editor, rects: Rect[]): Rect[] {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x0;
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y0;
  const spot = editor.findFreeSpot({ w, h });
  revealRect(editor, { x: spot.x, y: spot.y, w, h });
  return rects.map((r) => ({ ...r, x: r.x - x0 + spot.x, y: r.y - y0 + spot.y }));
}

function revealRect(editor: Editor, r: Rect) {
  const safe = editor.getSafeArea();
  const a = editor.worldToScreen({ x: r.x, y: r.y });
  const b = editor.worldToScreen({ x: r.x + r.w, y: r.y + r.h });
  if (a.x >= safe.x && a.y >= safe.y && b.x <= safe.x + safe.w && b.y <= safe.y + safe.h) return;
  editor.zoomToRect(r, { maxZoom: editor.getCamera().zoom, padding: 48 });
}

/**
 * Uploads image files and places them as one grid centered on `center` (a drop or paste
 * point), or — when `center` is null (the upload button) — in a free spot near the view, each
 * scaled to fit ~600px. While uploading, local placeholders shimmer where the images will land.
 * The elements are created together once everything settled: one undo step.
 */
export async function insertImageFiles(editor: Editor, files: File[], center: Point | null): Promise<string[]> {
  const images = files.filter(isImageFile).slice(0, MAX_FILES);
  if (!images.length || !editor.can('editor')) return [];
  const measured = await Promise.all(
    images.map(async (file) => {
      const local = URL.createObjectURL(file);
      try {
        return { file, size: await naturalSizeOf(local) };
      } finally {
        URL.revokeObjectURL(local);
      }
    }),
  );
  const readable = measured.filter((m): m is { file: File; size: { w: number; h: number } } => !!m.size);
  let unreadable = measured.length - readable.length;
  if (!readable.length) {
    reportFailures(editor, 0, unreadable);
    return [];
  }
  const laidOut = fitGridLayout(
    readable.map((m) => fitSize(m.size.w, m.size.h)),
    center ?? { x: 0, y: 0 },
    visibleArea(editor),
  );
  const rects = center ? laidOut : intoFreeSpot(editor, laidOut);
  const clear = addPending(rects);
  let stored;
  try {
    stored = await Promise.all(readable.map((m) => storeImage(editor, m.file)));
  } finally {
    clear();
  }
  let tooLarge = 0;
  const els: NewElement<'image'>[] = [];
  stored.forEach((s, i) => {
    if ('error' in s) {
      if (s.error === 'too-large') tooLarge++;
      else unreadable++;
      return;
    }
    const { w, h } = readable[i].size;
    els.push({ type: 'image', src: s.url, naturalW: w, naturalH: h, alt: altFromName(readable[i].file.name), ...rects[i] });
  });
  reportFailures(editor, tooLarge, unreadable);
  return els.length ? editor.createMany(els as NewElement[], { select: true }) : [];
}

/** "team-photo_2024.png" → "team photo 2024"; generic names ("image.png", "pasted.png") → "". */
export function altFromName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return /^(image|pasted|clipboard|screenshot|untitled|blob)?\s*\d*$/i.test(base) ? '' : base;
}

/**
 * Our own copy of a remote image, or null. The server fetches it (any public host, CORS or not);
 * without a server (offline sandbox), or when it can't reach the host, the browser copies it if
 * the host allows CORS. A data: URL "upload" (sandbox) is no copy worth storing in the board.
 */
async function ownCopyOf(editor: Editor, url: string): Promise<string | null> {
  try {
    const { url: own } = await editor.host.importImage(url);
    if (own) return own;
  } catch {
    // no server, or it couldn't fetch the image: try the browser
  }
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    const blob = res.ok ? await res.blob() : null;
    if (!blob?.type.startsWith('image/')) return null;
    const { url: uploaded } = await editor.host.uploadImage(blob);
    return uploaded && !uploaded.startsWith('data:') ? uploaded : null;
  } catch {
    return null;
  }
}

/**
 * Places the image behind a pasted or dropped URL. Data URLs go through the normal upload path.
 * Remote images are copied to our uploads (see ownCopyOf), so viewers and exports never depend on
 * the third party; only when that fails is the original URL linked (exports then try again and
 * say so if the image is left out). Resolves false when the URL isn't an image (so plain-text
 * importers can take it).
 */
export async function insertImageUrl(editor: Editor, url: string, at: Point): Promise<boolean> {
  if (url.startsWith('data:')) {
    const blob = dataUrlToBlob(url);
    if (!blob || !blob.type.startsWith('image/')) return false;
    const ext = blob.type.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png';
    await insertImageFiles(editor, [new File([blob], `pasted.${ext}`, { type: blob.type })], at);
    return true;
  }
  const size = await naturalSizeOf(url, 5000);
  if (!size) return false;
  const rect = fitGridLayout([fitSize(size.w, size.h)], at, visibleArea(editor))[0];
  const clear = addPending([rect]);
  let src = url;
  try {
    src = (await ownCopyOf(editor, url)) ?? url;
  } finally {
    clear();
  }
  editor.create<'image'>({ type: 'image', src, naturalW: size.w, naturalH: size.h, alt: '', ...rect }, { select: true });
  return true;
}
