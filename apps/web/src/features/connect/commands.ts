import { Bot, LayoutGrid } from 'lucide-react';
import { defineCommands } from '@engine';

import { t } from './messages';
export default defineCommands([
  {
    id: 'connect.open',
    label: t('connectAnAiAgent'),
    icon: Bot,
    menus: ['board'],
    minRole: 'viewer',
    // An account's page: not for visitors on a link, the offline sandbox or a board shown inside an assistant.
    when: (editor) => editor.host.board.signedIn !== false && !editor.host.board.embedded && editor.host.board.id !== 'local',
    run: (editor) => editor.host.navigate(`/settings/connect?board=${encodeURIComponent(editor.host.board.id)}`),
  },
  {
    // Everything else that connects (#87): trackers, chat, embeds, calls, sign-in, automation.
    id: 'connect.apps',
    label: t('appsAgents'),
    icon: LayoutGrid,
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.host.board.signedIn !== false && !editor.host.board.embedded && editor.host.board.id !== 'local',
    run: (editor) => editor.host.navigate('/apps'),
  },
]);
