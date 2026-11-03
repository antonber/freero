// Presenter notes in a window of their own (#146): for a second screen. The window is a portal of
// this board's React tree, so it follows the current slide as it changes, and it closes with the
// presentation. It shows the slide, its notes, the next slide and the time presenting.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@engine';
import { useElements } from '@engine';
import { currentPosition, slides } from './model';
import { useNotes } from './NotesPanel';
import { presentStore, step, usePresent } from './session';

const FEATURES = 'popup=yes,width=520,height=680';
/** Closing waits a tick: a remount right away (React's development double-mount) keeps the same window. */
const closing = new Map<string, ReturnType<typeof setTimeout>>();

/** Copies the page's styles into the popup, so it looks like Freero. */
function copyStyles(from: Document, to: Document) {
  for (const node of Array.from(from.querySelectorAll('style, link[rel="stylesheet"]'))) to.head.appendChild(node.cloneNode(true));
}

function useClock(since: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Notes({ editor, startedAt }: { editor: Editor; startedAt: number }) {
  const frames = useElements('frame');
  const list = useMemo(() => slides(frames), [frames]);
  const notes = useNotes();
  const frameId = usePresent(editor, (s) => s.frameId);
  const position = usePresent(editor, (s) => s.position);
  const pos = currentPosition(list, frameId, position);
  const current = pos >= 0 ? list[pos] : null;
  const next = pos >= 0 ? list[pos + 1] : undefined;
  const clock = useClock(startedAt);
  const text = current ? (notes.get(current.id) ?? '') : '';
  return (
    <div className="fr-present-window">
      <header className="fr-present-window__head">
        <span>{list.length ? `Slide ${pos + 1} of ${list.length}` : 'Whole board'}</span>
        <span className="fr-present-window__clock" aria-label="Time presenting">
          {clock}
        </span>
      </header>
      <h1 className="fr-present-window__title">{current?.title || (list.length ? 'Untitled frame' : 'No frames')}</h1>
      <div className={`fr-present-window__notes${text.trim() ? '' : ' is-empty'}`} aria-live="polite">
        {text.trim() ? text : 'No notes for this slide.'}
      </div>
      <footer className="fr-present-window__foot">
        <span>Next: {next ? next.title || 'Untitled frame' : 'the end'}</span>
        <span className="fr-present-window__nav">
          <button type="button" disabled={pos <= 0} onClick={() => step(editor, -1)}>
            ← Previous
          </button>
          <button type="button" disabled={pos < 0 || pos >= list.length - 1} onClick={() => step(editor, 1)}>
            Next →
          </button>
        </span>
      </footer>
    </div>
  );
}

/**
 * Opens the notes window while mounted (the presenter overlay mounts it while presenting with
 * "notes in a window" on) and closes it when unmounted. Closing the window turns the option off.
 */
export function NotesWindow({ editor }: { editor: Editor }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    const name = `freero-notes-${editor.boardId}`;
    clearTimeout(closing.get(name));
    closing.delete(name);
    const w = window.open('', name, FEATURES);
    if (!w) {
      editor.host.notify('Your browser blocked the notes window. Allow pop-ups for Freero and try again.', 'error');
      presentStore(editor).setState({ notesWindow: false });
      return;
    }
    w.document.head.replaceChildren();
    w.document.body.replaceChildren();
    w.document.title = 'Presenter notes · Freero';
    copyStyles(document, w.document);
    w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? '';
    const root = w.document.createElement('div');
    w.document.body.appendChild(root);
    // Keys in the notes window drive the deck too.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') step(editor, 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(editor, -1);
    };
    w.addEventListener('keydown', onKey);
    const closed = () => presentStore(editor).setState({ notesWindow: false });
    w.addEventListener('pagehide', closed);
    setHost(root);
    return () => {
      w.removeEventListener('pagehide', closed);
      w.removeEventListener('keydown', onKey);
      closing.set(
        name,
        setTimeout(() => {
          closing.delete(name);
          w.close();
        }, 0),
      );
      setHost(null);
    };
  }, [editor]);
  return host ? createPortal(<Notes editor={editor} startedAt={startedAt} />, host) : null;
}
