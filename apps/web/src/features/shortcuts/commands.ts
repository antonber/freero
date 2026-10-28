import { Keyboard, SquareChevronRight } from 'lucide-react';
import { defineCommands } from '@engine';
import { SHEET_PANEL } from './lib/sheet';
import { PALETTE_PANEL } from './lib/palette';

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
  {
    id: 'shortcuts.palette',
    icon: SquareChevronRight,
    label: 'Command palette',
    // Mod+/ — Mod+K is taken (item link, and a text link while typing). Matched by the typed
    // character like '?', so layouts where '/' needs Shift (German Shift+7) work too.
    shortcut: 'mod+/',
    menus: ['board'],
    minRole: 'viewer',
    // Never while typing: the shortcut would steal focus from the text being written.
    when: (editor) => !editor.getEditingId(),
    // It doesn't list itself.
    palette: false,
    run(editor) {
      editor.openPanel(PALETTE_PANEL);
    },
  },
]);
