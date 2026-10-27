import { BetweenHorizontalEnd, BetweenVerticalEnd, FileDown } from 'lucide-react';
import { defineCommands } from '@engine';
import { addCol, addRow, exportCsv, selectedTable } from './lib/actions';

export default defineCommands([
  {
    id: 'table.addRow',
    label: 'Insert row below',
    icon: BetweenHorizontalEnd,
    menus: ['context'],
    group: 'Table',
    when: (editor) => !!selectedTable(editor),
    run(editor) {
      const t = selectedTable(editor);
      if (t) addRow(editor, t, 'below');
    },
  },
  {
    id: 'table.addColumn',
    label: 'Insert column right',
    icon: BetweenVerticalEnd,
    menus: ['context'],
    group: 'Table',
    when: (editor) => !!selectedTable(editor),
    run(editor) {
      const t = selectedTable(editor);
      if (t) addCol(editor, t, 'right');
    },
  },
  {
    // Viewers may take the data out too.
    id: 'table.exportCsv',
    label: 'Export table as CSV',
    icon: FileDown,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!selectedTable(editor),
    run(editor) {
      const t = selectedTable(editor);
      if (t) exportCsv(editor, t);
    },
  },
]);
