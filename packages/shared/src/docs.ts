// Docs (KAI-162): a collaborative document next to boards. A doc is an object of its own
// (`freero://doc/<id>`, page `/doc/<id>`) with the same container, sharing and access rules as a
// board (it is a row of the same table, kind 'doc'), and ONE Yjs document of its own, served by the
// same realtime rooms, persistence, history and fan-out as boards.
//
// Layout of a doc's Yjs document:
//   doc.getXmlFragment(DOC_FRAGMENT)  the document, as BlockNote's ProseMirror schema writes it
//                                     through y-prosemirror (blockGroup > blockContainer{id} >
//                                     <content node> [+ blockGroup of children]). Written by the
//                                     editor (engine/docs) and, on requests, by the server
//                                     (realtime/docContent.ts) — the same node layout both ways.
//   doc.getMap('comments')            comment records, exactly as on boards (CommentRecord in
//                                     elements.ts): a thread's `elementId` is the BLOCK it is on.
//                                     So commenter rules, @mentions, notifications, the account
//                                     purge's rename and data exports are the boards' code.
//
// `DocBlock` below is the plain JSON of that document (BlockNote's block JSON, the subset Freero
// uses), shared by the editor, the server's reader / writer and the Markdown conversion here.
// The fragment name is BlockNote's conventional one (also La Suite Docs' and OpenProject's), so a
// doc stays readable by the other BlockNote + Yjs editors.

export const DOC_FRAGMENT = 'document-store';

/** Text styles a doc keeps (BlockNote style names). Colours are kept by the editor but not here. */
export interface DocStyles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
}

export interface DocText {
  type: 'text';
  text: string;
  styles: DocStyles;
}
export interface DocLink {
  type: 'link';
  href: string;
  content: DocText[];
}
export type DocInline = DocText | DocLink;

/** A table cell as the editor reports it (object) or as BlockNote accepts it (inline array). */
export type DocTableCell = DocInline[] | { type: 'tableCell'; content: DocInline[]; props?: Record<string, unknown> };
export interface DocTableContent {
  type: 'tableContent';
  rows: Array<{ cells: DocTableCell[] }>;
}

/**
 * Block types a doc understands. 'boardEmbed' is Freero's own: a LIVE frame (or whole board) of a
 * board, stored as its address only (`props.uri`) and rendered from that board's own doc and
 * connection, with the reader's access checked on the board itself (KAI-152).
 */
export const DOC_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'codeBlock',
  'quote',
  'image',
  'table',
  'divider',
  'boardEmbed',
] as const;
export type DocBlockType = (typeof DOC_BLOCK_TYPES)[number];

export interface DocBlock {
  /** Stable block id (BlockNote's); absent on blocks that are about to be inserted. */
  id?: string;
  /** A DocBlockType, or another BlockNote type this version does not know (kept, read as text). */
  type: string;
  props?: Record<string, string | number | boolean>;
  content?: DocInline[] | DocTableContent;
  children?: DocBlock[];
}

/** Heading levels the editor offers (Markdown deeper than this reads as the deepest). */
export const DOC_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** The plain text of inline content. */
export function inlineText(content: DocBlock['content'] | DocTableCell | undefined): string {
  if (!content) return '';
  if (!Array.isArray(content)) {
    if ((content as { type?: string }).type === 'tableCell') return inlineText((content as { content: DocInline[] }).content);
    const rows = (content as DocTableContent).rows ?? [];
    return rows.map((r) => (r.cells ?? []).map((c) => inlineText(c)).join(' · ')).join('\n');
  }
  let out = '';
  for (const n of content) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') out += typeof n.text === 'string' ? n.text : '';
    else if (n.type === 'link') out += inlineText(n.content);
  }
  return out;
}

/** Every block in document order, depth first, with its depth (0 = top level). */
export function* walkDocBlocks(blocks: readonly DocBlock[], depth = 0): Generator<{ block: DocBlock; depth: number }> {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    yield { block: b, depth };
    if (Array.isArray(b.children) && depth < 64) yield* walkDocBlocks(b.children, depth + 1);
  }
}

/** A block's own text (an image's caption, a table's cells; '' for blocks without text). */
export function blockText(b: DocBlock): string {
  if (b.type === 'image') return typeof b.props?.caption === 'string' ? b.props.caption : '';
  return inlineText(b.content);
}

