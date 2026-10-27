import { EMBED_FRAME_ORIGINS } from '@freero/shared';

// Which pasted links are links, and which can play inline. Pure, unit-tested.
//
// Inline players come from a STRICT allowlist: the board stores only the URL someone pasted, and
// the iframe src is rebuilt here from the video id parsed out of it — never taken from stored
// data — so a crafted element can't frame anything else.

/** The pasted text as an http(s) URL when it is exactly one link, else null. */
export function asLink(text: string | null): URL | null {
  const t = text?.trim();
  if (!t || /\s/.test(t) || t.length > 2048) return null;
  try {
    const u = new URL(t);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

export interface VideoEmbed {
  provider: 'YouTube' | 'Vimeo' | 'Loom';
  /** iframe src (allowlisted host, id validated). */
  src: string;
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\.|^m\./, '');

/** Seconds from a YouTube `t` / `start` value (90, 90s, 1m30s). */
function startSeconds(v: string | null): number {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

export function videoEmbed(url: string): VideoEmbed | null {
  const v = parseVideo(url);
  // Only origins the server's CSP frame-src allows (and nothing else may ever be framed).
  return v && (EMBED_FRAME_ORIGINS as readonly string[]).includes(new URL(v.src).origin) ? v : null;
}

function parseVideo(url: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = host(u);
  const parts = u.pathname.split('/').filter(Boolean);
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com') {
    const id = h === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = startSeconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return { provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}` };
  }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const id = h === 'player.vimeo.com' ? (parts[0] === 'video' ? parts[1] : null) : parts.find((p) => /^\d+$/.test(p));
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    return { provider: 'Vimeo', src: `https://player.vimeo.com/video/${id}?autoplay=1` };
  }
  if (h === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : null;
    if (!id || !/^[0-9a-f]{32}$/i.test(id)) return null;
    return { provider: 'Loom', src: `https://www.loom.com/embed/${id}?autoplay=1` };
  }
  return null;
}

/** "example.com" for display. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Image sources a card may show: our uploads, data: images and http(s) (never script URLs). */
export function safeImageSrc(src: string | null): string | null {
  if (!src) return null;
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) return src;
  if (src.startsWith('/uploads/')) return src;
  return /^https?:\/\//i.test(src) ? src : null;
}
