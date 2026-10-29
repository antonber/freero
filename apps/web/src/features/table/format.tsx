import { useRef, useState } from 'react';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Download,
  Filter,
  Heading,
  KanbanSquare,
  Table2,
  Italic,
  PaintBucket,
  Trash2,
} from 'lucide-react';
import type { TableElement, TableFilter } from '@freero/shared';
import { defineFormat, useCollection, useEditingPart, useTextFormatState, type Editor } from '@engine';
import { ColorSwatches, IconButton, Menu, Popover, SegmentedControl, Select, Tooltip } from '@ui';
import { CELLS, cellText } from './lib/cells';
import { activeCell, addCol, addRow, currentFill, deleteCol, deleteRow, exportCsv, fillCells, groupColumns, setFilter, setView } from './lib/actions';
import { FILTER_OPS, typeOf } from './lib/columns';

const FILLS = ['transparent', '#FFF3A3', '#FFC98B', '#FFA9A0', '#F9B9E0', '#D3C4FF', '#B5D6FF', '#A7EBEB', '#C2EFB0', '#E6E6EA', '#FFFFFF', '#2B2A44'];
const FILL_NAMES: Record<string, string> = { transparent: 'No fill', '#FFFFFF': 'White', '#2B2A44': 'Ink' };

function FillControl({ editor, table }: { editor: Editor; table: TableElement }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useCollection(CELLS); // follow fills set by others
  useEditingPart();
  const fill = currentFill(editor, table);
  const target = activeCell(editor, table) ? 'Cell fill' : 'Fill all cells';
  return (
    <>
      <Tooltip content={target} side="bottom">
        <button ref={ref} type="button" className="fr-table-fmt-btn" aria-label={target} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <PaintBucket size={16} strokeWidth={2} />
          <span className="fr-table-fmt-chip" style={{ background: fill || 'transparent' }} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={target}>
        <ColorSwatches
          colors={FILLS}
          names={FILL_NAMES}
          value={fill || 'transparent'}
          columns={6}
          size={24}
          allowCustom
          onChange={(c) => fillCells(editor, table, c === 'transparent' ? '' : c)}
          aria-label={target}
        />
      </Popover>
    </>
  );
}

function StructureMenu({ editor, table }: { editor: Editor; table: TableElement }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  const t = () => editor.getElement<TableElement>(table.id) ?? table;
  return (
    <>
      <Tooltip content="Rows and columns" side="bottom">
        <button ref={ref} type="button" className="fr-table-fmt-btn" aria-label="Rows and columns" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <BetweenHorizontalEnd size={16} strokeWidth={2} />
        </button>
      </Tooltip>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        side="bottom"
        align="center"
        minWidth={190}
        aria-label="Rows and columns"
        items={[
          { id: 'ra', label: 'Insert row above', icon: <BetweenHorizontalStart size={16} />, onSelect: run(() => addRow(editor, t(), 'above')) },
          { id: 'rb', label: 'Insert row below', icon: <BetweenHorizontalEnd size={16} />, onSelect: run(() => addRow(editor, t(), 'below')) },
          { id: 'cl', label: 'Insert column left', icon: <BetweenVerticalStart size={16} />, onSelect: run(() => addCol(editor, t(), 'left')) },
          { id: 'cr', label: 'Insert column right', icon: <BetweenVerticalEnd size={16} />, onSelect: run(() => addCol(editor, t(), 'right')) },
          { divider: true },
          { id: 'dr', label: 'Delete row', icon: <Trash2 size={16} />, danger: true, disabled: table.rows.length <= 1, disabledReason: 'A table needs at least one row', onSelect: run(() => deleteRow(editor, t())) },
          { id: 'dc', label: 'Delete column', icon: <Trash2 size={16} />, danger: true, disabled: table.cols.length <= 1, disabledReason: 'A table needs at least one column', onSelect: run(() => deleteCol(editor, t())) },
        ]}
      />
    </>
  );
}


/** The column's name: its header cell's text, else its letter. */
function columnName(editor: Editor, table: TableElement, colId: string): string {
  const i = table.cols.findIndex((c) => c.id === colId);
  const head = table.header ? cellText(editor.collection<string>(CELLS), table.id, table.rows[0].id, colId) : '';
  const text = head.replace(/<[^>]+>/g, '').trim();
  return text || `Column ${String.fromCharCode(65 + (i % 26))}`;
}

