// GIF search for the sticker panel (#139), through the server only: the operator's API key never
// reaches a browser, and neither does a request to the provider — previews are proxied and a
// placed GIF is copied into the placer's uploads (the board never hot-links the provider).
//
// The links a search hands out are signed (`mediaToken`): the media proxy and `place` fetch only
// URLs this server got from the provider, so neither is an open proxy.
import type { GifPlaceResponse, GifResult, GifSearchResponse } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError } from '../../platform/http';
import { mac, macMatches } from '../../platform/secrets';
import { requireBoardAccess } from '../boards/index';
import { fetchRemoteImage, importImageFromUrl, safeFetch, UnfurlError } from '../unfurl/index';
import { PROVIDER_NAMES, readPage, searchUrl, type GifRating } from './provider';

const SEARCH_TIMEOUT_MS = 8000;
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
/** Previews are small; a bigger one isn't a preview. */
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

const PURPOSE = 'gifs.media:';

/** A provider link signed by this server: "<url, base64url>.<HMAC>". */
export function mediaToken(url: string): string {
  return `${Buffer.from(url, 'utf8').toString('base64url')}.${mac(PURPOSE + url).toString('base64url')}`;
}

/** The URL inside a token this server signed, or null (tampered, made up, or not https). */
export function mediaUrl(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const url = Buffer.from(data, 'base64url').toString('utf8');
  if (!url.startsWith('https://') || !macMatches(PURPOSE + url, Buffer.from(sig, 'base64url'))) return null;
  return url;
}

function configured() {
  const gifs = getConfig().gifs;
  if (!gifs) throw new HttpError(404, 'GIF search isn’t available on this server', 'gifs_unavailable');
  return gifs;
}

/** The rating cap on this board for someone who may edit it; refuses when its workspace turned GIFs off. */
async function ratingFor(boardId: string, userId: string): Promise<{ rating: GifRating; workspaceId: string }> {
  const access = await requireBoardAccess(boardId, userId, 'editor');
  if (access.gifs === 'off') throw forbidden('GIF search is turned off in this workspace', 'gifs_off');
  return { rating: access.gifs, workspaceId: access.workspaceId };
}

export async function searchGifs(boardId: string, userId: string, q: unknown, pos: unknown, lang: string): Promise<GifSearchResponse> {
  const gifs = configured();
  const { rating } = await ratingFor(boardId, userId);
  const words = typeof q === 'string' ? q : '';
  const at = typeof pos === 'string' && pos ? pos : null;
  let body: unknown;
  try {
    const res = await safeFetch(searchUrl(gifs.provider, gifs, words, at, rating, lang), {
      maxBytes: MAX_ANSWER_BYTES,
      timeoutMs: SEARCH_TIMEOUT_MS,
      accept: 'application/json',
      followRedirects: false,
    });
    body = JSON.parse(res.body.toString('utf8'));
  } catch {
    throw new HttpError(502, 'The GIF service didn’t answer. Try again in a moment.', 'gifs_unavailable');
  }
  const page = readPage(gifs.provider, body, rating, at);
  return {
    provider: PROVIDER_NAMES[gifs.provider],
    next: page.next,
    results: page.gifs.map(
      (g): GifResult => ({
        id: g.id,
        title: g.title,
        preview: { url: `/api/gifs/media?m=${encodeURIComponent(mediaToken(g.preview.url))}`, w: g.preview.w, h: g.preview.h },
        media: mediaToken(g.full.url),
        w: g.full.w,
        h: g.full.h,
      }),
    ),
  };
}

/** A preview's bytes, for a link a search handed out. */
export async function gifPreview(token: unknown): Promise<{ type: string; body: Buffer }> {
  configured();
  const url = mediaUrl(token);
  if (!url) throw badRequest('Not a GIF link from a search');
  try {
    return await fetchRemoteImage(url, MAX_PREVIEW_BYTES);
  } catch (e) {
    if (e instanceof UnfurlError) throw new HttpError(502, 'That preview could not be loaded');
    throw e;
  }
}

/** Copies the chosen GIF into the caller's uploads (their quota), for a board they may edit. */
export async function placeGif(boardId: string, userId: string, token: unknown): Promise<GifPlaceResponse> {
  configured();
  const { workspaceId } = await ratingFor(boardId, userId);
  const url = mediaUrl(token);
  if (!url) throw badRequest('Not a GIF from a search');
  try {
    // The board's workspace's file (#159: sealed with its key when it has one).
    const img = await importImageFromUrl(url, userId, getConfig().maxUploadBytes, workspaceId);
    return { url: img.src, w: img.w, h: img.h };
  } catch (e) {
    if (e instanceof UnfurlError) throw new HttpError(502, 'That GIF could not be copied. Try another one.', 'gifs_copy_failed');
    throw e; // 413 over the upload quota, …
  }
}
