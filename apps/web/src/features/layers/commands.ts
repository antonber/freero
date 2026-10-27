import { Layers } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

export default defineCommands([
  {
    id: 'layers.togglePanel',
    label: 'Layers',
    icon: Layers,
    shortcut: 'alt+l',
    minRole: 'viewer',
    menus: ['board'],
    when: (editor) => !editor.getEditingId(),
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
