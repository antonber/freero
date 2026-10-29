import { Bot } from 'lucide-react';
import { defineCommands } from '@engine';

export default defineCommands([
  {
    id: 'connect.open',
    label: 'Connect an AI agent…',
    icon: Bot,
    menus: ['board'],
    minRole: 'viewer',
    // An account's page: not for visitors on a link, the offline sandbox or a board shown inside an assistant.
    when: (editor) => editor.host.board.signedIn !== false && !editor.host.board.embedded && editor.host.board.id !== 'local',
    run: (editor) => editor.host.navigate(`/settings/connect?board=${encodeURIComponent(editor.host.board.id)}`),
  },
]);
