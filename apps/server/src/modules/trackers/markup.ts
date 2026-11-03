// Issue descriptions in each tracker's format, from and to Freero's Markdown-light (paragraphs,
// `- ` bullets, `[label](url)` links — @freero/shared trackers.ts). Board text is untrusted: it
// only ever becomes text nodes and http(s) links, never markup the tracker would interpret.
//   Jira Cloud (REST v3): Atlassian Document Format (ADF)
//   Jira Data Center (REST v2): wiki markup
//   Linear, GitHub: Markdown as is
//   Azure DevOps, monday.com updates: HTML from a fixed template
//   Asana: its rich text (`html_notes`: <body>, text with newlines, <ul><li>, <a href>; no <p>)

type Inline = { text: string; href?: string };

const LINK = /\[([^\]\n]{1,500})\]\((https?:\/\/[^\s)]{1,2000})\)/g;

/** Splits a line into text and http(s) links. */
export function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of line.matchAll(LINK)) {
    if (m.index! > at) out.push({ text: line.slice(at, m.index) });
    out.push({ text: m[1], href: m[2] });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out.filter((i) => i.text);
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else out.push({ kind: 'ul', items: [bullet[1]] });
    } else if (!line.trim()) {
      if (last && !(last.kind === 'p' && last.lines.length === 0)) out.push({ kind: 'p', lines: [] });
    } else if (last?.kind === 'p') last.lines.push(line);
    else out.push({ kind: 'p', lines: [line] });
  }
  return out.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

// ---- ADF ----

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

const adfInline = (line: string): AdfNode[] =>
  inlines(line).map((i) =>
    i.href
      ? {
          type: 'text',
          text: i.text,
          marks: [{ type: 'link', attrs: { href: i.href } }],
        }
      : { type: 'text', text: i.text },
  );

export function markdownToAdf(md: string): {
  type: 'doc';
  version: 1;
  content: AdfNode[];
} {
  const content: AdfNode[] = blocks(md).map((b) =>
    b.kind === 'ul'
      ? {
          type: 'bulletList',
          content: b.items.map((it) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: adfInline(it) }],
          })),
        }
      : {
          type: 'paragraph',
          content: b.lines.flatMap((l, i) => (i ? [{ type: 'hardBreak' }, ...adfInline(l)] : adfInline(l))),
        },
  );
  return { type: 'doc', version: 1, content };
}

function adfText(nodes: AdfNode[] | undefined): string {
  let s = '';
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      const href = n.marks?.find((m) => m.type === 'link')?.attrs?.href;
      s += typeof href === 'string' && /^https?:\/\//.test(href) ? `[${n.text ?? ''}](${href})` : (n.text ?? '');
    } else if (n.type === 'hardBreak') s += '\n';
    else if (n.type === 'mention' || n.type === 'emoji' || n.type === 'status') s += String(n.attrs?.text ?? n.attrs?.shortName ?? '');
    else if (n.type === 'inlineCard') s += String(n.attrs?.url ?? '');
    else s += adfText(n.content);
  }
  return s;
}

/** ADF to Markdown-light: what Freero compares and shows. Unknown nodes keep their text. */
export function adfToMarkdown(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  const root = doc as AdfNode | null;
  if (!root || typeof root !== 'object') return '';
  const out: string[] = [];
  for (const b of root.content ?? []) {
    if (b.type === 'bulletList' || b.type === 'orderedList') out.push((b.content ?? []).map((li) => `- ${(li.content ?? []).map((p) => adfText(p.content)).join(' ')}`).join('\n'));
    else if (b.type === 'paragraph' || b.type === 'heading') out.push(adfText(b.content));
    else out.push(adfText(b.content));
  }
  return out.filter((s) => s.trim()).join('\n\n');
}

// ---- Jira wiki markup (Data Center / Server, REST v2) ----

/** Characters wiki markup would interpret in board text. */
const escapeWiki = (s: string) => s.replace(/([[\]{}|*_+^~?#-])/g, '\\$1');

export function markdownToWiki(md: string): string {
  const line = (l: string) =>
    inlines(l)
      .map((i) => (i.href ? `[${escapeWiki(i.text)}|${i.href}]` : escapeWiki(i.text)))
      .join('');
  return blocks(md)
    .map((b) => (b.kind === 'ul' ? b.items.map((it) => `* ${line(it)}`).join('\n') : b.lines.map(line).join('\n')))
    .join('\n\n');
}

export function wikiToMarkdown(wiki: unknown): string {
  if (typeof wiki !== 'string') return '';
  return wiki
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\*+\s+/, '- ')
        .replace(/\[([^|\]\n]+)\|(https?:\/\/[^\]\s]+)\]/g, '[$1]($2)')
        .replace(/\\([[\]{}|*_+^~?#-])/g, '$1'),
    )
    .join('\n');
}

// ---- HTML (Azure DevOps) ----
//
// Written from a fixed template (#6): <p> paragraphs with <br> between lines, <ul><li> bullets and
// <a href> for http(s) links only; every piece of board text is escaped. Read back by keeping only
// the text, the links and the block breaks of whatever HTML the work item holds.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const htmlInline = (line: string) => inlines(line).map((i) => (i.href ? `<a href="${escapeHtml(i.href)}">${escapeHtml(i.text)}</a>` : escapeHtml(i.text))).join('');

export function markdownToHtml(md: string): string {
  return blocks(md)
    .map((b) => (b.kind === 'p' ? `<p>${b.lines.map(htmlInline).join('<br>')}</p>` : `<ul>${b.items.map((i) => `<li>${htmlInline(i)}</li>`).join('')}</ul>`))
    .join('');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const named = ENTITIES[e.toLowerCase()];
    if (named !== undefined) return named;
    const code = e[0] === '#' ? (e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NaN;
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });

export function htmlToMarkdown(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  const out = html
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, d: string | undefined, s: string | undefined, text: string) => {
      const href = decodeHtml(d ?? s ?? '');
      const label = decodeHtml(text.replace(/<[^>]+>/g, '')).trim();
      return /^https?:\/\//i.test(href) && label ? `[${label}](${href})` : label;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '')
    .replace(/<(ul|ol)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|pre|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeHtml(out)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Asana rich text (#120) ----
//
// `html_notes` is XML-like: a <body> root, line breaks as newlines in the text, <ul><li> lists and
// <a href> links (no <p>, no <br>). Written from the same escaped template; read back with the
// newlines kept as line breaks.

export function markdownToAsanaHtml(md: string): string {
  const body = blocks(md)
    .map((b) => (b.kind === 'p' ? b.lines.map(htmlInline).join('\n') : `<ul>${b.items.map((i) => `<li>${htmlInline(i)}</li>`).join('')}</ul>`))
    .join('\n\n');
  return `<body>${body}</body>`;
}

export function asanaHtmlToMarkdown(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  return htmlToMarkdown(html.replace(/\r?\n/g, '<br>'));
}
