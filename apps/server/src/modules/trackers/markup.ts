// Issue descriptions in each tracker's format, from and to Freero's Markdown-light (paragraphs,
// `- ` bullets, `[label](url)` links — @freero/shared trackers.ts). Board text is untrusted: it
// only ever becomes text nodes and http(s) links, never markup the tracker would interpret.
//   Jira Cloud (REST v3): Atlassian Document Format (ADF)
//   Jira Data Center (REST v2): wiki markup
//   Linear, GitHub: Markdown as is

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
