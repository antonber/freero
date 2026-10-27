import { defineCommands } from '@engine';
import { copySelectionAsImage } from './lib/exporters';
import { openExportDialog } from './lib/store';

// Exporting never writes the board, so viewers can do it too.
export default defineCommands([
  {
    id: 'export.image',
    label: 'Export board as image…',
    menus: ['board'],
    minRole: 'viewer',
    run() {
      openExportDialog('image');
    },
  },
  {
    id: 'export.pdf',
    label: 'Export frames as PDF…',
    menus: ['board'],
    minRole: 'viewer',
    run() {
      openExportDialog('pdf');
    },
  },
  {
    id: 'export.copyImage',
    label: 'Copy selection as image',
    menus: ['board', 'context'],
    minRole: 'viewer',
    when: (editor) => editor.getSelection().length > 0,
    run(editor) {
      void copySelectionAsImage(editor);
    },
  },
]);
