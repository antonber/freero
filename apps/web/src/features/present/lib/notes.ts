// Presenter notes (KAI-130): the `presenterNotes` collection, frame id -> PresenterNote. The frame
// feature stays the only writer of frame fields; notes live beside them, are not elements (so never
// in exports or thumbnails), and show in presentation mode only on the presenter's own screen.
// They are not secret: everyone who can see the frame has them (the UI says so). Like the frame, a
// frame's notes are withheld inside a hidden frame or a private draft (engine: element content).
import type { Editor } from '@engine';

export const NOTES_COLLECTION = 'presenterNotes';
export const NOTES_PANEL_ID = 'present.notes';
const MAX_LENGTH = 10_000;

export interface PresenterNote {
  text: string;
  by: string;
  at: number;
}

export function readNote(v: unknown): string {
  const n = v as Partial<PresenterNote> | undefined;
  return typeof n?.text === 'string' ? n.text : '';
}

export function setNote(editor: Editor, frameId: string, text: string): void {
  if (!editor.can('editor') || editor.getElement(frameId)?.type !== 'frame') return;
  const notes = editor.collection<PresenterNote>(NOTES_COLLECTION);
  const clean = text.slice(0, MAX_LENGTH);
  if (readNote(notes.get(frameId)) === clean) return;
  if (!clean.trim()) notes.delete(frameId);
  else notes.set(frameId, { text: clean, by: editor.user.id, at: editor.host.serverNow() });
}
