// Remote images placed on a board by URL. Many hosts send no CORS headers, so the browser can show
// such an image but never read its pixels (exports leave it out). The server fetches it instead —
// through the same SSRF-safe fetch as link previews (fetch.ts) — checks the bytes really are an
// image, and either stores it with the board's uploads (import) or hands the bytes back (export).
import { contentMatches, saveUpload } from '../uploads/index';
import { safeFetch, UnfurlError, type FetchOptions } from './fetch';

const TIMEOUT_MS = 10_000;
/** Remote images are capped below the upload limit: they cost us an outbound fetch. */
const MAX_REMOTE_BYTES = 10 * 1024 * 1024;
const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface RemoteImage {
  type: string;
  body: Buffer;
}

/**
 * The image type the bytes really are. Raster types are recognised by their magic bytes whatever
 * the server declared (hosts often say application/octet-stream); SVG only when declared as SVG.
 */
function imageType(declared: string, body: Buffer): string | null {
  const raster = RASTER_TYPES.find((t) => contentMatches(body, t));
  if (raster) return raster;
  return declared === 'image/svg+xml' && contentMatches(body, declared) ? declared : null;
}

/** Fetches a remote image safely. Throws UnfurlError when it is unreachable, too big or not an image. */
export async function fetchRemoteImage(
  url: string,
  maxBytes: number,
  testNetwork?: FetchOptions['testNetwork'],
): Promise<RemoteImage> {
  const res = await safeFetch(url, {
    maxBytes: Math.min(maxBytes, MAX_REMOTE_BYTES),
    timeoutMs: TIMEOUT_MS,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8',
    testNetwork,
  });
  const type = imageType(res.contentType.split(';')[0].trim(), res.body);
  if (!type) throw new UnfurlError('That link is not an image Freero can show (PNG, JPEG, GIF, WebP or SVG).');
  return { type, body: res.body };
}

/** Copies a remote image into the user's uploads; returns its "/uploads/<key>" URL. */
export async function importRemoteImage(
  url: string,
  ownerId: string,
  maxBytes: number,
  testNetwork?: FetchOptions['testNetwork'],
): Promise<string> {
  const img = await fetchRemoteImage(url, maxBytes, testNetwork);
  return saveUpload(img.body, img.type, ownerId);
}
