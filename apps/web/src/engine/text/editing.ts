// The contenteditable rules every rich-text editor here shares (an item's text being edited,
// ElementText; a card's description, RichTextEditor): Enter outside a list breaks the line (no
// <div> soup), and a paste is plain text, so foreign HTML never enters the board.
import type { ClipboardEvent, KeyboardEvent } from 'react';

/** Is the caret inside a list item? */
export function caretInList(): boolean {
  const n = window.getSelection()?.anchorNode;
  return !!(n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('li'));
}

/** Enter (no modifier) outside a list inserts a line break; true when it did. */
export function enterAsLineBreak(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || caretInList()) return false;
  e.preventDefault();
  document.execCommand('insertLineBreak');
  return true;
}

/**
 * A lone no-break space between words is an ordinary one: contenteditable writes them around
 * inline formatting and at line ends to keep spaces visible while typing. Runs of spaces keep
 * theirs (they are what keeps two spaces two).
 */
export function plainSpaces(html: string): string {
  return html.replace(/&nbsp;/g, (m, at: number, s: string) => (s[at - 1] === ' ' || s.startsWith(' ', at + m.length) || s.startsWith('&nbsp;', at + m.length) || s.endsWith('&nbsp;', at) ? m : ' '));
}

/** Pastes the clipboard's plain text at the caret. */
export function pasteAsPlainText(e: ClipboardEvent<HTMLElement>): void {
  e.preventDefault();
  e.stopPropagation();
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
}
