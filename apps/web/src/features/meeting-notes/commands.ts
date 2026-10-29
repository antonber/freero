import { NotebookPen } from 'lucide-react';
import { defineCommands } from '@engine';
import { DIALOG } from './lib/insert';

export default defineCommands([
  {
    id: 'meeting-notes.import',
    icon: NotebookPen,
    label: 'Import meeting notes…',
    menus: ['board'],
    when: (editor) => editor.can('editor'),
    disabledReason: 'You need edit access to import',
    run(editor) {
      editor.openPanel(DIALOG, { at: editor.getViewportCenter() });
    },
  },
]);
