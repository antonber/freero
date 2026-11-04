import { FileSpreadsheet, Sheet } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { CSV_IMPORT_DIALOG, exportCsv } from './lib/actions';

import { t } from './messages';
// Exporting never writes the board, so viewers can — unless the board's workspace doesn't let this
// user export its boards (Host.board.canExport; the server refuses and audits the report too).
const mayExport = (editor: Editor) => editor.host.board.canExport !== false;

export default defineCommands([
  {
    id: 'csv.export',
    icon: Sheet,
    label: t('exportStickiesAndCardsAs'),
    menus: ['board'],
    minRole: 'viewer',
    when: mayExport,
    disabledReason: () => t('thisWorkspaceDoesnTLet'),
    run(editor) {
      void exportCsv(editor);
    },
  },
  {
    id: 'csv.import',
    icon: FileSpreadsheet,
    label: t('importStickiesOrCardsFrom'),
    menus: ['board'],
    run(editor) {
      editor.openPanel(CSV_IMPORT_DIALOG);
    },
  },
]);
