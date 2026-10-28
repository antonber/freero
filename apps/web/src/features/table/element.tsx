import { memo, useEffect, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import type { TableElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  useCanEdit,
  useCollection,
  useEditingPart,
  useEditor,
  type Collection,
  type Editor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { CELL_PAD, cellAt, cellPart, FONT_SIZE, HEADER_FILL, layoutTable, parseCellPart, parseDelimited, resizeCol, resizeRow, type Move } from './lib/model';
import { CELLS, cellText, plainGrid, readContent, writeContent, type TableContent } from './lib/cells';
import { commitCell, createFromGrid, editCell, moveCell, rememberCell } from './lib/actions';
import './table.css';

// Cell texts for toPlainText (copy as text, search), which only gets the element: the live
// collection, captured the first time any table renders or imports on this board.
let liveCells: Pick<Collection<string>, 'get'> | null = null;

const KEY_MOVES: Record<string, Move> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Drag a divider: the column left of it / the row above it gets wider / taller (one undo step). */
function startDividerDrag(editor: Editor, el: TableElement, e: ReactPointerEvent, axis: 'col' | 'row', id: string, start: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const zoom = editor.getCamera().zoom;
  const from = axis === 'col' ? e.clientX : e.clientY;
  editor.beginGesture();
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const cur = editor.getElement<TableElement>(el.id);
    if (!cur) return;
    const size = start + ((axis === 'col' ? ev.clientX : ev.clientY) - from) / zoom;
    editor.update<TableElement>(el.id, axis === 'col' ? resizeCol(cur, id, size) : resizeRow(cur, id, size));
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    editor.endGesture();
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
}

const TableView = memo(function TableView({ element: el, selected, editing }: ElementRenderProps<TableElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const editingPart = useEditingPart();
  const entries = useCollection<string>(CELLS);
  // This table's cells only (the collection holds every table's).
  const cells = useMemo(() => {
    const prefix = `:${el.id}:`;
    const map = new Map<string, string>();
    for (const [k, v] of entries) if (k.slice(1, 1 + prefix.length) === prefix) map.set(k, v);
    return map;
  }, [entries, el.id]);
  liveCells ??= editor.collection<string>(CELLS);
  const active = editing ? parseCellPart(editingPart) : null;
  useEffect(() => {
    if (active) rememberCell(el.id, cellPart(active.rowId, active.colId));
  }, [el.id, active?.rowId, active?.colId]); // eslint-disable-line react-hooks/exhaustive-deps

  const xs: number[] = [];
  let x = 0;
  for (const c of el.cols) {
    xs.push(x);
    x += c.w;
  }
  const ys: number[] = [];
  let y = 0;
  for (const r of el.rows) {
    ys.push(y);
    y += r.h;
  }
  const dividers = selected && canEdit && !el.locked;

  return (
    <div className="fr-table" style={{ fontSize: el.fontSize }}>
      {el.rows.map((r, ri) =>
        el.cols.map((c, ci) => {
          const header = el.header && ri === 0;
          const fill = cells.get(`f:${el.id}:${r.id}:${c.id}`) || (header ? HEADER_FILL : '');
          const part = cellPart(r.id, c.id);
          const isActive = active?.rowId === r.id && active?.colId === c.id;
          return (
            <div
              key={part}
              className={`fr-table__cell${header ? ' is-header' : ''}${isActive ? ' is-active' : ''}`}
              style={{ left: xs[ci], top: ys[ri], width: c.w, height: r.h, background: fill || undefined }}
            >
              <ElementText
                element={el}
                field="cells"
                part={part}
                value={cells.get(`t:${el.id}:${r.id}:${c.id}`) ?? ''}
                onCommit={(html) => commitCell(editor, el.id, r.id, c.id, html)}
                onKeyDown={(e, caret) => {
                  if (e.altKey || e.ctrlKey || e.metaKey) return false;
                  const cur = editor.getElement<TableElement>(el.id);
                  if (!cur) return false;
                  if (e.key === 'Tab') return moveCell(editor, cur, r.id, c.id, e.shiftKey ? 'prev' : 'next') || true;
                  const move = KEY_MOVES[e.key];
                  if (!move || e.shiftKey) return false;
                  const edge = move === 'up' || move === 'left' ? caret.atStart : caret.atEnd;
                  return edge && moveCell(editor, cur, r.id, c.id, move);
                }}
                fontSize={el.fontSize}
                align="left"
                vAlign="middle"
                color="#17162B"
                padding={CELL_PAD}
                placeholder=""
                className={header ? 'fr-table__text is-header' : 'fr-table__text'}
              />
            </div>
          );
        }),
      )}
      {dividers &&
        el.cols.map((c, ci) =>
          ci === el.cols.length - 1 ? null : (
            <div
              key={`dc-${c.id}`}
              className="fr-table__divider fr-table__divider--col"
              data-fr-interactive=""
              title="Drag to resize the column"
              style={{ left: xs[ci] + c.w, height: el.h }}
              onPointerDown={(e) => startDividerDrag(editor, el, e, 'col', c.id, c.w)}
            />
          ),
        )}
      {dividers &&
        el.rows.map((r, ri) =>
          ri === el.rows.length - 1 ? null : (
            <div
              key={`dr-${r.id}`}
              className="fr-table__divider fr-table__divider--row"
              data-fr-interactive=""
              title="Drag to resize the row"
              style={{ top: ys[ri] + r.h, width: el.w }}
              onPointerDown={(e) => startDividerDrag(editor, el, e, 'row', r.id, r.h)}
            />
          ),
        )}
    </div>
  );
});

export default defineElement({
  type: 'table',
  resize: 'free',
  minSize: { w: 96, h: 32 },
  defaults: (): Omit<NewElement<'table'>, 'x' | 'y'> => ({
    type: 'table',
    rows: [{ id: 'r0', h: 44 }],
    cols: [{ id: 'c0', w: 160 }],
    header: true,
    fontSize: FONT_SIZE,
    w: 160,
    h: 44,
  }),
  Component: TableView,
  normalize: (el, prev) => layoutTable(el, prev),

  // Double-click a cell (or click one of a selected table) to type in it.
  textPartAt(el, local) {
    const cell = cellAt(el, local);
    return cell ? cellPart(cell.rowId, cell.colId) : null;
  },

  // Enter on a selected table edits its first cell; typing starts there too. In a cell, Tab /
  // Shift+Tab and the arrows at the text's edge move between cells (the cell's ElementText
  // onKeyDown above). `keys` lists both in the shortcut sheet: keep it in step.
  keys: [
    { shortcuts: ['enter'], label: 'Edit the first cell of a table' },
    { shortcuts: ['tab', 'shift+tab'], label: 'In a table cell: next / previous cell' },
    { shortcuts: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'], label: 'In a table cell, at the edge of its text: the next cell that way' },
  ],
  onKeyDown(e, { editor, selection }) {
    if (selection.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || !editor.can('editor')) return false;
    const el = selection[0] as TableElement;
    if (el.locked) return false;
    if (e.key === 'Enter') {
      editCell(editor, el.id, el.rows[0].id, el.cols[0].id, true);
      return true;
    }
    return false;
  },

  toPlainText: (el) => (liveCells ? plainGrid(liveCells, el).map((r) => r.join('\t')).join('\n') : ''),

  // Every non-empty cell is a text part: board-wide find & replace reads and rewrites cells
  // through the engine (Editor.getTextParts / setTextParts), never by touching tableCells.
  textParts: (el, editor) =>
    el.rows.flatMap((r) =>
      el.cols.flatMap((c) => {
        const html = cellText(editor.collection<string>(CELLS), el.id, r.id, c.id);
        return html ? [{ part: cellPart(r.id, c.id), html }] : [];
      }),
    ),
  writeTextPart(el, part, html, editor) {
    const cell = parseCellPart(part);
    if (cell && el.rows.some((r) => r.id === cell.rowId) && el.cols.some((c) => c.id === cell.colId))
      commitCell(editor, el.id, cell.rowId, cell.colId, html);
  },

  // Copies (duplicate, Alt-drag, copy / paste) get their own copy of every cell.
  copyContent: (el, editor) => readContent(editor, el),
  pasteContent: (el, content, editor) => writeContent(editor, el.id, content as TableContent),

  // Spreadsheet cells (TSV) or CSV text become a table, ahead of lists / text boxes.
  importPriority: 20,
  importData(editor, data, at) {
    if (data.files.length) return false;
    const grid = parseDelimited(data.text);
    if (!grid) return false;
    liveCells ??= editor.collection<string>(CELLS);
    createFromGrid(editor, grid, at);
    return true;
  },
});
