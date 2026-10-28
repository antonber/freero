import { BookmarkPlus, LayoutTemplate } from 'lucide-react';
import { defineCommands } from '@engine';
import { DOCK_ID } from './lib/insert';
import { SAVE_DIALOG_ID } from './lib/saved';

export default defineCommands([
  {
    id: 'templates.open',
    icon: LayoutTemplate,
    label: 'Templates…',
    menus: ['board'],
    run(editor) {
      editor.openDock(editor.getDock() === DOCK_ID ? null : DOCK_ID);
    },
  },
  // Saving copies content into the user's own template library (never writes the board), so
  // anyone who can see the board can do it — like copying — unless the board's workspace doesn't
  // let this user copy its content (Host.board.canExport; the server enforces it too).
  {
    id: 'templates.saveBoard',
    icon: BookmarkPlus,
    label: 'Save board as template…',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.host.board.canExport !== false && editor.getElements().length > 0,
    run(editor) {
      editor.openPanel(SAVE_DIALOG_ID, { scope: 'board' });
    },
  },
  {
    id: 'templates.saveSelection',
    icon: BookmarkPlus,
    label: 'Save as template…',
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => editor.host.board.canExport !== false && editor.getSelection().length > 0,
    run(editor) {
      editor.openPanel(SAVE_DIALOG_ID, { scope: 'selection' });
    },
  },
]);
