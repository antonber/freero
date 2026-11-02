import { ListChecks, Palette, Plus } from 'lucide-react';
import type { KanbanElement } from '@freero/shared';
import { defineFormat, useDock, type Editor } from '@engine';
import { IconButton, SegmentedControl } from '@ui';
import { addColumn, setColorCards, setColumnWidth } from './lib/actions';
import { COLUMN_WIDTHS, FIELDS_PANEL } from './lib/constants';

function FieldsButton({ editor }: { editor: Editor }) {
  const open = useDock() === FIELDS_PANEL;
  return (
    <button type="button" className="fr-kanban-format__btn" aria-pressed={open} onClick={() => editor.openDock(open ? null : FIELDS_PANEL)}>
      <ListChecks size={16} aria-hidden />
      Fields
    </button>
  );
}

/** One selected kanban: add a column, pick the column width, cards coloured by column, its fields. */
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
        <IconButton
          icon={Palette}
          size={32}
          label="Colour cards by column"
          active={!!k.colorCards}
          onClick={() => setColorCards(editor, k.id, !k.colorCards)}
        />
        <FieldsButton editor={editor} />
      </div>
    );
  },
});
