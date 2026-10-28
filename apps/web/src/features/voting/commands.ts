import { Trophy, Vote } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { getSession, type VotingValue } from './lib/voting';
import { START_DIALOG_ID } from './lib/state';
import { end, start } from './lib/actions';

const session = (editor: Editor) => getSession(editor.collection<VotingValue>('voting'));

export default defineCommands([
  {
    id: 'voting.start',
    icon: Vote,
    label: 'Start voting…',
    menus: ['board'],
    when: (editor) => !session(editor)?.active,
    // Other features (a retro's vote phase) may start it directly: args { votesPerUser, hideResults?, title? }.
    run: (editor, args) => {
      if (typeof args?.votesPerUser !== 'number') return editor.openPanel(START_DIALOG_ID);
      start(editor, {
        title: typeof args.title === 'string' ? args.title : 'Vote',
        votesPerUser: args.votesPerUser,
        hideResults: args.hideResults !== false,
        elementIds: null,
      });
    },
  },
  {
    // Board-menu escape hatch so any editor can close a session whose facilitator left.
    id: 'voting.end',
    icon: Trophy,
    label: 'End voting',
    menus: ['board'],
    when: (editor) => !!session(editor)?.active,
    run: (editor) => end(editor),
  },
]);