/** Every address a doc's content points at: link targets, images, live board embeds. */
export function docAddresses(blocks: readonly DocBlock[]): Array<{ blockId: string | null; url: string; kind: 'link' | 'embed' | 'image' }> {
  const out: Array<{ blockId: string | null; url: string; kind: 'link' | 'embed' | 'image' }> = [];
  const links = (content: DocBlock['content'] | DocTableCell | undefined, blockId: string | null) => {
    if (!content) return;
    if (!Array.isArray(content)) {
      if ((content as { type?: string }).type === 'tableCell') return links((content as { content: DocInline[] }).content, blockId);
      for (const r of (content as DocTableContent).rows ?? []) for (const c of r.cells ?? []) links(c, blockId);
      return;
    }
    for (const n of content) if (n && n.type === 'link' && typeof n.href === 'string') out.push({ blockId, url: n.href, kind: 'link' });
  };
  for (const { block } of walkDocBlocks(blocks)) {
    const id = typeof block.id === 'string' ? block.id : null;
    if (block.type === 'boardEmbed' && typeof block.props?.uri === 'string') out.push({ blockId: id, url: block.props.uri, kind: 'embed' });
    else if (block.type === 'image' && typeof block.props?.url === 'string') out.push({ blockId: id, url: block.props.url, kind: 'image' });
    links(block.content, id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Markdown (CommonMark + GFM tables, task lists and strikethrough). Pure, no dependencies: the
// browser (import / export) and the server (the API's doc outline, data exports, creating a doc
// from Markdown) convert with the same code. Lossy only where Markdown has no form: colours,
// underline and alignment are dropped; a live board embed is written as an image of its address
// (`![Live board](freero://board/…)`), which reads back as the embed.
// ---------------------------------------------------------------------------------------------

const STYLE_ORDER: Array<[keyof DocStyles, string]> = [
  ['bold', '**'],
  ['italic', '_'],
  ['strike', '~~'],
];

/** Escapes text so it reads back as itself (never as Markdown syntax). */
function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]~<>|])/g, '\\$1');
}

/** Moves a styled run's outer spaces out of it (`** x**` is not emphasis in CommonMark). */
function splitSpaces(runs: DocText[]): DocText[] {
  const out: DocText[] = [];
  for (const r of runs) {
    const styled = Object.keys(r.styles ?? {}).length > 0;
    const m = styled ? /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text) : null;
    if (!m || (!m[1] && !m[3]) || !m[2]) {
      out.push(r);
      continue;
    }
    if (m[1]) out.push({ type: 'text', text: m[1], styles: {} });
    out.push({ type: 'text', text: m[2], styles: r.styles });
    if (m[3]) out.push({ type: 'text', text: m[3], styles: {} });
  }
  return out;
}

function textRunsToMarkdown(runs: DocText[]): string {
  let out = '';
  const open: string[] = [];
  const closeFrom = (i: number) => {
    while (open.length > i) out += open.pop();
  };
  for (const r of splitSpaces(runs.filter((x) => x && typeof x.text === 'string' && x.text))) {
    const st = r.styles ?? {};
    const wanted = STYLE_ORDER.filter(([k]) => st[k]).map(([, m]) => m);
    // Keep the longest prefix of open markers this run still has; close the rest, open the new ones.
    let keep = 0;
    while (keep < open.length && wanted.includes(open[keep])) keep++;
    closeFrom(keep);
    for (const m of wanted) if (!open.includes(m)) {
      out += m;
      open.push(m);
    }
    if (st.code) {
      const ticks = r.text.includes('`') ? '``' : '`';
      const pad = r.text.startsWith('`') || r.text.endsWith('`') ? ' ' : '';
      out += `${ticks}${pad}${r.text}${pad}${ticks}`;
    } else out += escapeText(r.text);
  }
  closeFrom(0);
  return out;
}

const safeHref = (href: string) => href.replace(/[()\s<>]/g, (c) => encodeURIComponent(c));

