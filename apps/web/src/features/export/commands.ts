import { ClipboardCopy, FileDown, ImageDown } from 'lucide-react';
import { defineCommands } from '@engine';
import { copySelectionAsImage } from './lib/exporters';
import { EXPORT_DIALOG } from './lib/dialog';

// Exporting never writes the board, so viewers can do it too.
export default defineCommands([
  {
    id: 'export.image',
    icon: ImageDown,
    label: 'Export board as image…',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openPanel(EXPORT_DIALOG, { kind: 'image' });
    },
  },
  {
    id: 'export.pdf',
    icon: FileDown,
    label: 'Export frames as PDF…',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openPanel(EXPORT_DIALOG, { kind: 'pdf' });
    },
  },
  {
    id: 'export.copyImage',
    icon: ClipboardCopy,
    label: 'Copy selection as image',
    menus: ['board', 'context'],
    minRole: 'viewer',
    when: (editor) => editor.getSelection().length > 0,
    run(editor) {
      void copySelectionAsImage(editor);
    },
  },
]);
