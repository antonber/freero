import { Spade, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { end, getRound, itemsToEstimate } from './lib/actions';
import { START_DIALOG_ID } from './lib/ids';

export default defineCommands([
  {
    id: 'estimation.start',
    icon: Spade,
    label: 'Estimate with planning poker…',
    menus: ['board', 'context'],
    when: (editor) => itemsToEstimate(editor).length > 0,
    disabledReason: 'Select cards or stickies to estimate (or add cards to the board)',
    run: (editor) => editor.openPanel(START_DIALOG_ID),
  },
  {
    // Board-menu escape hatch: any editor can close a round whose facilitator left.
    id: 'estimation.end',
    icon: X,
    label: 'End planning poker',
    menus: ['board'],
    when: (editor) => !!getRound(editor),
    run: (editor) => end(editor),
  },
]);
