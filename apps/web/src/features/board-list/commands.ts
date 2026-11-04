import { ListTree } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

import { t } from './messages';
export default defineCommands([
  {
    id: 'board-list.toggle',
    label: t('boardAsList'),
    icon: ListTree,
    shortcut: 'alt+shift+l',
    minRole: 'viewer',
    menus: ['board'],
    when: (editor) => !editor.getEditingId(),
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
