import { EMBED_PROVIDERS, OPERATOR_EMBED_SANDBOX, type EmbedProvider } from '@freero/shared';

// Which pasted links are links, and which can be shown live. Pure, unit-tested.
//
// Live frames come from a STRICT allowlist (`EMBED_PROVIDERS` in @freero/shared, which the server's
// CSP frame-src mirrors): the board stores only the URL someone pasted, and the iframe src is
// REBUILT here from the ids parsed out of it, on the provider's own embed host — never taken from
// stored data — so a crafted element can't frame anything else. The one exception is an origin the
// operator allow-listed (EMBED_EXTRA_ORIGINS): its links are framed as given, sandboxed.

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

export interface LiveEmbed {
  /** Built-in provider id, or 'operator' for an operator's allow-listed origin. */
  provider: EmbedProvider['id'] | 'operator';
  /** "YouTube", "Google Sheets", "embed.example.com". */
  label: string;
  kind: EmbedProvider['kind'];
  /** iframe src: an allow-listed origin, ids validated. */
  src: string;
  sandbox: string;
  allow: string;
}

/** Kept for callers that only care about players. */
export type VideoEmbed = LiveEmbed;

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\.|^m\./, '');

/** Seconds from a YouTube `t` / `start` value (90, 90s, 1m30s). */
function startSeconds(v: string | null): number {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

type Parsed = { provider: EmbedProvider['id']; src: string; label?: string };

const GOOGLE_KINDS: Record<string, { label: string; view: string; published: string }> = {
  document: { label: 'Google Docs', view: 'preview', published: 'pub?embedded=true' },
  spreadsheets: { label: 'Google Sheets', view: 'preview', published: 'pubhtml?widget=true&headers=false' },
  presentation: { label: 'Google Slides', view: 'embed', published: 'embed' },
  forms: { label: 'Google Forms', view: 'viewform?embedded=true', published: 'viewform?embedded=true' },
};

function parse(u: URL): Parsed | null {
  const h = host(u);
  const parts = u.pathname.split('/').filter(Boolean);
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com') {
    const id = h === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = startSeconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ''}` };
  }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const id = h === 'player.vimeo.com' ? (parts[0] === 'video' ? parts[1] : null) : parts.find((p) => /^\d+$/.test(p));
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    return { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}?autoplay=1` };
  }
  if (h === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : null;
    if (!id || !/^[0-9a-f]{32}$/i.test(id)) return null;
    return { provider: 'loom', src: `https://www.loom.com/embed/${id}?autoplay=1` };
  }
  if (h === 'figma.com') {
    // Design files, prototypes and FigJam boards, through Figma's embed viewer.
    const kind = parts[0];
    const key = parts[1];
    if (!['file', 'design', 'proto', 'board'].includes(kind) || !key || !/^[A-Za-z0-9]{10,64}$/.test(key)) return null;
    const node = u.searchParams.get('node-id');
    const target = `https://www.figma.com/${kind}/${key}${node && /^[0-9]+[-:][0-9]+$/.test(node) ? `?node-id=${node}` : ''}`;
    return { provider: 'figma', src: `https://www.figma.com/embed?embed_host=freero&url=${encodeURIComponent(target)}` };
  }
  if (h === 'docs.google.com') {
    const g = GOOGLE_KINDS[parts[0]];
    if (!g || parts[1] !== 'd') return null;
    // Published copies: /<kind>/d/e/<2PACX-…>/pub…; shared files: /<kind>/d/<id>/edit…
    if (parts[2] === 'e') {
      const id = parts[3];
      if (!id || !/^2PACX-[A-Za-z0-9_-]{20,200}$/.test(id)) return null;
      return { provider: 'google', label: g.label, src: `https://docs.google.com/${parts[0]}/d/e/${id}/${g.published}` };
    }
    const id = parts[2];
    if (!id || !/^[A-Za-z0-9_-]{20,128}$/.test(id) || parts[0] === 'forms') return null;
    return { provider: 'google', label: g.label, src: `https://docs.google.com/${parts[0]}/d/${id}/${g.view}` };
  }
  if (h === 'codepen.io') {
    const [user, kind, id] = parts;
    if (!user || !/^[A-Za-z0-9_-]{1,64}$/.test(user) || !['pen', 'embed', 'full', 'details'].includes(kind) || !id || !/^[A-Za-z0-9]{3,16}$/.test(id)) return null;
    return { provider: 'codepen', src: `https://codepen.io/${user}/embed/${id}?default-tab=result` };
  }
  if (h === 'codesandbox.io') {
    const id = parts[0] === 's' || parts[0] === 'embed' ? parts[1] : parts[0] === 'p' && parts[1] === 'sandbox' ? parts[2] : null;
    if (!id || !/^[A-Za-z0-9-]{3,80}$/.test(id)) return null;
    return { provider: 'codesandbox', src: `https://codesandbox.io/embed/${id}?view=preview` };
  }
  return null;
}

/**
 * How a link can be shown live, or null (it stays a preview card). `extraOrigins`: the operator's
 * allow-listed https origins (`Host.board.embeds.extraOrigins`).
 */
export function liveEmbed(url: string, extraOrigins: readonly string[] = []): LiveEmbed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const p = parse(u);
  if (p) {
    const def = EMBED_PROVIDERS.find((d) => d.id === p.provider);
    // Only origins the server's CSP frame-src allows (and nothing else may ever be framed).
    if (!def || !def.frameOrigins.includes(new URL(p.src).origin)) return null;
    return { provider: def.id, label: p.label ?? def.name, kind: def.kind, src: p.src, sandbox: def.sandbox, allow: def.allow };
  }
  if (u.protocol === 'https:' && !u.username && !u.password && extraOrigins.includes(u.origin))
    return { provider: 'operator', label: u.hostname, kind: 'document', src: u.toString(), sandbox: OPERATOR_EMBED_SANDBOX, allow: 'fullscreen' };
  return null;
}

/** A video player for this link (YouTube, Vimeo, Loom), or null. */
export function videoEmbed(url: string): VideoEmbed | null {
  const e = liveEmbed(url);
  return e?.kind === 'video' ? e : null;
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
