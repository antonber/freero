// A marketing page as Markdown, for AI agents and answer engines (served.ts): the same page people
// get — origin, legal facts and community data already filled in — cut down to what it says. The
// page's <main> (its text, headings, lists, tables, code, links and image descriptions) becomes
// Markdown; the head (CSS, JSON-LD), the site header and footer, breadcrumbs and decorative marks
// go. Nothing is written for agents only: a page has one text, in two formats.
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5';

type Node = T.ChildNode;
type Element = T.Element;

const isElement = (n: Node | T.ParentNode): n is Element => 'tagName' in n;
const attr = (el: Element, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;

function find(node: T.ParentNode, test: (el: Element) => boolean): Element | null {
  for (const c of node.childNodes) {
    if (!isElement(c)) continue;
    if (test(c)) return c;
    const inner = find(c.tagName === 'template' ? (c as T.Template).content : c, test);
    if (inner) return inner;
  }
  return null;
}

/** Never content: code and styling, decorations, the in-page breadcrumb trail, hidden elements. */
const SKIP = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head', 'button', 'form', 'input', 'select', 'textarea', 'iframe', 'canvas', 'video', 'audio']);
const skipped = (el: Element) =>
  SKIP.has(el.tagName) || attr(el, 'aria-hidden') === 'true' || attr(el, 'hidden') !== undefined || (el.tagName === 'nav' && attr(el, 'aria-label') === 'Breadcrumb');

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]);

/**
 * Text as Markdown: whitespace collapsed, the characters Markdown would read as syntax escaped —
 * `<` too, so text (a community template's title) never becomes HTML where Markdown is rendered.
 */
const escapeText = (s: string) => s.replace(/\s+/g, ' ').replace(/([\\`*_[\]<])/g, '\\$1');

interface Ctx {
  /** Resolves a link or image address against the page's own URL. */
  url: (href: string) => string;
}

/** The inline Markdown of `nodes` (one line, collapsed). */
function inline(nodes: Node[], ctx: Ctx): string {
  let out = '';
  let prev: Element | null = null;
  for (const n of nodes) {
    if (n.nodeName === '#text') {
      out += escapeText((n as T.TextNode).value);
      prev = null;
      continue;
    }
    if (!isElement(n) || skipped(n)) continue;
    // Links laid out side by side (a row of buttons) read as separate links, not one run of text.
    if (prev?.tagName === 'a' && n.tagName === 'a' && !/\s$/.test(out)) out += ' · ';
    out += inlineElement(n, ctx);
    prev = n;
  }
  return out;
}

function inlineElement(el: Element, ctx: Ctx): string {
  const inner = () => inline(el.childNodes, ctx).trim();
  switch (el.tagName) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b': {
      const t = inner();
      return t ? `**${t}**` : '';
    }
    case 'em':
    case 'i': {
      const t = inner();
      return t ? `_${t}_` : '';
    }
    case 'code': {
      const t = textOf(el).replace(/\s+/g, ' ');
      const fence = t.includes('`') ? '``' : '`';
      return t ? `${fence}${t}${fence}` : '';
    }
    case 'a': {
      const t = inner();
      const href = attr(el, 'href');
      if (!t) return '';
      return href ? `[${t}](${ctx.url(href)})` : t;
    }
    case 'img': {
      const alt = (attr(el, 'alt') ?? '').trim();
      const src = attr(el, 'src');
      return alt && src ? `![${escapeText(alt)}](${ctx.url(src)})` : '';
    }
    default:
      // A block element inside inline content (a heading in a list item): its text, inline.
      return /^h[1-6]$/.test(el.tagName) ? `**${inner()}** ` : inline(el.childNodes, ctx);
  }
}

const textOf = (n: Node): string => (n.nodeName === '#text' ? (n as T.TextNode).value : isElement(n) && !skipped(n) ? n.childNodes.map(textOf).join('') : '');

const hasBlockChild = (el: Element): boolean => el.childNodes.some((c) => isElement(c) && !skipped(c) && BLOCK.has(c.tagName));

/** The Markdown blocks of `nodes`, each a paragraph-level chunk. */
function blocks(nodes: Node[], ctx: Ctx): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const t = inline(run, ctx).trim();
    if (t) out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (isElement(n) && skipped(n)) continue;
    if (isElement(n) && BLOCK.has(n.tagName)) {
      flush();
      out.push(...block(n, ctx));
    } else run.push(n);
  }
  flush();
  return out;
}

function list(el: Element, ctx: Ctx): string {
  const ordered = el.tagName === 'ol';
  let i = Number(attr(el, 'start') ?? 1);
  const items: string[] = [];
  for (const li of el.childNodes) {
    if (!isElement(li) || li.tagName !== 'li' || skipped(li)) continue;
    const marker = ordered ? `${i++}. ` : '- ';
    const body = itemBody(li, ctx);
    if (!body) continue;
    const pad = ' '.repeat(marker.length);
    items.push(marker + body.split('\n').join(`\n${pad}`).replace(/\n\s+\n/g, '\n\n'));
  }
  return items.join(items.some((t) => t.includes('\n\n')) ? '\n\n' : '\n');
}

/** A list item: its first block on the marker's line, further blocks (text, code, nested lists) indented under it. */
function itemBody(li: Element, ctx: Ctx): string {
  if (!hasBlockChild(li)) return inline(li.childNodes, ctx).trim();
  // Headings inside an item are its title, in bold.
  const parts = blocks(li.childNodes, ctx).map((b) => b.replace(/^#{1,6} (.+)$/, '**$1**'));
  // A card or a step (a title, then its text) reads as one line: the title, then the text.
  if (parts.length >= 2 && /^\*\*[^\n]*\*\*$/.test(parts[0]) && !/^(```|\||- |\d+\. |>)/.test(parts[1])) parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  // A nested list follows its item's text directly (a tight list); other blocks are paragraphs.
  return parts.reduce((out, p, i) => (i === 0 ? p : `${out}${/^(- |\d+\. )/.test(p) ? '\n' : '\n\n'}${p}`), '');
}

