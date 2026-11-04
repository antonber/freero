import { Layers } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

import { t } from './messages';
export default defineCommands([
  {
    id: 'layers.togglePanel',
    label: t('layers'),
    icon: Layers,
    shortcut: 'alt+l',
    minRole: 'viewer',
    menus: ['board'],
    when: (editor) => !editor.getEditingId(),
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
