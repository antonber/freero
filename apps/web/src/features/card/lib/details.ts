// The card description editor ("Open details") as a session: which card it edits, the rich text it
// opened with and what was typed since. Only an open session writes, only to the card it was
// opened on, and only text the person changed. Closing an editor that was never opened (the
// format toolbar unmounting when a card is deselected, dragged or its title edited) writes
// nothing: it once wrote the never-opened editor's empty text over the notes of every card clicked.
import type { CardElement } from '@freero/shared';
import type { Editor } from '@engine';

/** Trailing line breaks and space a contenteditable leaves behind are not a change. */
const settled = (html: string) => html.replace(/(\s|&nbsp;|<br\s*\/?>)+$/i, '');

export interface DetailsSession {
  /** The card being edited, or null while the editor is closed. */
  readonly cardId: string | null;
  /** Starts editing card `id`; returns its description (rich text) for the editor. */
  open(id: string): string;
  /** The editor's current rich text (sanitized: RichTextEditor's onChange). */
  type(html: string): void;
  /** Writes what was typed, if the person changed it (a no-op without an open session). */
  flush(): void;
  /** Writes what was typed and ends the session. */
  close(): void;
}

export function detailsSession(editor: Pick<Editor, 'getElement' | 'update'>): DetailsSession {
  let s: { id: string; opened: string; html: string } | null = null;
  const flush = () => {
    if (!s) return;
    const typed = settled(s.html);
    // Untouched: keep whatever the card holds now (someone else's edit) as it is.
    if (typed === settled(s.opened)) return;
    const card = editor.getElement<CardElement>(s.id);
    if (!card) return;
    s.opened = typed;
    if (typed !== settled(card.description ?? '')) editor.update<CardElement>(s.id, { description: typed });
  };
  return {
    get cardId() {
      return s?.id ?? null;
    },
    open(id) {
      const html = editor.getElement<CardElement>(id)?.description ?? '';
      s = { id, opened: html, html };
      return html;
    },
    type(html) {
      if (s) s.html = html;
    },
    flush,
    close() {
      flush();
      s = null;
    },
  };
}
