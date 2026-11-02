import { ListChecks, Plus, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { KanbanElement } from '@freero/shared';
import { defineFormat, useDock, type Editor } from '@engine';
import { SegmentedControl } from '@ui';
import { addColumn, setColumnWidth } from './lib/actions';
import { COLUMN_WIDTHS, FIELDS_PANEL, VIEW_PANEL } from './lib/constants';

function DockButton({ editor, panel, icon: Icon, label }: { editor: Editor; panel: string; icon: LucideIcon; label: string }) {
  const open = useDock() === panel;
  return (
    <button type="button" className="fr-kanban-format__btn" aria-pressed={open} onClick={() => editor.openDock(open ? null : panel)}>
      <Icon size={16} aria-hidden />
      {label}
    </button>
  );
}

/** One selected kanban: add a column, pick the column width, its fields and its view (what cards show). */
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
        <DockButton editor={editor} panel={FIELDS_PANEL} icon={ListChecks} label="Fields" />
        <DockButton editor={editor} panel={VIEW_PANEL} icon={SlidersHorizontal} label="View" />
      </div>
    );
  },
});
