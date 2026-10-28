import { Keyboard } from 'lucide-react';
import { defineCommands } from '@engine';
import { SHEET_PANEL } from './lib/sheet';

export default defineCommands([
  {
    id: 'shortcuts.open',
    icon: Keyboard,
    label: 'Keyboard shortcuts',
    // '?' — matched by the character typed, so it works wherever the layout puts '?'.
    shortcut: 'shift+/',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openPanel(SHEET_PANEL);
    },
  },
]);
