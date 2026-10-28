// Item links: what people type → what we store (normalizeLink), and what a stored link — written
// by anyone, so untrusted — is allowed to do when followed (resolveLink).
import { isSafeHref } from '@engine';

export const LINK_DIALOG = 'links.editor';

export type LinkTarget =
  | { kind: 'item'; id: string }
  /** Same-site path (another board): navigate in the app. */
  | { kind: 'path'; path: string }
  /** External (http(s), mailto, tel): a new tab. */
  | { kind: 'url'; href: string };

const ITEM_ID = /^[\w-]{1,64}$/;

/** The element id a same-board item link points at ('/board/<this>?item=<id>'), if it is one. */
function sameBoardItem(url: URL, origin: string, boardId: string): string | null {
  if (url.origin !== origin) return null;
  const m = /^\/board\/([^/]+)\/?$/.exec(url.pathname);
  if (!m || decodeURIComponent(m[1]) !== boardId) return null;
  const id = url.searchParams.get('item') ?? url.searchParams.get('el');
  return id && ITEM_ID.test(id) ? id : null;
}

/**
 * Typed / pasted text → the stored link, '' to remove it, or an error to show.
 * - "#abc" and a pasted "Copy link to item" URL of THIS board → "#abc" (jumps, survives renames
 *   of the host);
 * - "example.com/x" → "https://example.com/x";
 * - anything the safe-href rule refuses (javascript:, data:…) → error.
 */
export function normalizeLink(input: string, ctx: { origin: string; boardId: string }): { link: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { link: '' };
  if (raw.startsWith('#')) return ITEM_ID.test(raw.slice(1)) ? { link: raw } : { error: 'That item link is not valid.' };
  let candidate = raw;
  if (raw.startsWith('//')) candidate = `https:${raw}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('/')) {
    // Bare domain ("example.com/page"): assume https. Words with spaces are not links.
    if (/\s/.test(raw) || !/^[^/]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw)) return { error: 'Enter a web address (https://…) or an item link.' };
    candidate = `https://${raw}`;
  }
  if (!isSafeHref(candidate)) return { error: 'Only web, email and phone links are allowed.' };
  if (candidate.startsWith('/')) {
    const url = new URL(candidate, ctx.origin);
    const id = sameBoardItem(url, ctx.origin, ctx.boardId);
    return { link: id ? `#${id}` : url.pathname + url.search };
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'That address is not valid.' };
  }
  const id = sameBoardItem(url, ctx.origin, ctx.boardId);
  if (id) return { link: `#${id}` };
  if (url.origin === ctx.origin && /^https?:$/.test(url.protocol)) return { link: url.pathname + url.search };
  return { link: url.href };
}

/** What following a stored link may do. Null for anything unsafe or malformed. */
export function resolveLink(link: string | null | undefined, origin: string): LinkTarget | null {
  if (!link || !isSafeHref(link)) return null;
  const l = link.trim();
  if (l.startsWith('#')) return ITEM_ID.test(l.slice(1)) ? { kind: 'item', id: l.slice(1) } : null;
  if (l.startsWith('/') && !l.startsWith('//')) return { kind: 'path', path: l };
  try {
    const url = new URL(l, origin);
    if (!/^(https?|mailto|tel):$/.test(url.protocol)) return null;
    return { kind: 'url', href: url.href };
  } catch {
    return null;
  }
}

/** Short text for tooltips and the editor ("example.com/page"). */
export function describeLink(target: LinkTarget): string {
  if (target.kind === 'item') return 'an item on this board';
  if (target.kind === 'path') return target.path;
  try {
    const u = new URL(target.href);
    if (u.protocol === 'mailto:' || u.protocol === 'tel:') return u.href.slice(u.protocol.length);
    return (u.host + u.pathname.replace(/\/$/, '') + u.search).slice(0, 80);
  } catch {
    return target.href;
  }
}
