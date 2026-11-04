import { History } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

import { t } from './messages';
export default defineCommands([
  {
    id: 'history.togglePanel',
    label: t('versionHistory'),
    icon: History,
    menus: ['board'],
    // Editors and owners only: older versions can hold content removed before the board was
    // shared with viewers / commenters (the server enforces the same).
    minRole: 'editor',
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
