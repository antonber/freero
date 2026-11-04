import { ArchiveRestore, ClipboardCopy, FileDown, ImageDown } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { copySelectionAsImage } from './lib/exporters';
import { EXPORT_DIALOG } from './lib/dialog';

import { t } from './messages';
// Exporting never writes the board, so viewers can do it too — unless the board's workspace
// doesn't let this user export its boards (Host.board.canExport, a workspace policy).
const allowed = (editor: Editor) => editor.host.board.canExport !== false;

export default defineCommands([
  {
    id: 'export.image',
    icon: ImageDown,
    label: t('exportBoardAsImage'),
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
    label: t('exportFramesAsPdf'),
    menus: ['board'],
    minRole: 'viewer',
    when: allowed,
    run(editor) {
      editor.openPanel(EXPORT_DIALOG, { kind: 'pdf' });
    },
  },
  {
    // A backup of the whole board (KAI-137): built by the server, which applies the same policy.
    id: 'export.backup',
    icon: ArchiveRestore,
    label: t('downloadBoardBackupFreero'),
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => allowed(editor) && !!editor.host.downloadBackup,
    run(editor) {
      const download = editor.host.downloadBackup;
      if (!download) return;
      editor.host.notify(t('preparingTheBackup'));
      download().then(
        () => editor.host.notify(t('backupDownloadedRestoreItFrom'), 'success'),
        (e: unknown) => editor.host.notify(e instanceof Error ? e.message : t('couldNotMakeABackup'), 'error'),
      );
    },
  },
  {
    id: 'export.copyImage',
    icon: ClipboardCopy,
    label: t('copySelectionAsImage'),
    menus: ['board', 'context'],
    minRole: 'viewer',
    when: (editor) => allowed(editor) && editor.getSelection().length > 0,
    run(editor) {
      void copySelectionAsImage(editor);
    },
  },
]);
