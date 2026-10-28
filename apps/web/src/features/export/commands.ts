import { ClipboardCopy, FileDown, ImageDown } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { copySelectionAsImage } from './lib/exporters';
import { EXPORT_DIALOG } from './lib/dialog';

// Exporting never writes the board, so viewers can do it too — unless the board's workspace
// doesn't let this user export its boards (Host.board.canExport, a workspace policy).
const allowed = (editor: Editor) => editor.host.board.canExport !== false;

export default defineCommands([
  {
    id: 'export.image',
    icon: ImageDown,
    label: 'Export board as image…',
    menus: ['board'],
    minRole: 'viewer',
    when: allowed,
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
    when: allowed,
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
    when: (editor) => allowed(editor) && editor.getSelection().length > 0,
    run(editor) {
      void copySelectionAsImage(editor);
    },
  },
]);
