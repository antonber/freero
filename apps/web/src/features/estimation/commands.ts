import { Spade, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { end, getRound, itemsToEstimate } from './lib/actions';
import { START_DIALOG_ID } from './lib/ids';

import { t } from './messages';
export default defineCommands([
  {
    id: 'estimation.start',
    icon: Spade,
    label: t('estimateWithPlanningPoker'),
    menus: ['board', 'context'],
    when: (editor) => itemsToEstimate(editor).length > 0,
    disabledReason: t('selectCardsOrStickiesTo'),
    run: (editor) => editor.openPanel(START_DIALOG_ID),
  },
  {
    // Board-menu escape hatch: any editor can close a round whose facilitator left.
    id: 'estimation.end',
    icon: X,
    label: t('endPlanningPoker'),
    menus: ['board'],
    when: (editor) => !!getRound(editor),
    run: (editor) => end(editor),
  },
]);
