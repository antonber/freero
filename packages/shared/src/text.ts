// RichText <-> plain text, without a DOM: the same reading on the web (copy as text, find,
// previews) and on the server (the board outline, layout from structure). The web's sanitizer
// (engine/text/sanitize.ts) builds on these.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Decodes HTML character references (named ones of the RichText subset, decimal and hex). */
export const decodeEntities = (s: string): string =>
  s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/)/i;

/**
 * The one safe-href rule (links in rich text, item links), on the web and the server alike:
 * http(s), mailto, tel, in-board `#…` and same-site `/…` paths. Anything else (javascript:, data:,
 * vbscript:…) is refused.
 */
export function isSafeHref(href: string): boolean {
  const h = href.trim();
  // Browsers drop tabs/newlines inside a scheme ("java\tscript:"); refuse them outright.
  return !/[\u0000-\u001f]/.test(h) && SAFE_HREF.test(h);
}

/** Plain text with newlines for line breaks / paragraphs / list items. Works without a DOM. */
export function richTextToPlain(html: string): string {
  if (!html) return '';
  const startsWithBlock = /^\s*<(p|div|ul|ol|pre)[\s>]/i.test(html);
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(p|div|li|pre)(\s[^>]*)?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|pre)>/gi, '')
    .replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(text).replace(/\n+$/, '');
  return startsWithBlock ? decoded.replace(/^\n/, '') : decoded;
}

/** Plain text → RichText (escaped, newlines become <br>). */
export function plainToRichText(text: string): string {
  return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

/**
 * [additive] Rich text as text a person (or an agent) reads: like richTextToPlain, but a list item
 * starts with its marker ("1. ", "2. " in a numbered list, "- " in a bulleted one), nested lists
 * are indented three spaces a level, and a link whose text isn't its address is followed by the
 * address in brackets. For the board outline and exports, where a list must still read as one.
 */
export function richTextToReadable(html: string): string {
  if (!html) return '';
  let out = '';
  const lists: Array<{ ordered: boolean; n: number }> = [];
  const links: Array<{ href: string; from: number }> = [];
  // Just after a list item's marker: a block opening there stays on the marker's line.
  let marker = false;
  // A block starts on a line of its own (a line break just before it counts: no blank line).
  const newline = () => {
    if (marker) return;
    if (/\n *$/.test(out)) out = out.replace(/ +$/, '');
    else if (out) out += '\n';
  };
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (m[4] !== undefined) {
      out += decodeEntities(m[4]);
      marker = false;
      continue;
    }
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      marker = false;
      out += '\n';
      // A line break inside a list item keeps to the item's text column.
      if (lists.length) out += '   '.repeat(lists.length - 1) + (lists[lists.length - 1].ordered ? '   ' : '  ');
    } else if (tag === 'p' || tag === 'div' || tag === 'pre') {
      newline();
    } else if (tag === 'ul' || tag === 'ol') {
      newline();
      if (close) lists.pop();
      else lists.push({ ordered: tag === 'ol', n: 0 });
    } else if (tag === 'li') {
      marker = false;
      newline();
      if (close) continue;
      const list = lists[lists.length - 1];
      out += '   '.repeat(Math.max(0, lists.length - 1)) + (list?.ordered ? `${++list.n}. ` : '- ');
      marker = true;
    } else if (tag === 'a') {
      if (!close) {
        const href = /\shref="([^"]*)"/i.exec(m[3])?.[1];
        links.push({ href: href ? decodeEntities(href) : '', from: out.length });
      } else {
        const link = links.pop();
        const label = link ? out.slice(link.from).trim() : '';
        if (link?.href && label !== link.href && label !== link.href.replace(/^(mailto|tel):/i, '')) out += ` (${link.href})`;
      }
    }
  }
  return out.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}
