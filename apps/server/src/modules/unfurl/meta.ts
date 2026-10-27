// Reads a page's preview metadata (Open Graph / Twitter cards / <title> / meta description)
// from the start of its HTML. Pure; tolerant of messy markup. No HTML is ever returned: every
// value is decoded to plain text and length-capped.

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Absolute image URL, or null. */
  image: string | null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16), m);
    if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10), m);
    return NAMED[k] ?? m;
  });
}

function safeChar(code: number, fallback: string): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** Plain text: entities decoded, tags and control characters dropped, whitespace collapsed, capped. */
function clean(s: string | undefined | null, max: number): string | null {
  if (!s) return null;
  const text = decodeEntities(s)
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

export function parseMeta(html: string, baseUrl: string): PageMeta {
  // Only the head matters; a body full of <meta> examples shouldn't win.
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
  const meta = new Map<string, string>();
  // Quoted attribute values may contain '>'.
  for (const m of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.trim());
  const rawImage = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src', 'image');
  let image: string | null = null;
  if (rawImage) {
    try {
      const u = new URL(decodeEntities(rawImage.trim()), baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') image = u.toString();
    } catch {
      image = null;
    }
  }
  return {
    title: clean(pick('og:title', 'twitter:title') ?? titleTag, 200),
    description: clean(pick('og:description', 'twitter:description', 'description'), 400),
    siteName: clean(pick('og:site_name', 'application-name'), 80),
    image,
  };
}
