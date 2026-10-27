// Link previews: fetch a page (safely, see fetch.ts), read its metadata (meta.ts) and inline its
// preview image as a size-capped data: URL, so the browser never contacts the third party.
import type { UnfurlResponse } from '@freero/shared';
import { safeFetch, UnfurlError } from './fetch';
import { parseMeta } from './meta';

// Script-heavy pages (video sites) put their metadata deep in a long <head>.
const PAGE_BYTES = 1536 * 1024;
const IMAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 6000;
const IMAGE_TIMEOUT_MS = 6000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const mime = (contentType: string) => contentType.split(';')[0].trim();

async function imageDataUrl(url: string): Promise<string | null> {
  try {
    const img = await safeFetch(url, { maxBytes: IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' });
    const type = mime(img.contentType);
    if (!IMAGE_TYPES.has(type) || !img.body.length) return null;
    return `data:${type};base64,${img.body.toString('base64')}`;
  } catch {
    return null; // a preview without its picture is still a preview
  }
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function unfurl(raw: string): Promise<UnfurlResponse> {
  const page = await safeFetch(raw, {
    maxBytes: PAGE_BYTES,
    timeoutMs: PAGE_TIMEOUT_MS,
    accept: 'text/html,application/xhtml+xml;q=0.9,image/*;q=0.5',
    allowTruncate: true,
    until: '</head>',
  });
  const type = mime(page.contentType);
  // A direct link to a picture: the picture is the preview.
  if (IMAGE_TYPES.has(type)) {
    if (page.body.length > IMAGE_BYTES || (page.truncated && page.body.length >= PAGE_BYTES)) throw new UnfurlError('Too large to preview.');
    return { url: page.url, title: fileName(page.url), description: null, siteName: new URL(page.url).hostname, image: `data:${type};base64,${page.body.toString('base64')}` };
  }
  if (type !== 'text/html' && type !== 'application/xhtml+xml') throw new UnfurlError('Only web pages can be previewed.');
  const charset = /charset=([\w-]+)/i.exec(page.contentType)?.[1]?.toLowerCase();
  const html = page.body.toString(charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252' ? 'latin1' : 'utf8');
  const meta = parseMeta(html, page.url);
  return {
    url: page.url,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName ?? new URL(page.url).hostname.replace(/^www\./, ''),
    image: meta.image ? await imageDataUrl(meta.image) : null,
  };
}

export { UnfurlError };
