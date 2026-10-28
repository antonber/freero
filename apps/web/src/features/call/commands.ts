import { Phone } from 'lucide-react';
import { defineCommands } from '@engine';
import { CALL_DIALOG } from './lib/call';

export default defineCommands([
  {
    id: 'call.setup',
    icon: Phone,
    label: 'Call link…',
    menus: ['board'],
    // Only where there is a server to keep it (not the offline sandbox, not guests).
    when: (editor) => !!editor.host.call && editor.host.board.signedIn !== false,
    disabledReason: () => 'Call links need a board on a Freero server',
    run(editor) {
      editor.openPanel(CALL_DIALOG);
    },
  },
]);
