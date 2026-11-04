// The two GIF providers an operator may configure (#139): how to ask each for results no more
// mature than a workspace allows, and how to read what they answer. Pure: no network here.

export type GifProvider = 'giphy' | 'tenor';
/** The highest rating a workspace allows ('off' never reaches a provider). */
export type GifRating = 'g' | 'pg-13';

export const PAGE_SIZE = 24;

/** One result as the server keeps it before signing its links for the browser. */
export interface ProviderGif {
  id: string;
  title: string;
  preview: { url: string; w: number; h: number };
  /** The GIF to store when someone places it (a size the provider meant for sharing, not the original). */
  full: { url: string; w: number; h: number };
}

export interface ProviderPage {
  gifs: ProviderGif[];
  next: string | null;
}

export const PROVIDER_NAMES: Record<GifProvider, string> = { giphy: 'GIPHY', tenor: 'Tenor' };

/**
 * The provider URL for a search (or, with no words, what's trending). The rating cap is always in
 * the request: GIPHY's `rating` returns that rating and below; Tenor's `contentfilter` 'high' is G
 * only and 'low' admits up to PG-13.
 */
export function searchUrl(provider: GifProvider, keys: { apiKey: string; clientKey: string }, q: string, pos: string | null, rating: GifRating, lang: string): string {
  // `lang`: the person's interface language (BCP 47, e.g. 'pt-BR'), so searches match their words.
  const words = q.trim().slice(0, 100);
  if (provider === 'giphy') {
    const u = new URL(`https://api.giphy.com/v1/gifs/${words ? 'search' : 'trending'}`);
    u.searchParams.set('api_key', keys.apiKey);
    if (words) u.searchParams.set('q', words);
    u.searchParams.set('limit', String(PAGE_SIZE));
    const offset = Number(pos);
    if (pos && Number.isInteger(offset) && offset > 0 && offset < 5000) u.searchParams.set('offset', String(offset));
    u.searchParams.set('rating', rating);
    if (words) u.searchParams.set('lang', lang === 'zh-CN' ? 'zh-CN' : lang.split('-')[0]);
    return u.toString();
  }
  const u = new URL(`https://tenor.googleapis.com/v2/${words ? 'search' : 'featured'}`);
  if (words) u.searchParams.set('q', words);
  u.searchParams.set('key', keys.apiKey);
  u.searchParams.set('client_key', keys.clientKey);
  u.searchParams.set('limit', String(PAGE_SIZE));
  if (pos && pos.length < 200) u.searchParams.set('pos', pos);
  u.searchParams.set('contentfilter', rating === 'g' ? 'high' : 'low');
  u.searchParams.set('media_filter', 'tinygif,gif,mediumgif');
  u.searchParams.set('locale', lang.replace('-', '_'));
  return u.toString();
}

const RATING_RANK: Record<string, number> = { y: 0, g: 0, pg: 1, 'pg-13': 2, r: 3 };

type Rendition = { url?: unknown; width?: unknown; height?: unknown; dims?: unknown };

function rendition(r: Rendition | undefined): { url: string; w: number; h: number } | null {
  if (!r || typeof r.url !== 'string' || !r.url.startsWith('https://')) return null;
  const [dw, dh] = Array.isArray(r.dims) ? r.dims : [];
  const w = Number(r.width ?? dw);
  const h = Number(r.height ?? dh);
  return { url: r.url, w: Number.isFinite(w) && w > 0 ? Math.round(w) : 200, h: Number.isFinite(h) && h > 0 ? Math.round(h) : 200 };
}

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

/**
 * Reads a provider's answer. Results rated above `rating` are dropped even though the request
 * already asked for no more (a provider's filter is not the last word), and so is anything
 * without a usable https rendition.
 */
export function readPage(provider: GifProvider, body: unknown, rating: GifRating, pos: string | null): ProviderPage {
  const b = (body ?? {}) as Record<string, unknown>;
  if (provider === 'giphy') {
    const data = Array.isArray(b.data) ? (b.data as Array<Record<string, unknown>>) : [];
    const gifs: ProviderGif[] = [];
    for (const d of data) {
      const rank = RATING_RANK[String(d.rating ?? '').toLowerCase()];
      if (rank === undefined || rank > RATING_RANK[rating]) continue;
      const images = (d.images ?? {}) as Record<string, Rendition>;
      const preview = rendition(images.fixed_width_small) ?? rendition(images.fixed_width);
      const full = rendition(images.downsized_medium) ?? rendition(images.downsized) ?? rendition(images.original);
      if (typeof d.id !== 'string' || !preview || !full) continue;
      gifs.push({ id: d.id, title: text(d.title), preview, full });
    }
    const p = (b.pagination ?? {}) as Record<string, unknown>;
    const offset = (Number(pos) || 0) + data.length;
    const total = Number(p.total_count);
    const next = data.length > 0 && (!Number.isFinite(total) || offset < total) && offset < 4999 ? String(offset) : null;
    return { gifs, next };
  }
  const results = Array.isArray(b.results) ? (b.results as Array<Record<string, unknown>>) : [];
  const gifs: ProviderGif[] = [];
  for (const r of results) {
    const formats = (r.media_formats ?? {}) as Record<string, Rendition>;
    const preview = rendition(formats.tinygif) ?? rendition(formats.gif);
    const full = rendition(formats.mediumgif) ?? rendition(formats.gif);
    if (typeof r.id !== 'string' || !preview || !full) continue;
    gifs.push({ id: r.id, title: text(r.content_description ?? r.title), preview, full });
  }
  const next = typeof b.next === 'string' && b.next && b.next !== '0' && results.length > 0 ? b.next : null;
  return { gifs, next };
}
