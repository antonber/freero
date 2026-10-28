import { Columns3 } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { addColumn } from './lib/actions';

const selectedKanban = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'kanban' && !el.locked ? el : null;
};

export default defineCommands([
  {
    id: 'kanban.addColumn',
    label: 'Add column',
    icon: Columns3,
    menus: ['context'],
    when: (editor) => !!selectedKanban(editor),
    run(editor) {
      const k = selectedKanban(editor);
      if (k) addColumn(editor, k.id);
    },
  },
]);
