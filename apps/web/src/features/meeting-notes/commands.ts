import { NotebookPen } from 'lucide-react';
import { defineCommands } from '@engine';
import { DIALOG } from './lib/insert';

import { t } from './messages';
export default defineCommands([
  {
    id: 'meeting-notes.import',
    icon: NotebookPen,
    label: t('importMeetingNotes'),
    menus: ['board'],
    when: (editor) => editor.can('editor'),
    disabledReason: t('youNeedEditAccessTo'),
    run(editor) {
      editor.openPanel(DIALOG, { at: editor.getViewportCenter() });
    },
  },
]);
