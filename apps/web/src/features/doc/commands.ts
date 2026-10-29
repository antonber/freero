import { Download, ExternalLink } from 'lucide-react';
import type { DocElement } from '@freero/shared';
import { defineCommands, type Editor } from '@engine';
import { docIdOf } from './lib/state';

/** The one selected doc item's doc id, or null. */
function selectedDoc(editor: Editor): string | null {
  const ids = editor.getSelection();
  if (ids.length !== 1) return null;
  const el = editor.getElement<DocElement>(ids[0]);
  return el?.type === 'doc' ? docIdOf(el.uri) : null;
}

export default defineCommands([
  {
    id: 'doc.open',
    label: 'Open doc',
    icon: ExternalLink,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!selectedDoc(editor),
    run(editor) {
      const id = selectedDoc(editor);
      if (id) editor.host.navigate(`/doc/${encodeURIComponent(id)}`);
    },
  },
  {
    id: 'doc.exportMarkdown',
    label: 'Export doc as Markdown',
    icon: Download,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!selectedDoc(editor) && !!editor.host.docs,
    run(editor) {
      const id = selectedDoc(editor);
      if (id && editor.host.docs) void editor.host.docs.exportMarkdown(id).catch((err: unknown) => editor.host.notify(err instanceof Error ? err.message : 'Could not export the doc', 'error'));
    },
  },
]);
