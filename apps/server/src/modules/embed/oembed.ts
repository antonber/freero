// oEmbed for boards (#2, https://oembed.com): GET /api/oembed?url=<board or embed URL> answers a
// `rich` response whose html is the iframe of /embed/b/:id, and board pages of PUBLIC boards carry
// <link rel="alternate" type="application/json+oembed"> (routes.ts) so unfurlers (Notion through
// Iframely, Embedly, WordPress …) find it without being configured.
//
// Only boards whose embedding is on answer. A board a visitor may view (public) answers with its
// title; any other embeddable board with a generic title, so pasting a team board's link into a
// wiki still embeds it (people then sign in inside the frame) without the endpoint telling anyone
// what the board is called.
import { BOARD_EMBED_SIZE, boardEmbedCode, boardEmbedUrl, type OEmbedResponse } from '@freero/shared';

const MIN = { width: 200, height: 150 };
const MAX = 4000;
const GENERIC_TITLE = 'Freero board';

/**
 * The board (and frame to start at) an oEmbed `url` names, when it is a board or embed URL of THIS
 * deployment (`origin`): /board/:id[?item=<id>] or /embed/b/:id[?frame=<id>][&readonly=1].
 */
export function parseBoardUrl(raw: unknown, origin: string): { boardId: string; frame: string | null; readonly: boolean } | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  const m = /^\/(?:board|embed\/b)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname);
  if (!m) return null;
  const frame = u.searchParams.get('frame') ?? u.searchParams.get('item');
  return { boardId: m[1], frame: frame && /^[A-Za-z0-9_-]{1,64}$/.test(frame) ? frame : null, readonly: u.searchParams.get('readonly') === '1' };
}

const clamp = (v: unknown, def: number, min: number) => {
  const n = typeof v === 'string' && /^\d{1,5}$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(MAX, n)) : def;
};

/** The oEmbed answer for an embeddable board; `title` null for a board visitors may not view. */
export function oembedFor(
  origin: string,
  target: { boardId: string; frame: string | null; readonly: boolean },
  title: string | null,
  max: { maxwidth?: unknown; maxheight?: unknown },
): OEmbedResponse {
  // A board is a canvas: it fills what the consumer offers, at the 4:3 we suggest otherwise.
  const width = clamp(max.maxwidth, BOARD_EMBED_SIZE.width, MIN.width);
  const height = clamp(max.maxheight, Math.round((width * BOARD_EMBED_SIZE.height) / BOARD_EMBED_SIZE.width), MIN.height);
  const name = title?.trim() || GENERIC_TITLE;
  return {
    version: '1.0',
    type: 'rich',
    provider_name: 'Freero',
    provider_url: origin,
    title: name,
    html: boardEmbedCode(boardEmbedUrl(origin, target.boardId, target), name, { width, height }),
    width,
    height,
    cache_age: 300,
  };
}
