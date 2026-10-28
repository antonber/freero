import { Plus } from 'lucide-react';
import type { KanbanElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { SegmentedControl } from '@ui';
import { addColumn, setColumnWidth } from './lib/actions';
import { COLUMN_WIDTHS } from './lib/constants';

/** One selected kanban: add a column, pick the column width. */
export default defineFormat({
  id: 'kanban.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'kanban',
  Component: ({ editor, selection }) => {
    const k = selection[0] as KanbanElement;
    if (k.locked) return null;
    return (
      <div className="fr-kanban-format">
        <button type="button" className="fr-kanban-format__btn" onClick={() => addColumn(editor, k.id)}>
          <Plus size={16} aria-hidden />
          Add column
        </button>
        <SegmentedControl
          size="sm"
          aria-label="Column width"
          value={COLUMN_WIDTHS.find((c) => c.w === k.colW)?.id ?? ''}
          options={COLUMN_WIDTHS.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(id: string) => {
            const w = COLUMN_WIDTHS.find((c) => c.id === id)?.w;
            if (w) setColumnWidth(editor, k.id, w);
          }}
        />
      </div>
    );
  },
});
