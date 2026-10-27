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

/** Plain text with newlines for line breaks / paragraphs / list items. Works without a DOM. */
export function richTextToPlain(html: string): string {
  if (!html) return '';
  const startsWithBlock = /^\s*<(p|div|ul|ol)[\s>]/i.test(html);
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(p|div|li)(\s[^>]*)?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\n+$/, '');
  return startsWithBlock ? text.replace(/^\n/, '') : text;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → RichText (escaped, newlines become <br>). */
export function plainToRichText(text: string): string {
  return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}
