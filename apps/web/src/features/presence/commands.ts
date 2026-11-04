import { EyeOff, Megaphone } from 'lucide-react';
import { defineCommands } from '@engine';
import { bringEveryone, presenceStore } from './lib/state';
import { newTally } from './lib/model';

import { t } from './messages';
export default defineCommands([
  {
    id: 'presence.bringEveryone',
    icon: Megaphone,
    label: t('bringEveryoneToMe'),
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => editor.getPeers().some((p) => p.user?.id !== editor.user.id),
    run: bringEveryone,
  },
  {
    // Presentation mode (features/present) asks for reaction counts while it runs: args { on }.
    // Turning it off (with no facilitation session of yours running) clears the counts.
    id: 'presence.countReactions',
    label: t('countReactions'),
    minRole: 'viewer',
    run(editor, args) {
      const on = args?.on === true;
      const store = presenceStore(editor);
      if (store.getState().presenting === on) return;
      store.setState({ presenting: on, ...(on ? {} : { tally: newTally() }) });
    },
  },
  {
    id: 'presence.stopFollowing',
    icon: EyeOff,
    label: t('stopFollowing'),
    minRole: 'viewer',
    when: (editor) => !!editor.getFollowing() && !editor.getFollowing()?.locked,
    run: (editor) => editor.follow(null),
  },
]);
