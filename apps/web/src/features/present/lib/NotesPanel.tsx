// Presenter notes, edited per slide in a side panel (owners/editors), and read while presenting.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { FrameElement } from '@freero/shared';
import { DockHeader, useCanEdit, useCollection, useElements, useSelection, type Editor } from '@engine';
import { slides } from './model';
import { NOTES_COLLECTION, readNote, setNote, type PresenterNote } from './notes';

export function useNotes(): Map<string, string> {
  const entries = useCollection<PresenterNote>(NOTES_COLLECTION);
  return useMemo(() => new Map(entries.map(([k, v]) => [k, readNote(v)])), [entries]);
}

/** A notes field that writes a moment after typing stops (and on blur), not on every key. */
function NoteField({ editor, frame, value, readOnly, highlight }: { editor: Editor; frame: FrameElement; value: string; readOnly: boolean; highlight: boolean }) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const commit = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNote(editor, frame.id, text);
  };
  return (
    <textarea
      ref={ref}
      className={`fr-present-notes__field${highlight ? ' is-current' : ''}`}
      value={draft}
      readOnly={readOnly}
      placeholder={readOnly ? 'No notes' : 'What to say on this slide…'}
      aria-label={`Notes for ${frame.title || 'untitled frame'}`}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(text), 500);
      }}
      onBlur={() => {
        editing.current = false;
        commit(draft);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function NotesPanel({ editor }: { editor: Editor }) {
  const frames = useElements('frame');
  const list = useMemo(() => slides(frames), [frames]);
  const notes = useNotes();
  const canEdit = useCanEdit();
  const selection = useSelection();
  return (
    <div className="fr-present-notes">
      <DockHeader>
        <h2 className="fr-present-notes__title">Presenter notes</h2>
      </DockHeader>
      <p className="fr-present-notes__hint">
        <Info size={14} />
        <span>Shown only on your screen while you present, never in exports. Anyone who can edit this board can read them.</span>
      </p>
      {!list.length && <p className="fr-present-notes__empty">Add frames to the board: each frame is a slide with its own notes.</p>}
      <ol className="fr-present-notes__list">
        {list.map((f, i) => (
          <li key={f.id} className="fr-present-notes__slide">
            <button type="button" className="fr-present-notes__name" onClick={() => {
                editor.select([f.id]);
                editor.zoomToFit([f.id]);
              }}>
              {i + 1}. {f.title || 'Untitled frame'}
            </button>
            <NoteField editor={editor} frame={f} value={notes.get(f.id) ?? ''} readOnly={!canEdit} highlight={selection.includes(f.id)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The presenter's own notes for the current slide (presentation mode, this screen only). */
export function PresenterNotes({ frameId, onClose }: { frameId: string | null; onClose: () => void }) {
  const notes = useNotes();
  const text = frameId ? notes.get(frameId) ?? '' : '';
  if (!text.trim()) return null;
  return (
    <aside className="fr-present-mynotes" data-fr-interactive="" aria-label="Your notes for this slide">
      <div className="fr-present-mynotes__head">
        <span>Your notes · only you see these</span>
        <button type="button" onClick={onClose} aria-label="Hide notes">
          Hide (N)
        </button>
      </div>
      <div className="fr-present-mynotes__body">{text}</div>
    </aside>
  );
}