const cell = (el: Element, ctx: Ctx) => inline(el.childNodes, ctx).trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');

function table(el: Element, ctx: Ctx): string[] {
  const rows: Element[] = [];
  const collect = (n: T.ParentNode) => {
    for (const c of n.childNodes) {
      if (!isElement(c)) continue;
      if (c.tagName === 'tr') rows.push(c);
      else if (c.tagName === 'thead' || c.tagName === 'tbody' || c.tagName === 'tfoot') collect(c);
    }
  };
  collect(el);
  if (!rows.length) return [];
  const cells = rows.map((r) => r.childNodes.filter((c): c is Element => isElement(c) && (c.tagName === 'td' || c.tagName === 'th')).map((c) => cell(c, ctx)));
  const width = Math.max(...cells.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const caption = find(el, (c) => c.tagName === 'caption');
  return [
    ...(caption ? [`**${cell(caption, ctx)}**`] : []),
    [line(cells[0]), `|${' --- |'.repeat(width)}`, ...cells.slice(1).map(line)].join('\n'),
  ];
}

function block(el: Element, ctx: Ctx): string[] {
  const tag = el.tagName;
  if (/^h[1-6]$/.test(tag)) {
    const t = inline(el.childNodes, ctx).trim();
    return t ? [`${'#'.repeat(Number(tag[1]))} ${t}`] : [];
  }
  switch (tag) {
    case 'p':
    case 'dt':
    case 'dd':
    case 'figcaption':
    case 'summary': {
      if (hasBlockChild(el)) return blocks(el.childNodes, ctx);
      const t = inline(el.childNodes, ctx).trim();
      if (!t) return [];
      return [tag === 'dt' || tag === 'summary' ? `**${t.replace(/^\*\*|\*\*$/g, '')}**` : t];
    }
    case 'ul':
    case 'ol': {
      const l = list(el, ctx);
      return l ? [l] : [];
    }
    case 'pre': {
      const code = textOf(el).replace(/\n+$/, '');
      const lang = (attr(find(el, (c) => c.tagName === 'code') ?? el, 'class') ?? '').match(/language-([\w-]+)/)?.[1] ?? '';
      const fence = code.includes('```') ? '````' : '```';
      return [`${fence}${lang}\n${code}\n${fence}`];
    }
    case 'blockquote':
      return [blocks(el.childNodes, ctx).join('\n\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')];
    case 'hr':
      return ['---'];
    case 'table':
      return table(el, ctx);
    default:
      // A container (div, section, header, figure, details, li outside a list…).
      return blocks(el.childNodes, ctx);
  }
}

const front = (k: string, v: string) => `${k}: ${JSON.stringify(v)}`;

/**
 * A page's Markdown: a front matter block (its title, description and canonical address), then
 * the content of its <main> (the <body> when it has none). `pageUrl`: the page's own address,
 * which relative links resolve against.
 */
export function pageMarkdown(html: string, pageUrl: string): string {
  const doc = parse(html);
  const head = find(doc, (e) => e.tagName === 'head');
  const title = head ? find(head, (e) => e.tagName === 'title') : null;
  const description = head ? find(head, (e) => e.tagName === 'meta' && attr(e, 'name') === 'description') : null;
  const canonical = head ? find(head, (e) => e.tagName === 'link' && attr(e, 'rel') === 'canonical') : null;
  const base = attr(canonical ?? ({ attrs: [] } as unknown as Element), 'href') ?? pageUrl;
  const ctx: Ctx = {
    url: (href) => {
      if (href.startsWith('#')) return `${base}${href}`;
      try {
        // Parentheses would end the Markdown link early.
        return new URL(href, base).toString().replace(/\(/g, '%28').replace(/\)/g, '%29');
      } catch {
        return href;
      }
    },
  };
  const root = find(doc, (e) => e.tagName === 'main') ?? find(doc, (e) => e.tagName === 'body');
  const body = root ? blocks(root.childNodes, ctx) : [];
  const meta = [
    ...(title ? [front('title', textOf(title).trim())] : []),
    ...(description && attr(description, 'content') ? [front('description', attr(description, 'content')!)] : []),
    front('url', base),
  ];
  return `---\n${meta.join('\n')}\n---\n\n${body.join('\n\n')}\n`;
}

/** Whether a request asks for Markdown over HTML (`Accept: text/markdown`, at least as preferred as text/html). */
export function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  let md = 0;
  let html = 0;
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().toLowerCase().split(';');
    const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith('q='))?.slice(2) ?? 1);
    if (!Number.isFinite(q)) continue;
    if (type === 'text/markdown' || type === 'text/x-markdown') md = Math.max(md, q);
    else if (type === 'text/html') html = Math.max(html, q);
  }
  return md > 0 && md >= html;
}
