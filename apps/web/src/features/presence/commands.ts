import { EyeOff, Megaphone } from 'lucide-react';
import { defineCommands } from '@engine';
import { bringEveryone } from './lib/state';

export default defineCommands([
  {
    id: 'presence.bringEveryone',
    icon: Megaphone,
    label: 'Bring everyone to me',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.getPeers().some((p) => p.user?.id !== editor.user.id),
    run: bringEveryone,
  },
  {
    id: 'presence.stopFollowing',
    icon: EyeOff,
    label: 'Stop following',
    minRole: 'viewer',
    when: (editor) => !!editor.getFollowing() && !editor.getFollowing()?.locked,
    run: (editor) => editor.follow(null),
  },
]);
