// RichText = a small sanitized HTML subset (see @freero/shared RichText):
// <b> <i> <u> <s> <a href> <br> <ul> <ol> <li> <p> <span style="color|background-color">.
import DOMPurify from 'dompurify';

const PURIFY_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'br', 'ul', 'ol', 'li', 'p', 'div', 'span', 'font'];
const PURIFY_ATTR = ['href', 'style', 'color'];
const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/)/i;

const RENAME: Record<string, string> = { STRONG: 'b', EM: 'i', STRIKE: 's', DEL: 's', DIV: 'p' };

function rename(el: Element, tag: string): Element {
  const doc = el.ownerDocument;
  const n = doc.createElement(tag);
  for (const a of Array.from(el.attributes)) n.setAttribute(a.name, a.value);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function wrapChildren(el: Element, tag: string) {
  const w = el.ownerDocument.createElement(tag);
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
}

function normalize(node: Node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue;
    let el = child as HTMLElement;
    const renamed = RENAME[el.tagName];
    if (renamed) el = rename(el, renamed) as HTMLElement;
    if (el.tagName === 'FONT') {
      const color = el.getAttribute('color');
      const span = rename(el, 'span') as HTMLElement;
      span.removeAttribute('color');
      if (color) span.style.color = color;
      el = span;
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      for (const a of Array.from(el.attributes)) if (a.name !== 'href') el.removeAttribute(a.name);
      if (!SAFE_HREF.test(href.trim())) el.removeAttribute('href');
    } else if (el.tagName === 'SPAN') {
      const s = el.style;
      const color = s.color;
      const bg = s.backgroundColor;
      const bold = s.fontWeight === 'bold' || Number(s.fontWeight) >= 600;
      const italic = s.fontStyle === 'italic';
      const deco = `${s.textDecoration} ${s.textDecorationLine}`;
      el.removeAttribute('style');
      if (color) el.style.color = color;
      if (bg && bg !== 'transparent') el.style.backgroundColor = bg;
      if (bold) wrapChildren(el, 'b');
      if (italic) wrapChildren(el, 'i');
      if (deco.includes('line-through')) wrapChildren(el, 's');
      if (deco.includes('underline')) wrapChildren(el, 'u');
    } else {
      el.removeAttribute('style');
      el.removeAttribute('color');
    }
    normalize(el);
    if (el.tagName === 'SPAN' && !el.getAttribute('style')) unwrap(el);
  }
}

/** Sanitizes HTML down to the RichText subset. Safe to store and to render with innerHTML. */
export function sanitizeRichText(html: string): string {
  if (!html) return '';
  if (!DOMPurify.isSupported || typeof document === 'undefined') return plainToRichText(richTextToPlain(html));
  const frag = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PURIFY_TAGS,
    ALLOWED_ATTR: PURIFY_ATTR,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  const root = document.createElement('div');
  root.appendChild(frag);
  normalize(root);
  let out = root.innerHTML;
  // A lone <br> (what an emptied contenteditable leaves behind) means "empty".
  if (/^(<br\s*\/?>|<p><br\s*\/?><\/p>|\s)*$/i.test(out)) out = '';
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

const decodeEntities = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Tags that start a new line in richTextToPlain: an occurrence never spans one. */
const LINE_TAG = /^<\/?(br|p|div|li|ul|ol)[\s/>]/i;
/** Inline formatting left with nothing inside after a replacement. */
const EMPTY_INLINE = /<(b|i|u|s|span|a)(\s[^>]*)?><\/\1>/gi;

/**
 * [additive] Replaces `find` in the TEXT of rich text, keeping every tag (bold, links, colors) as
 * it was. Works without a DOM. Matching sees the text the way richTextToPlain does, so an
 * occurrence split by formatting ("<b>Hel</b>lo") is replaced too: the replacement takes the
 * formatting of the occurrence's FIRST character (the run it starts in), and the rest of the
 * occurrence is removed from the runs after it. An occurrence never spans a line break.
 */
export function replaceInRichText(
  html: string,
  find: string,
  replacement: string,
  opts: { caseSensitive?: boolean } = {},
): { html: string; count: number } {
  if (!html || !find) return { html, count: 0 };
  // Tokens: tags, and text runs decoded to plain text. `plain` is the runs joined, with a "\n"
  // wherever a line tag sits, so occurrences can cross inline tags but never lines.
  type Run = { raw: string; text: string | null; start: number; edits: Array<{ from: number; to: number; insert: string }> };
  const runs: Run[] = [];
  let plain = '';
  for (const m of html.matchAll(/(<[^>]*>)|([^<]+)/g)) {
    if (m[1]) {
      runs.push({ raw: m[1], text: null, start: plain.length, edits: [] });
      if (LINE_TAG.test(m[1])) plain += '\n';
    } else {
      const text = decodeEntities(m[2]);
      runs.push({ raw: m[2], text, start: plain.length, edits: [] });
      plain += text;
    }
  }
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? 'g' : 'gi');
  const textRuns = runs.filter((r) => r.text !== null);
  let count = 0;
  for (const m of plain.matchAll(re)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (m[0].includes('\n')) continue;
    count++;
    let inserted = false;
    for (const r of textRuns) {
      const end = r.start + r.text!.length;
      if (end <= from || r.start >= to) continue;
      const a = Math.max(from, r.start) - r.start;
      const b = Math.min(to, end) - r.start;
      r.edits.push({ from: a, to: b, insert: inserted ? '' : replacement });
      inserted = true;
    }
  }
  if (!count) return { html, count: 0 };
  let out = '';
  for (const r of runs) {
    if (r.text === null || !r.edits.length) {
      out += r.raw;
      continue;
    }
    let text = r.text;
    // Right to left, so earlier offsets stay valid.
    for (const e of [...r.edits].reverse()) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
    out += escapeHtml(text);
  }
  let prev;
  do {
    prev = out;
    out = out.replace(EMPTY_INLINE, '');
  } while (out !== prev);
  return { html: out, count };
}

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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → RichText (escaped, newlines become <br>). */
export function plainToRichText(text: string): string {
  return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}