export function inlineToMarkdown(content: DocInline[] | undefined): string {
  if (!Array.isArray(content)) return '';
  let out = '';
  let runs: DocText[] = [];
  const flush = () => {
    out += textRunsToMarkdown(runs);
    runs = [];
  };
  for (const n of content) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'link') {
      flush();
      const label = textRunsToMarkdown((n.content ?? []).filter((x) => x && x.type === 'text'));
      out += `[${label || escapeText(n.href)}](${safeHref(String(n.href))})`;
    } else if (n.type === 'text') runs.push(n);
  }
  flush();
  return out.replace(/\n/g, '  \n');
}

const cellInline = (c: DocTableCell): DocInline[] => (Array.isArray(c) ? c : Array.isArray(c?.content) ? c.content : []);

function tableToMarkdown(content: DocTableContent): string[] {
  const rows = (content.rows ?? []).map((r) => (r.cells ?? []).map((c) => inlineToMarkdown(cellInline(c)).replace(/\n/g, ' ').trim()));
  if (!rows.length) return [];
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)];
}

/** A doc as Markdown. */
export function docToMarkdown(blocks: readonly DocBlock[]): string {
  const lines: string[] = [];
  /** `underItem`: children of a list item — a nested list follows its item without a blank line. */
  const emit = (list: readonly DocBlock[], indent: string, underItem = false) => {
    let number = 0;
    let prevList: string | null = null;
    let first = true;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const p = b.props ?? {};
      const inline = Array.isArray(b.content) ? inlineToMarkdown(b.content) : '';
      const listKind = b.type === 'bulletListItem' || b.type === 'numberedListItem' || b.type === 'checkListItem' ? b.type : null;
      // A blank line between blocks (and between different kinds of list), none inside a list.
      const continues = listKind && (prevList === listKind || (first && underItem));
      if (lines.length && lines[lines.length - 1] !== '' && !continues) lines.push('');
      first = false;
      if (b.type !== 'numberedListItem') number = 0;
      let childIndent = indent + '  ';
      switch (b.type) {
        case 'heading': {
          const level = Math.min(6, Math.max(1, Number(p.level) || 1));
          lines.push(`${indent}${'#'.repeat(level)} ${inline}`.trimEnd());
          break;
        }
        case 'bulletListItem':
          lines.push(`${indent}- ${inline}`.trimEnd());
          break;
        case 'numberedListItem': {
          number = number ? number + 1 : Math.max(1, Number(p.start) || 1);
          const marker = `${number}. `;
          lines.push(`${indent}${marker}${inline}`.trimEnd());
          childIndent = indent + ' '.repeat(marker.length);
          break;
        }
        case 'checkListItem':
          lines.push(`${indent}- [${p.checked ? 'x' : ' '}] ${inline}`.trimEnd());
          break;
        case 'codeBlock': {
          const code = inlineText(b.content);
          const fence = code.includes('```') ? '~~~~' : '```';
          lines.push(`${indent}${fence}${typeof p.language === 'string' && p.language !== 'text' ? p.language : ''}`);
          for (const l of code.split('\n')) lines.push(`${indent}${l}`);
          lines.push(`${indent}${fence}`);
          break;
        }
        case 'quote':
          for (const l of (inline || '').split('\n')) lines.push(`${indent}> ${l}`.trimEnd());
          break;
        case 'image':
          lines.push(`${indent}![${escapeText(String(p.caption ?? p.name ?? ''))}](${safeHref(String(p.url ?? ''))})`);
          break;
        case 'boardEmbed':
          lines.push(`${indent}![Live board](${safeHref(String(p.uri ?? ''))})`);
          break;
        case 'divider':
          lines.push(`${indent}---`);
          break;
        case 'table':
          if (b.content && !Array.isArray(b.content)) for (const l of tableToMarkdown(b.content as DocTableContent)) lines.push(`${indent}${l}`);
          break;
        default:
          // Paragraphs, and block types this version does not know: their text.
          if (inline) lines.push(`${indent}${inline.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/, '$1\\$2')}`);
          else if (b.type === 'paragraph' && !b.children?.length) lines.push('');
          else if (!Array.isArray(b.content) && b.content) lines.push(`${indent}${escapeText(inlineText(b.content))}`);
      }
      prevList = listKind;
      if (Array.isArray(b.children) && b.children.length) emit(b.children, childIndent, !!listKind);
    }
  };
  emit(blocks, '');
  // No more than one blank line in a row, none at the ends.
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text ? `${text}\n` : '';
}

// ---- Markdown → blocks ----

