// Markdown → RichText (the board's sanitized HTML subset, elements.ts): how a card description
// written by an agent or an API client (MCP add_cards / update_items, REST v1) arrives formatted.
// Parsing is the docs' Markdown reader (docs.ts markdownToDoc, in-house, no dependencies); this
// maps its blocks onto what rich text can hold: paragraphs, numbered and bulleted lists (nested),
// bold, italic, strikethrough, inline code, code blocks and links. Everything else reads as text.
// Safe by construction, never by a later pass: every piece of text is escaped (HTML in the input
// is text), and a link is kept only when its address passes isSafeHref (javascript:, data: … lose
// the link and keep their words).
import { markdownToDoc, type DocBlock, type DocInline, type DocLink, type DocText } from './docs';
import { escapeHtml, isSafeHref } from './text';

/** A bare web address in text ("see https://example.com/a."): linked, without trailing punctuation. */
const BARE_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;

function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?*_~]+$/, '');
  // A closing bracket belongs to the address only when it opened one ("…/Foo_(bar)").
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?]+$/, '');
  return u;
}

function linkify(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(BARE_URL)) {
    const url = trimUrl(m[0]);
    const at = m.index ?? 0;
    out += `${escapeHtml(text.slice(last, at))}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    last = at + url.length;
  }
  return out + escapeHtml(text.slice(last));
}

const lines = (html: string) => html.replace(/\r\n?|\n/g, '<br>');

function textHtml(n: DocText, inLink: boolean): string {
  let h = lines(n.styles.code || inLink ? escapeHtml(n.text) : linkify(n.text));
  if (n.styles.code) h = `<code>${h}</code>`;
  if (n.styles.strike) h = `<s>${h}</s>`;
  if (n.styles.underline) h = `<u>${h}</u>`;
  if (n.styles.italic) h = `<i>${h}</i>`;
  if (n.styles.bold) h = `<b>${h}</b>`;
  return h;
}

function linkHtml(n: DocLink): string {
  const label = (n.content ?? []).map((t) => textHtml(t, true)).join('');
  return isSafeHref(n.href) ? `<a href="${escapeHtml(n.href.trim())}">${label}</a>` : label;
}

function inline(content: DocBlock['content']): string {
  if (!Array.isArray(content)) return '';
  return (content as DocInline[]).map((n) => (n.type === 'link' ? linkHtml(n) : textHtml(n, false))).join('');
}

const LIST_TAG: Record<string, 'ol' | 'ul'> = { numberedListItem: 'ol', bulletListItem: 'ul', checkListItem: 'ul' };

function listItem(b: DocBlock): string {
  const box = b.type === 'checkListItem' ? (b.props?.checked ? '☑ ' : '☐ ') : '';
  const own = box + inline(b.content);
  const children = blocks(b.children ?? []);
  return `<li>${own || (children ? '' : '<br>')}${children}</li>`;
}

function block(b: DocBlock): string {
  switch (b.type) {
    case 'paragraph':
    case 'quote':
      return `<p>${inline(b.content) || '<br>'}</p>`;
    case 'heading':
      return `<p><b>${inline(b.content)}</b></p>`;
    case 'codeBlock': {
      const code = Array.isArray(b.content) ? b.content.map((n) => (n.type === 'text' ? n.text : '')).join('') : '';
      return `<pre>${escapeHtml(code) || '<br>'}</pre>`;
    }
    case 'table': {
      const rows = b.content && !Array.isArray(b.content) ? b.content.rows : [];
      const cell = (c: unknown) => inline((Array.isArray(c) ? c : (c as { content?: DocInline[] })?.content) ?? []);
      return `<p>${rows.map((r) => (r.cells ?? []).map(cell).join(' · ')).join('<br>')}</p>`;
    }
    case 'image': {
      const url = String(b.props?.url ?? '');
      const caption = escapeHtml(String(b.props?.caption ?? '')) || escapeHtml(url);
      return `<p>${isSafeHref(url) ? `<a href="${escapeHtml(url)}">${caption}</a>` : caption}</p>`;
    }
    case 'divider':
      return '';
    default: {
      const text = b.type === 'boardEmbed' ? String(b.props?.uri ?? '') : '';
      return text ? `<p>${escapeHtml(text)}</p>` : '';
    }
  }
}

function blocks(list: readonly DocBlock[]): string {
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const tag = LIST_TAG[list[i].type];
    if (!tag) {
      out += block(list[i]);
      continue;
    }
    let items = '';
    for (; i < list.length && LIST_TAG[list[i].type] === tag; i++) items += listItem(list[i]);
    i--;
    out += `<${tag}>${items}</${tag}>`;
  }
  return out;
}

/**
 * [additive] Markdown → RichText. Line breaks inside a paragraph are kept (as people mean them in a
 * card's notes); a blank line starts a new paragraph. Text that is a single paragraph comes back
 * without a paragraph around it, exactly as plainToRichText writes plain text.
 */
export function markdownToRichText(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';
  const doc = markdownToDoc(markdown);
  if (doc.length === 1 && doc[0].type === 'paragraph') return inline(doc[0].content);
  return blocks(doc);
}
