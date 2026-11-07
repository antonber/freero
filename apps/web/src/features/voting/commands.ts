import { Trophy, Vote } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { getSession, type VotingValue } from './lib/voting';
import { START_DIALOG_ID } from './lib/state';
import { end, start } from './lib/actions';

import { t } from './messages';
const session = (editor: Editor) => getSession(editor.collection<VotingValue>('voting'));

export default defineCommands([
  {
    id: 'voting.start',
    icon: Vote,
    label: t('startVoting'),
    menus: ['board'],
    when: (editor) => !session(editor)?.active,
    // Other features (a retro's vote phase) may start it directly: args { votesPerUser, hideResults?,
    // anonymous? (default true, as in the dialog), maxPerItem?, minutes?, title? }.
    run: (editor, args) => {
      if (typeof args?.votesPerUser !== 'number') return editor.openPanel(START_DIALOG_ID);
      start(editor, {
        title: typeof args.title === 'string' ? args.title : t('vote'),
        votesPerUser: args.votesPerUser,
        hideResults: args.hideResults !== false,
        anonymous: args.anonymous !== false,
        maxPerItem: typeof args.maxPerItem === 'number' ? args.maxPerItem : null,
        durationMs: typeof args.minutes === 'number' ? args.minutes * 60_000 : null,
        elementIds: null,
      });
    },
  },
  {
    // Board-menu escape hatch so any editor can close a session whose facilitator left.
    id: 'voting.end',
    icon: Trophy,
    label: t('endVoting'),
    menus: ['board'],
    when: (editor) => !!session(editor)?.active,
    // args { id } (a retro): ends only that vote.
    run: (editor, args) => end(editor, typeof args?.id === 'string' ? args.id : undefined),
  },
]);
