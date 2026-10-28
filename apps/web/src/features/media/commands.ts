import { Download } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { downloadBlockedReason, downloadItem, isDownloadable } from './lib/download';

const selectedItem = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return isDownloadable(el) && el.src ? el : null;
};

export default defineCommands([
  {
    id: 'media.download',
    label: 'Download',
    icon: Download,
    menus: ['context'],
    // Viewers too: the server decides by the workspace's downloads policy.
    minRole: 'viewer',
    when: (editor) => !!selectedItem(editor) && !downloadBlockedReason(editor),
    run(editor) {
      const el = selectedItem(editor);
      if (el) void downloadItem(editor, el);
    },
  },
]);
