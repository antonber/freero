import { MessageSquareWarning } from 'lucide-react';
import { defineCommands } from '@engine';

import { t } from './messages';
// The dialog itself is the app's (it works on every page, not only on boards): the board menu and
// the shortcut hand over to it through the Host. Not for abuse — that is features/report.
export default defineCommands([
  {
    id: 'problem-report.open',
    icon: MessageSquareWarning,
    label: t('reportAProblem'),
    // The same on every page (the app answers it outside boards).
    shortcut: 'mod+alt+p',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !!editor.host.reportProblem,
    run(editor) {
      editor.host.reportProblem?.({ role: editor.getRole() });
    },
  },
]);
