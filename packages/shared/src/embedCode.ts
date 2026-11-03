// The embed URL and iframe code of a board embedded on another site (#2): one builder for the
// share dialog's "copy embed code" and the server's oEmbed answer. The code is pasted into OTHER
// sites' pages, so everything in it is escaped: a board's title can never add markup there.

export interface BoardEmbedOptions {
  /** Viewers stay read-only whatever they may do on the board. */
  readonly?: boolean;
  /** Start looking at this item (a frame) instead of the whole board. */
  frame?: string | null;
}

/** The embed size suggested when the consumer says nothing (4:3; boards fill what they get). */
export const BOARD_EMBED_SIZE = { width: 800, height: 600 };

/** `origin` + /embed/b/:id with the options as its query. */
export function boardEmbedUrl(origin: string, boardId: string, opts: BoardEmbedOptions = {}): string {
  const q = new URLSearchParams();
  if (opts.readonly) q.set('readonly', '1');
  if (opts.frame) q.set('frame', opts.frame);
  const s = q.toString();
  return `${origin}/embed/b/${encodeURIComponent(boardId)}${s ? `?${s}` : ''}`;
}

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The iframe that embeds the board, `title` its accessible name. */
export function boardEmbedCode(src: string, title: string, size: { width: number; height: number } = BOARD_EMBED_SIZE): string {
  return (
    `<iframe src="${escapeAttr(src)}" width="${Math.round(size.width)}" height="${Math.round(size.height)}" title="${escapeAttr(title.trim() || 'Freero board')}" ` +
    `style="border:0;max-width:100%" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen loading="lazy"></iframe>`
  );
}

/** `<link rel="alternate" type="application/json+oembed">` for a public board's page (oEmbed discovery). */
export function oembedDiscoveryTag(origin: string, boardId: string, title: string): string {
  const href = `${origin}/api/oembed?format=json&url=${encodeURIComponent(`${origin}/board/${boardId}`)}`;
  return `<link rel="alternate" type="application/json+oembed" href="${escapeAttr(href)}" title="${escapeAttr(title.trim() || 'Freero board')}">`;
}
