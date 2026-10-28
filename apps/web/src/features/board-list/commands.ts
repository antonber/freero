import { ListTree } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

export default defineCommands([
  {
    id: 'board-list.toggle',
    label: 'Board as list',
    icon: ListTree,
    shortcut: 'alt+shift+l',
    minRole: 'viewer',
    menus: ['board'],
    when: (editor) => !editor.getEditingId(),
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
