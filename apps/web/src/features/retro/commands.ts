import { History, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { end, getSession, START_DIALOG_ID } from './lib/flow';

import { t } from './messages';
export default defineCommands([
  {
    id: 'retro.start',
    icon: History,
    label: t('runARetrospective'),
    menus: ['board'],
    when: (editor) => !getSession(editor),
    disabledReason: t('aRetrospectiveIsAlreadyRunning'),
    run: (editor) => editor.openPanel(START_DIALOG_ID),
  },
  {
    // Board-menu escape hatch: any editor can close a retro whose facilitator left.
    id: 'retro.end',
    icon: X,
    label: t('endTheRetrospective'),
    menus: ['board'],
    when: (editor) => !!getSession(editor),
    run: (editor) => end(editor),
  },
]);
