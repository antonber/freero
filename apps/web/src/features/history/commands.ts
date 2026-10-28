import { History } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

export default defineCommands([
  {
    id: 'history.togglePanel',
    label: 'Version history',
    icon: History,
    menus: ['board'],
    // Editors and owners only: older versions can hold content removed before the board was
    // shared with viewers / commenters (the server enforces the same).
    minRole: 'editor',
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
