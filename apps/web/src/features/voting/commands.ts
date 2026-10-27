import { defineCommands, type Editor } from '@engine';
import { getSession, type VotingValue } from './lib/voting';
import { useVotingUi } from './lib/state';
import { end } from './lib/actions';

const session = (editor: Editor) => getSession(editor.collection<VotingValue>('voting'));

export default defineCommands([
  {
    id: 'voting.start',
    label: 'Start voting…',
    menus: ['board'],
    when: (editor) => !session(editor)?.active,
    run: () => useVotingUi.getState().openDialog(),
  },
  {
    // Board-menu escape hatch so any editor can close a session whose facilitator left.
    id: 'voting.end',
    label: 'End voting',
    menus: ['board'],
    when: (editor) => !!session(editor)?.active,
    run: (editor) => end(editor),
  },
]);
