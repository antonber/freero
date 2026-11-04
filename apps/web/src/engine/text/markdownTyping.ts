// Markdown-style typing in a rich-text editor (RichTextEditor with `markdownShortcuts`): when a
// space (or Enter) follows what someone typed the Markdown way, it becomes the formatting. At the
// start of a line "1. " starts a numbered list and "- " / "* " a bulleted one; at the caret
// **bold**, *italic*, ~~struck~~, `code`, [label](https://…) and a bare web address become bold,
// italic, struck, inline code and links. Everything goes through execCommand, like the rest of the
// editing stack, so the browser's own undo inside the editor still steps back over it. Text is
// escaped and links are kept only when isSafeHref allows them; the editor sanitizes on output too.
import { escapeHtml, isSafeHref } from '@freero/shared';

const BLOCKS = 'li, p, div, pre';

/** The text from the start of the caret's line to the caret (a <br> or a block starts a line). */
function lineBefore(root: HTMLElement, caret: Range): string {
  const start = caret.startContainer;
  const el = start.nodeType === 1 ? (start as Element) : start.parentElement;
  const found = el?.closest(BLOCKS);
  const block = found && root.contains(found) ? found : root;
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(caret.startContainer, caret.startOffset);
  let text = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) text += (n as Text).data;
    else if (n.nodeName === 'BR' || /^(LI|P|DIV|PRE|UL|OL)$/.test(n.nodeName)) text = '';
    n.childNodes.forEach(walk);
  };
  r.cloneContents().childNodes.forEach(walk);
  return text;
}

function selectInText(node: Text, from: number, to: number) {
  const r = document.createRange();
  r.setStart(node, from);
  r.setEnd(node, to);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

/** A web address without the punctuation that ends the sentence around it. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?*_~]+$/, '');
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
  return u;
}

interface Inline {
  /** Where the replaced text starts in the caret's text node. */
  from: number;
  html: string;
}

const WRAPS: Array<{ re: RegExp; tag: string }> = [
  { re: /`([^`\n]+)`$/, tag: 'code' },
  { re: /\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*$/, tag: 'b' },
  { re: /(?:^|[^\w_])(__([^_\s](?:[^_\n]*[^_\s])?)__)$/, tag: 'b' },
  { re: /~~([^~\s](?:[^~\n]*[^~\s])?)~~$/, tag: 's' },
  { re: /(?:^|[^*])(\*([^*\s](?:[^*\n]*[^*\s])?)\*)$/, tag: 'i' },
  { re: /(?:^|[^\w_])(_([^_\s](?:[^_\n]*[^_\s])?)_)$/, tag: 'i' },
];

function inlineAt(before: string, inLink: boolean): Inline | null {
  const link = /\[([^\]\n]+)\]\(([^()\s]+)\)$/.exec(before);
  if (link) {
    if (!isSafeHref(link[2])) return null;
    return { from: link.index, html: `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>` };
  }
  for (const { re, tag } of WRAPS) {
    const m = re.exec(before);
    if (!m) continue;
    // With a context group (the character before the delimiter), the match proper is group 1.
    const whole = m.length > 2 ? m[1] : m[0];
    const inner = m.length > 2 ? m[2] : m[1];
    return { from: before.length - whole.length, html: `<${tag}>${escapeHtml(inner)}</${tag}>` };
  }
  if (inLink) return null;
  const url = /(?:^|\s)(https?:\/\/[^\s<>"']+)$/i.exec(before);
  if (url) {
    const href = trimUrl(url[1]);
    if (href.length <= 'https://'.length || !isSafeHref(href)) return null;
    const rest = url[1].slice(href.length);
    return { from: before.length - url[1].length, html: `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>${escapeHtml(rest)}` };
  }
  return null;
}

/**
 * Applies the shortcut that `key` (a space or Enter, about to be typed at the caret) completes.
 * Returns true when the key was used up (the space is part of what was inserted); after an Enter it
 * returns false, so the line still breaks.
 */
export function applyMarkdownShortcut(root: HTMLElement, key: ' ' | 'Enter'): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const caret = sel.getRangeAt(0);
  const node = caret.startContainer;
  if (!root.contains(node) || node.nodeType !== 3) return false;
  const text = node as Text;
  const parent = text.parentElement;
  if (parent?.closest('pre, code')) return false;
  const offset = caret.startOffset;

  if (key === ' ' && !parent?.closest('li')) {
    const line = lineBefore(root, caret);
    const ordered = /^\d{1,3}[.)]$/.test(line);
    if ((ordered || /^[-*+]$/.test(line)) && text.data.slice(offset - line.length, offset) === line) {
      selectInText(text, offset - line.length, offset);
      document.execCommand('delete');
      document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
      return true;
    }
  }

  const hit = inlineAt(text.data.slice(0, offset), !!parent?.closest('a'));
  if (!hit) return false;
  selectInText(text, hit.from, offset);
  // The space goes in after the formatting, outside it, so what is typed next is plain again. A
  // no-break one: Chrome drops a plain space that ends inserted HTML and leaves the caret inside.
  document.execCommand('insertHTML', false, key === ' ' ? `${hit.html}&nbsp;` : hit.html);
  return key === ' ';
}