const MAX_MD = 2_000_000;

/** Inline Markdown → inline content. */
export function parseInlineMarkdown(src: string, styles: DocStyles = {}): DocInline[] {
  const out: DocInline[] = [];
  const pushText = (text: string, st: DocStyles) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text' && sameStyles(last.styles, st)) last.text += text;
    else out.push({ type: 'text', text, styles: { ...st } });
  };
  let i = 0;
  let plain = '';
  const flushPlain = () => {
    pushText(plain, styles);
    plain = '';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[\\`*_[\]~<>|#+\-.!(){}]/.test(src[i + 1])) {
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const ticks = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        flushPlain();
        let code = src.slice(i + ticks.length, end);
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        pushText(code, { ...styles, code: true });
        i = end + ticks.length;
        continue;
      }
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const img = c === '!';
      const link = matchLink(src, img ? i + 1 : i);
      if (link) {
        flushPlain();
        if (img) pushText(link.label, styles);
        else {
          const inner = parseInlineMarkdown(link.label, styles).filter((n): n is DocText => n.type === 'text');
          out.push({ type: 'link', href: link.href, content: inner.length ? inner : [{ type: 'text', text: link.href, styles: { ...styles } }] });
        }
        i = link.end;
        continue;
      }
    }
    if (c === '<') {
      const m = /^<((?:https?|mailto|freero):[^\s<>]+)>/i.exec(src.slice(i));
      if (m) {
        flushPlain();
        out.push({ type: 'link', href: m[1], content: [{ type: 'text', text: m[1], styles: { ...styles } }] });
        i += m[0].length;
        continue;
      }
    }
    const delim = /^(\*\*|__|~~|\*|_)/.exec(src.slice(i))?.[1];
    if (delim && !(delim === '_' || delim === '__' ? /\w/.test(src[i - 1] ?? '') : false) && src[i + delim.length] && !/\s/.test(src[i + delim.length])) {
      const close = findClose(src, i + delim.length, delim);
      if (close > 0) {
        flushPlain();
        const key: keyof DocStyles = delim === '~~' ? 'strike' : delim.length === 2 ? 'bold' : 'italic';
        for (const n of parseInlineMarkdown(src.slice(i + delim.length, close), { ...styles, [key]: true })) {
          if (n.type === 'text') pushText(n.text, n.styles);
          else out.push(n);
        }
        i = close + delim.length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flushPlain();
  return out;
}

function sameStyles(a: DocStyles, b: DocStyles): boolean {
  const ka = Object.keys(a).filter((k) => a[k as keyof DocStyles]);
  const kb = Object.keys(b).filter((k) => b[k as keyof DocStyles]);
  return ka.length === kb.length && ka.every((k) => b[k as keyof DocStyles]);
}

/** Where a delimiter run opened at `from` closes (not after whitespace), or -1. */
function findClose(src: string, from: number, delim: string): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === '`') {
      const ticks = /^`+/.exec(src.slice(j))![0];
      const end = src.indexOf(ticks, j + ticks.length);
      if (end > 0) {
        j = end + ticks.length - 1;
        continue;
      }
    }
    if (src.startsWith(delim, j) && !/\s/.test(src[j - 1] ?? ' ')) {
      // `**` must not close a single `*` (and the other way round): skip longer runs.
      if (delim.length === 1 && src[j + 1] === delim[0]) {
        const next = findClose(src, j + 2, delim + delim);
        if (next > 0) {
          j = next + 1;
          continue;
        }
      }
      if ((delim === '_' || delim === '__') && /\w/.test(src[j + delim.length] ?? '')) continue;
      if (j > from) return j;
    }
  }
  return -1;
}

/** `[label](href)` starting at `at` (the `[`), or null. */
function matchLink(src: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let j = at;
  for (; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) break;
  }
  if (j >= src.length || src[j + 1] !== '(') return null;
  const m = /^\(\s*<?([^\s)>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(src.slice(j + 1));
  if (!m) return null;
  let href = m[1];
  try {
    href = decodeURI(href);
  } catch {
    /* keep it as written */
  }
  return { label: src.slice(at + 1, j), href, end: j + 1 + m[0].length };
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([\w#+.-]*)/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const splitRow = (line: string) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (t[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
};
const indentOf = (line: string) => /^\s*/.exec(line.replace(/\t/g, '    '))![0].length;

/** Markdown → doc blocks (no ids: the editor or the server gives them). */
export function markdownToDoc(markdown: string): DocBlock[] {
  const lines = markdown.slice(0, MAX_MD).replace(/\r\n?/g, '\n').split('\n');
  const root: DocBlock[] = [];
  // Open list items by indentation, innermost last: where a nested item goes.
  let stack: Array<{ indent: number; block: DocBlock }> = [];
  let para: string[] = [];
  const container = (indent: number): DocBlock[] => {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) return root;
    parent.block.children ??= [];
    return parent.block.children;
  };
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n').replace(/ {2,}\n/g, '\n').replace(/\\\n/g, '\n');
    root.push({ type: 'paragraph', content: parseInlineMarkdown(text.replace(/(?<!\n)\n(?!\n)/g, (m) => m)) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const close = fence[2][0].repeat(fence[2].length);
      const code: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !lines[j].trim().startsWith(close); j++) code.push(lines[j].slice(Math.min(indentOf(lines[j]), fence[1].length)));
      const block: DocBlock = { type: 'codeBlock', props: { language: fence[3] || 'text' }, content: code.length ? [{ type: 'text', text: code.join('\n'), styles: {} }] : [] };
      container(indent).push(block);
      i = j;
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list && !(list[2] === '*' && /^\*\s*\*\s*\*/.test(trimmed)) && !/^[-*_](\s*[-*_]){2,}\s*$/.test(trimmed)) {
      flushPara();
      const marker = list[2];
      let rest = list[3];
      let block: DocBlock;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(rest);
      if (/^\d/.test(marker)) {
        block = { type: 'numberedListItem', content: parseInlineMarkdown(rest) };
        const n = parseInt(marker, 10);
        if (n !== 1 && container(indent) === root && !root.length) block.props = { start: n };
      } else if (task) {
        block = { type: 'checkListItem', props: { checked: task[1] !== ' ' }, content: parseInlineMarkdown(task[2]) };
      } else block = { type: 'bulletListItem', content: parseInlineMarkdown(rest) };
      // Continuation lines of the item (indented, not a new block).
      while (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > indent && !LIST_RE.exec(lines[i + 1]) && !FENCE_RE.exec(lines[i + 1])) {
        rest += `\n${lines[++i].trim()}`;
        block.content = parseInlineMarkdown(task && block.type === 'checkListItem' ? rest.replace(/^\[[ xX]\]\s+/, '') : rest);
      }
      container(indent).push(block);
      stack.push({ indent, block });
      continue;
    }
    // Anything else ends open lists unless it is indented under them (handled as children above).
    if (indent === 0) stack = [];
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      flushPara();
      container(indent).push({ type: 'heading', props: { level: Math.min(heading[1].length, DOC_HEADING_LEVELS[DOC_HEADING_LEVELS.length - 1]) }, content: parseInlineMarkdown(heading[2]) });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}\s*$/.test(trimmed)) {
      flushPara();
      container(indent).push({ type: 'divider' });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushPara();
      const quoted: string[] = [];
      let j = i;
      for (; j < lines.length && lines[j].trim().startsWith('>'); j++) quoted.push(lines[j].trim().replace(/^>\s?/, ''));
      container(indent).push({ type: 'quote', content: parseInlineMarkdown(quoted.join('\n')) });
      i = j - 1;
      continue;
    }
    if (trimmed.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      const rows = [splitRow(trimmed)];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim() && lines[j].includes('|'); j++) rows.push(splitRow(lines[j]));
      const width = rows[0].length;
      container(indent).push({
        type: 'table',
        content: { type: 'tableContent', rows: rows.map((r) => ({ cells: Array.from({ length: width }, (_, k) => parseInlineMarkdown(r[k] ?? '')) })) },
      });
      i = j - 1;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(trimmed);
    if (image && !para.length) {
      let url = image[2];
      try {
        url = decodeURI(url);
      } catch {
        /* as written */
      }
      if (/^freero:\/\/board\//i.test(url)) container(indent).push({ type: 'boardEmbed', props: { uri: url } });
      else container(indent).push({ type: 'image', props: { url, caption: image[1].replace(/\\(.)/g, '$1') } });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return root;
}
