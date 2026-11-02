// The card description editor ("Open details") as a session: which card it edits, the text it
// opened with and what was typed since. Only an open session writes, only to the card it was
// opened on, and only text the person changed. Closing an editor that was never opened (the
// format toolbar unmounting when a card is deselected, dragged or its title edited) writes
// nothing: it once wrote the never-opened editor's empty text over the notes of every card clicked.
import type { CardElement } from '@freero/shared';
import { plainToRichText, richTextToPlain, type Editor } from '@engine';

const trimEnd = (s: string) => s.replace(/\s+$/, '');

export interface DetailsSession {
  /** The card being edited, or null while the editor is closed. */
  readonly cardId: string | null;
  /** Starts editing card `id`; returns its description as plain text for the text area. */
  open(id: string): string;
  /** The text area's current value. */
  type(value: string): void;
  /** Writes what was typed, if the person changed it (a no-op without an open session). */
  flush(): void;
  /** Writes what was typed and ends the session. */
  close(): void;
}

export function detailsSession(editor: Pick<Editor, 'getElement' | 'update'>): DetailsSession {
  let s: { id: string; opened: string; text: string } | null = null;
  const flush = () => {
    if (!s) return;
    const typed = trimEnd(s.text);
    // Untouched: keep whatever the card holds now (someone else's edit, formatting) as it is.
    if (typed === trimEnd(s.opened)) return;
    const card = editor.getElement<CardElement>(s.id);
    if (!card) return;
    s.opened = typed;
    if (typed !== trimEnd(richTextToPlain(card.description ?? ''))) editor.update<CardElement>(s.id, { description: plainToRichText(typed) });
  };
  return {
    get cardId() {
      return s?.id ?? null;
    },
    open(id) {
      const text = richTextToPlain(editor.getElement<CardElement>(id)?.description ?? '');
      s = { id, opened: text, text };
      return text;
    },
    type(value) {
      if (s) s.text = value;
    },
    flush,
    close() {
      flush();
      s = null;
    },
  };
}
