// Getting images onto the board: upload (or fall back), measure, lay out, create once.
import type { Editor, NewElement, Point } from '@engine';
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
 * Uploads image files and places them as one grid centered on `center`, each scaled to fit
 * ~600px. While uploading, local placeholders shimmer where the images will land. The elements
 * are created together once everything settled: one undo step.
 */
export async function insertImageFiles(editor: Editor, files: File[], center: Point): Promise<string[]> {
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
  const rects = fitGridLayout(
    readable.map((m) => fitSize(m.size.w, m.size.h)),
    center,
    visibleArea(editor),
  );
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
 * Places the image behind a pasted URL. Data URLs go through the normal upload path. Remote
 * URLs are copied to our server when the remote allows it (CORS), else linked directly.
 * Resolves false when the URL isn't an image (so plain-text importers can take it).
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
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    const blob = res.ok ? await res.blob() : null;
    if (blob && blob.type.startsWith('image/')) {
      const { url: uploaded } = await editor.host.uploadImage(blob);
      if (uploaded && !uploaded.startsWith('data:')) src = uploaded;
    }
  } catch {
    // Cross-origin without CORS, or upload failed: keep linking the original URL.
  } finally {
    clear();
  }
  editor.create<'image'>({ type: 'image', src, naturalW: size.w, naturalH: size.h, alt: '', ...rect }, { select: true });
  return true;
}
