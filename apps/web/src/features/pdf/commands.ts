import { LayoutGrid } from 'lucide-react';
import type { PdfElement } from '@freero/shared';
import { defineCommands, type Editor } from '@engine';
import { placeAllPages } from './lib/actions';

const selectedPdf = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement<PdfElement>(sel[0]) : undefined;
  return el?.type === 'pdf' && el.src ? el : null;
};

export default defineCommands([
  {
    id: 'pdf.placePages',
    label: 'Place all pages',
    icon: LayoutGrid,
    menus: ['context'],
    when: (editor) => !!selectedPdf(editor),
    run(editor) {
      const el = selectedPdf(editor);
      if (el) void placeAllPages(editor, el.id);
    },
  },
]);
