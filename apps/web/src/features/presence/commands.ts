import { defineCommands } from '@engine';
import { bringEveryone, presenceStore, stopFollowing } from './lib/state';

export default defineCommands([
  {
    id: 'presence.bringEveryone',
    label: 'Bring everyone to me',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.getPeers().some((p) => p.user?.id !== editor.user.id),
    run: bringEveryone,
  },
  {
    id: 'presence.stopFollowing',
    label: 'Stop following',
    minRole: 'viewer',
    when: (editor) => !!presenceStore(editor).getState().following,
    run: stopFollowing,
  },
]);
