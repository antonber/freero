import { useRef, useState } from 'react';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Download,
  Heading,
  Italic,
  PaintBucket,
  Trash2,
} from 'lucide-react';
import type { TableElement } from '@freero/shared';
import { defineFormat, useCollection, useEditingPart, useTextFormatState, type Editor } from '@engine';
import { ColorSwatches, IconButton, Menu, Popover } from '@ui';
import { CELLS } from './lib/cells';
import { activeCell, addCol, addRow, currentFill, deleteCol, deleteRow, exportCsv, fillCells } from './lib/actions';

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
      <button ref={ref} type="button" className="fr-table-fmt-btn" aria-label={target} title={target} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PaintBucket size={16} strokeWidth={2} />
        <span className="fr-table-fmt-chip" style={{ background: fill || 'transparent' }} />
      </button>
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
      <button ref={ref} type="button" className="fr-table-fmt-btn" aria-label="Rows and columns" title="Rows and columns" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <BetweenHorizontalEnd size={16} strokeWidth={2} />
      </button>
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
          { id: 'dr', label: 'Delete row', icon: <Trash2 size={16} />, danger: true, disabled: table.rows.length <= 1, onSelect: run(() => deleteRow(editor, t())) },
          { id: 'dc', label: 'Delete column', icon: <Trash2 size={16} />, danger: true, disabled: table.cols.length <= 1, onSelect: run(() => deleteCol(editor, t())) },
        ]}
      />
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
    return (
      <>
        <StructureMenu editor={editor} table={table} />
        <FillControl editor={editor} table={table} />
        <IconButton
          icon={Heading}
          label={table.header ? 'Plain first row' : 'Header row'}
          size={32}
          active={table.header}
          onClick={() => editor.update<TableElement>(table.id, { header: !table.header })}
        />
        {editing && (
          <>
            <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />
            <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />
          </>
        )}
        <IconButton icon={Download} label="Export as CSV" size={32} onClick={() => exportCsv(editor, table)} />
      </>
    );
  },
});
