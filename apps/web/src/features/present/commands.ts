import { MonitorPlay, NotebookText, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { presentStore, startPresenting, stopPresenting } from './lib/session';
import { NOTES_PANEL_ID } from './lib/notes';

export default defineCommands([
  {
    id: 'present.start',
    icon: MonitorPlay,
    label: 'Present',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !presentStore(editor).getState().presenting,
    run: (editor) => startPresenting(editor),
  },
  {
    id: 'present.notes',
    icon: NotebookText,
    label: 'Presenter notes',
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
    id: 'present.stop',
    icon: X,
    label: 'Exit presentation',
    minRole: 'viewer',
    when: (editor) => presentStore(editor).getState().presenting,
    run: stopPresenting,
  },
]);
