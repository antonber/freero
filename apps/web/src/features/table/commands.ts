import { BetweenHorizontalEnd, BetweenVerticalEnd, FileDown, SquareKanban, Table2 } from 'lucide-react';
import { defineCommands } from '@engine';
import { addCol, addRow, exportCsv, peopleLookup, selectedTable } from './lib/actions';
import { CONVERT_DIALOG, convertToKanban, copyKanbanAsTable, selectedKanban } from './lib/convert';

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
  {
    // Step 3e: the table becomes a kanban where it stood (columns from one column, cards from the
    // rows, the other columns fields); the dialog picks the columns. One undo step. Args
    // { columnsFrom, titleFrom } (column ids of the selected table) convert without the dialog.
    id: 'table.convertToKanban',
    label: 'Convert to kanban…',
    icon: SquareKanban,
    menus: ['context'],
    when: (editor) => {
      const t = selectedTable(editor);
      return !!t && !t.locked && t.cols.length > 1;
    },
    run(editor, args) {
      const t = selectedTable(editor);
      if (!t) return;
      if (typeof args?.columnsFrom === 'string' && typeof args.titleFrom === 'string') {
        const choice = { columnsFrom: args.columnsFrom, titleFrom: args.titleFrom };
        void peopleLookup(editor).then((people) => convertToKanban(editor, t.id, choice, people));
      } else editor.openPanel(CONVERT_DIALOG, { id: t.id });
    },
  },
  {
    // On a kanban: a table beside it with a row per card and a column per field. A snapshot, not
    // a live view (the kanban is only read; the table is this feature's own element).
    id: 'table.copyKanbanAsTable',
    label: 'Copy as table',
    icon: Table2,
    menus: ['context'],
    when: (editor) => !!selectedKanban(editor),
    run(editor) {
      const k = selectedKanban(editor);
      if (!k) return;
      void peopleLookup(editor).then((people) => {
        const id = copyKanbanAsTable(editor, k.id, people);
        if (id) editor.host.notify('Copied as a table. It won’t follow later changes to the cards.', 'success');
      });
    },
  },
]);
