import { Keyboard } from 'lucide-react';
import { defineCommands } from '@engine';
import { SHEET_PANEL } from './lib/sheet';

export default defineCommands([
  {
    id: 'shortcuts.open',
    icon: Keyboard,
    label: 'Keyboard shortcuts',
    // '?' — matched by physical key (Slash) with Shift, like the rest of the router.
    shortcut: 'shift+/',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openPanel(SHEET_PANEL);
    },
  },
]);
