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

/** Plain text with newlines for line breaks / paragraphs / list items. Works without a DOM. */
export function richTextToPlain(html: string): string {
  if (!html) return '';
  const startsWithBlock = /^\s*<(p|div|ul|ol)[\s>]/i.test(html);
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(p|div|li)(\s[^>]*)?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '')
    .replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(text).replace(/\n+$/, '');
  return startsWithBlock ? decoded.replace(/^\n/, '') : decoded;
}

/** Plain text → RichText (escaped, newlines become <br>). */
export function plainToRichText(text: string): string {
  return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}
