// Third-party images in offscreen exports.
//
// html-to-image reads every <img> by fetching it from the page. A host without CORS headers
// refuses that read, and the image silently drops out of the picture (and logs console errors).
// So before rasterizing, every cross-origin <img> is inlined as a data URL: read directly when the
// host allows CORS, else through the server (`Host.fetchImage`). What still can't be read is
// blanked and counted, so the caller can say the export is incomplete.
import type { Host } from '../api';

// 1×1 transparent GIF: what a blanked image shows (html-to-image never fetches data: URLs).
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Failures are retried after this long (thumbnails re-render every minute). */
const RETRY_FAILED_MS = 2 * 60_000;
const PARALLEL = 4;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** True for URLs html-to-image would have to fetch from another origin. */
export function needsInlining(src: string, pageOrigin: string): boolean {
  if (!/^https?:/i.test(src)) return false; // data:, blob:, empty
  try {
    return new URL(src).origin !== pageOrigin;
  } catch {
    return false;
  }
}

// The server first: it reads any public host, and a refused cross-origin read would log a CORS
// error in the console. The browser's own (CORS) read covers no server (offline sandbox) and hosts
// only this browser can reach.
async function readImage(src: string, host: Host): Promise<string> {
  let blob: Blob | null = await host.fetchImage(src).catch(() => null);
  if (!blob?.type.startsWith('image/')) {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    blob = res.ok ? await res.blob() : null;
  }
  if (!blob?.type.startsWith('image/')) throw new Error('not an image');
  return readAsDataUrl(blob);
}

export function createRemoteImageInliner(getHost: () => Host, pageOrigin = location.origin) {
  const cache = new Map<string, { at: number; data: Promise<string | null> }>();

  const dataUrlOf = (src: string): Promise<string | null> => {
    const hit = cache.get(src);
    if (hit) {
      if (Date.now() - hit.at < RETRY_FAILED_MS) return hit.data;
      // Older: reuse a success, retry a failure.
      return hit.data.then((d) => d ?? fresh(src));
    }
    return fresh(src);
  };
  const fresh = (src: string) => {
    const data = readImage(src, getHost()).catch(() => null);
    cache.set(src, { at: Date.now(), data });
    return data;
  };

  /** Inlines the node's cross-origin images in place; `missing` = how many could not be read. */
  return async function inlineRemoteImages(node: HTMLElement): Promise<{ found: number; missing: number }> {
    const imgs = Array.from(node.querySelectorAll('img')).filter((img) => needsInlining(img.src, pageOrigin));
    let missing = 0;
    let next = 0;
    const worker = async () => {
      while (next < imgs.length) {
        const img = imgs[next++];
        const data = await dataUrlOf(img.src);
        if (!data) missing++;
        img.src = data ?? BLANK;
        await img.decode?.().catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, imgs.length) }, worker));
    return { found: imgs.length, missing };
  };
}
