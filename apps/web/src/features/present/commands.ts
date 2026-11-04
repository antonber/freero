import { MonitorPlay, NotebookText, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { presentStore, startPresenting, stopPresenting } from './lib/session';
import { NOTES_PANEL_ID, setNote } from './lib/notes';

import { t } from './messages';
export default defineCommands([
  {
    id: 'present.start',
    icon: MonitorPlay,
    label: t('present'),
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !presentStore(editor).getState().presenting,
    run: (editor) => startPresenting(editor),
  },
  {
    id: 'present.notes',
    icon: NotebookText,
    label: t('presenterNotes'),
    menus: ['board', 'context'],
    minRole: 'viewer',
    // In the context menu only for a frame (its notes); always in the board menu.
    when: (editor) => {
      const sel = editor.getSelection();
      return sel.length === 0 || (sel.length === 1 && editor.getElement(sel[0])?.type === 'frame');
    },
    run: (editor) => editor.openDock(NOTES_PANEL_ID),
  },
  {
    // The slide deck (features/frame) edits speaker notes through this: present owns the notes.
    id: 'present.setNote',
    label: t('setPresenterNotes'),
    run(editor, args) {
      const frameId = typeof args?.frameId === 'string' ? args.frameId : null;
      const text = typeof args?.text === 'string' ? args.text : null;
      if (frameId && text !== null) setNote(editor, frameId, text);
    },
  },
  {
    id: 'present.stop',
    icon: X,
    label: t('exitPresentation'),
    minRole: 'viewer',
    when: (editor) => presentStore(editor).getState().presenting,
    run: stopPresenting,
  },
]);
