// Items the public API makes from a URL (#170): an image copied into the caller's uploads (never
// hot-linked) with its pixel size, and a link card's preview — both through the SSRF-safe fetch
// (fetch.ts), so a URL that resolves to a private, loopback or link-local address is refused.
import { saveUpload } from '../uploads/index';
import { fetchRemoteImage } from './image';
import { unfurl, UnfurlError } from './service';

/** Pixel size from an image's header (PNG, GIF, JPEG, WebP, SVG); null when it can't be read. */
export function imageSize(body: Buffer, type: string): { w: number; h: number } | null {
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w < 100_000 && h < 100_000 ? { w, h } : null);
  if (type === 'image/png' && body.length >= 24) return ok(body.readUInt32BE(16), body.readUInt32BE(20));
  if (type === 'image/gif' && body.length >= 10) return ok(body.readUInt16LE(6), body.readUInt16LE(8));
  if (type === 'image/jpeg') {
    for (let i = 2; i + 9 < body.length; ) {
      if (body[i] !== 0xff) return null;
      const marker = body[i + 1];
      const len = body.readUInt16BE(i + 2);
      // Start-of-frame markers (not DHT 0xc4, JPG 0xc8, DAC 0xcc) carry height then width.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(body.readUInt16BE(i + 7), body.readUInt16BE(i + 5));
      i += 2 + len;
    }
    return null;
  }
  if (type === 'image/webp' && body.length >= 30) {
    const chunk = body.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return ok(body.readUInt16LE(26) & 0x3fff, body.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const b = body.readUInt32LE(21);
      return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return ok(1 + body.readUIntLE(24, 3), 1 + body.readUIntLE(27, 3));
    return null;
  }
  if (type === 'image/svg+xml') {
    const head = body.toString('utf8', 0, Math.min(body.length, 4096));
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
    const attr = (n: string) => Number.parseFloat(new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag)?.[1] ?? '');
    const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    const w = attr('width') || Number(box?.[1]);
    const h = attr('height') || Number(box?.[2]);
    return Number.isFinite(w) && Number.isFinite(h) ? ok(Math.round(w), Math.round(h)) : null;
  }
  return null;
}

/**
 * Fetches the image at `url` (an image by its bytes, ≤ the upload limit and 10 MB), stores it as
 * `ownerId`'s upload (their quota) and answers its `/uploads/…` URL and pixel size (a square when
 * the header doesn't say). Throws UnfurlError when it is unreachable, blocked or no image.
 * `workspaceId`: the workspace of the board it goes on (#159: sealed with its key when it has one).
 */
export async function importImageFromUrl(url: string, ownerId: string, maxBytes: number, workspaceId: string | null = null): Promise<{ src: string; w: number; h: number }> {
  const img = await fetchRemoteImage(url, maxBytes);
  const size = imageSize(img.body, img.type) ?? { w: 800, h: 800 };
  return { src: await saveUpload(img.body, img.type, ownerId, { workspaceId }), ...size };
}

/** A link card's preview, as the web app fills it: the picture stored with `ownerId`'s uploads. 'failed' when the page can't be read. */
export async function embedPreview(
  url: string,
  ownerId: string,
): Promise<{ title: string | null; description: string | null; siteName: string | null; image: string | null; status: 'ready' | 'failed' }> {
  try {
    const p = await unfurl(url);
    let image: string | null = null;
    const m = p.image ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(p.image) : null;
    if (m) image = await saveUpload(Buffer.from(m[2], 'base64'), m[1], ownerId).catch(() => null);
    return { title: p.title, description: p.description, siteName: p.siteName, image, status: 'ready' };
  } catch (e) {
    if (e instanceof UnfurlError && e.failure === 'blocked') throw e;
    return { title: null, description: null, siteName: null, image: null, status: 'failed' };
  }
}