/** Filter: one condition on one column; rows that don't pass are drawn collapsed for everyone. */
function FilterControl({ editor, table }: { editor: Editor; table: TableElement }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useCollection(CELLS);
  const f = table.filter && table.cols.some((c) => c.id === table.filter!.colId) ? table.filter : null;
  const [draft, setDraft] = useState<TableFilter>(() => f ?? { colId: table.cols[0].id, op: 'contains', value: '' });
  const col = table.cols.find((c) => c.id === draft.colId) ?? table.cols[0];
  const ops = FILTER_OPS[typeOf(col)];
  const op = ops.find((o) => o.value === draft.op) ?? ops[0];
  const apply = (next: TableFilter) => {
    setDraft(next);
    const o = FILTER_OPS[typeOf(table.cols.find((c) => c.id === next.colId))].find((x) => x.value === next.op);
    if (o && (!o.needsValue || (next.value ?? '').trim())) setFilter(editor, table.id, { colId: next.colId, op: next.op, ...(o.needsValue ? { value: next.value } : {}) });
  };
  const inputType = typeOf(col) === 'date' ? 'date' : typeOf(col) === 'number' ? 'number' : 'text';
  return (
    <>
      <Tooltip content={f ? 'Filter (on)' : 'Filter rows'} side="bottom">
        <button ref={ref} type="button" className={`fr-table-fmt-btn${f ? ' is-on' : ''}`} aria-label="Filter rows" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Filter size={16} strokeWidth={2} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Filter rows">
        <div className="fr-table-filter">
          <div className="fr-table-filter__title">Show rows where</div>
          <Select
            size="sm"
            aria-label="Column"
            value={col.id}
            options={table.cols.map((c) => ({ value: c.id, label: columnName(editor, table, c.id) }))}
            onChange={(colId) => apply({ colId, op: FILTER_OPS[typeOf(table.cols.find((c) => c.id === colId))][0].value, value: '' })}
          />
          <Select size="sm" aria-label="Condition" value={op.value} options={ops.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => apply({ ...draft, colId: col.id, op: v })} />
          {op.needsValue &&
            (typeOf(col) === 'select' ? (
              <Select
                size="sm"
                aria-label="Value"
                placeholder="Choose…"
                value={draft.value ?? ''}
                options={(col.options ?? []).map((o) => ({ value: o.label, label: o.label }))}
                onChange={(v) => apply({ ...draft, colId: col.id, op: op.value, value: v })}
              />
            ) : (
              <input
                className="fr-table-filter__input"
                type={inputType}
                aria-label="Value"
                placeholder="Value"
                value={draft.value ?? ''}
                onChange={(e) => apply({ ...draft, colId: col.id, op: op.value, value: e.target.value })}
              />
            ))}
          {f && (
            <button type="button" className="fr-table-filter__clear" onClick={() => setFilter(editor, table.id, null)}>
              Clear filter
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'table.format',
  order: 10,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'table',
  Component: ({ editor, selection }) => {
    const table = selection[0] as TableElement;
    const fmt = useTextFormatState();
    const editing = editor.getEditingId() === table.id;
    const board = table.view === 'board';
    const canGroup = groupColumns(table).length > 0;
    return (
      <>
        {(canGroup || board) && (
          <SegmentedControl<'grid' | 'board'>
            size="sm"
            aria-label="View"
            value={board ? 'board' : 'grid'}
            options={[
              { value: 'grid', icon: Table2, title: 'Table' },
              { value: 'board', icon: KanbanSquare, title: 'Board: rows as cards by a select column' },
            ]}
            onChange={(v) => setView(editor, table.id, v)}
          />
        )}
        {board && groupColumns(table).length > 1 && (
          <Select
            size="sm"
            aria-label="Group by"
            value={table.groupBy ?? groupColumns(table)[0].id}
            options={groupColumns(table).map((c) => ({ value: c.id, label: columnName(editor, table, c.id) }))}
            onChange={(id) => setView(editor, table.id, 'board', id)}
          />
        )}
        <FilterControl editor={editor} table={table} />
        {!board && <StructureMenu editor={editor} table={table} />}
        {!board && <FillControl editor={editor} table={table} />}
        {!board && <IconButton
          icon={Heading}
          label={table.header ? 'Plain first row' : 'Header row'}
          size={32}
          active={table.header}
          onClick={() => editor.update<TableElement>(table.id, { header: !table.header })}
        />}
        {editing && (
          <>
            <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />
            <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />
          </>
        )}
        <IconButton icon={Download} label="Export as CSV" size={32} onClick={() => void exportCsv(editor, table)} />
      </>
    );
  },
});
