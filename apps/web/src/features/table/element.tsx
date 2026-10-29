import { Table as TableIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Filter } from 'lucide-react';
import type { TableElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  useCanEdit,
  useCollection,
  useEditingPart,
  useEditor,
  useIsExporting,
  usePeople,
  type Editor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { CELL_PAD, cellAt, cellPart, FONT_SIZE, HEADER_FILL, layoutTable, parseCellPart, parseDelimited, resizeCol, resizeRow, type Move } from './lib/model';
import { CELLS, cellText, plainGrid, readContent, writeContent, type TableContent } from './lib/cells';
import { commitCell, createFromGrid, editCell, moveCell, rememberCell, setFilter, shownRows } from './lib/actions';
import { typeOf, visibleRows, type PeopleLookup } from './lib/columns';
import { BoardView, ColumnMenu, TypedEditor, TypedValue } from './lib/views';
import './table.css';

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

const TableView = memo(function TableView({ element: el, selected, editing, zoom }: ElementRenderProps<TableElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const exporting = useIsExporting();
  const editingPart = useEditingPart();
  const entries = useCollection<string>(CELLS);
  // This table's cells only (the collection holds every table's).
  const cells = useMemo(() => {
    const prefix = `:${el.id}:`;
    const map = new Map<string, string>();
    for (const [k, v] of entries) if (k.slice(1, 1 + prefix.length) === prefix) map.set(k, v);
    return map;
  }, [entries, el.id]);
  const get = useCallback((rowId: string, colId: string) => cells.get(`t:${el.id}:${rowId}:${colId}`) ?? '', [cells, el.id]);
  // People named in person columns, by their current names.
  const personIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of el.cols) if (typeOf(c) === 'person') for (const r of el.rows) if (get(r.id, c.id)) ids.add(get(r.id, c.id));
    return [...ids];
  }, [el.cols, el.rows, get]);
  const profiles = usePeople(personIds);
  const people = useMemo<PeopleLookup>(() => ({ name: (id) => profiles[id]?.name }), [profiles]);
  const active = editing ? parseCellPart(editingPart) : null;
  useEffect(() => {
    if (active) rememberCell(el.id, cellPart(active.rowId, active.colId));
  }, [el.id, active?.rowId, active?.colId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const writable = canEdit && !el.locked && !exporting;
  if (el.view === 'board')
    return (
      <div className="fr-table is-board">
        <BoardView editor={editor} table={el} rows={visibleRows(el, get)} get={get} people={people} interactive={selected && writable} zoom={zoom} />
      </div>
    );

  // Filtered-out rows are drawn collapsed; the row being edited always shows.
  const shown = visibleRows(el, get);
  const rows = active && !shown.some((r) => r.id === active.rowId) ? el.rows.filter((r) => shown.includes(r) || r.id === active.rowId) : shown;
  const hidden = el.rows.length - rows.length;

  const xs: number[] = [];
  let x = 0;
  for (const c of el.cols) {
    xs.push(x);
    x += c.w;
  }
  const ys: number[] = [];
  let y = 0;
  for (const r of rows) {
    ys.push(y);
    y += r.h;
  }
  const gridH = y;
  const dividers = selected && writable;
  const finish = (rowId: string, colId: string) => (raw: string, then?: 'stop' | 'next' | 'prev') => {
    if (raw !== get(rowId, colId)) commitCell(editor, el.id, rowId, colId, raw);
    const cur = editor.getElement<TableElement>(el.id);
    if (then === 'next' || then === 'prev') {
      if (cur && moveCell(editor, cur, rowId, colId, then)) return;
    }
    if (then) editor.stopEditing();
  };

  return (
    <>
      <div className={`fr-table${hidden ? ' is-filtered' : ''}`} style={{ fontSize: el.fontSize, height: hidden ? gridH : undefined }}>
        {rows.map((r, ri) =>
          el.cols.map((c, ci) => {
            const header = el.header && r === el.rows[0];
            const typed = !header && typeOf(c) !== 'text';
            const fill = cells.get(`f:${el.id}:${r.id}:${c.id}`) || (header ? HEADER_FILL : '');
            const part = cellPart(r.id, c.id);
            const isActive = active?.rowId === r.id && active?.colId === c.id;
            const raw = get(r.id, c.id);
            return (
              <div
                key={part}
                ref={(n) => {
                  if (n) cellRefs.current.set(part, n);
                  else cellRefs.current.delete(part);
                }}
                className={`fr-table__cell${header ? ' is-header' : ''}${isActive ? ' is-active' : ''}${typed ? ` is-typed is-${typeOf(c)}` : ''}`}
                style={{ left: xs[ci], top: ys[ri], width: c.w, height: r.h, background: fill || undefined }}
              >
                {typed ? (
                  isActive && writable ? (
                    <TypedEditor
                      editor={editor}
                      table={el}
                      col={c}
                      raw={raw}
                      anchor={cellRefs.current.get(part) ?? null}
                      onCommit={finish(r.id, c.id)}
                      onCancel={() => editor.stopEditing()}
                    />
                  ) : (
                    <TypedValue col={c} raw={raw} people={people} onToggle={writable ? () => commitCell(editor, el.id, r.id, c.id, raw === 'true' ? '' : 'true') : undefined} />
                  )
                ) : (
                  <ElementText
                    element={el}
                    field="cells"
                    part={part}
                    value={raw}
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
                    padding={header && dividers ? { top: CELL_PAD, right: CELL_PAD + 30, bottom: CELL_PAD, left: CELL_PAD } : CELL_PAD}
                    placeholder=""
                    className={header ? 'fr-table__text is-header' : 'fr-table__text'}
                  />
                )}
                {dividers && ri === 0 && <ColumnMenu editor={editor} table={el} col={c} />}
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
                style={{ left: xs[ci] + c.w, height: gridH }}
                onPointerDown={(e) => startDividerDrag(editor, el, e, 'col', c.id, c.w)}
              />
            ),
          )}
        {dividers &&
          rows.map((r, ri) =>
            ri === rows.length - 1 ? null : (
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
      {hidden > 0 && !exporting && (
        <div className="fr-table__filtered" style={{ top: gridH }}>
          <Filter size={12} aria-hidden />
          {hidden === 1 ? '1 row hidden by the filter' : `${hidden} rows hidden by the filter`}
          {writable && (
            <button type="button" data-fr-interactive="" onPointerDown={(e) => e.stopPropagation()} onClick={() => setFilter(editor, el.id, null)}>
              Show all
            </button>
          )}
        </div>
      )}
    </>
  );
});

export default defineElement({
  type: 'table',
  label: { one: 'Table', many: 'Tables' },
  icon: TableIcon,
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
  textPartAt(el, local, { editor }) {
    if (el.view === 'board') return null;
    const cell = cellAt({ rows: shownRows(editor, el), cols: el.cols }, local);
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

  toPlainText: (el, editor) =>
    plainGrid(editor.collection<string>(CELLS), el, { mode: 'export' })
      .map((r) => r.join('\t'))
      .join('\n'),

  // Every non-empty cell is a text part: board-wide find & replace reads and rewrites cells
  // through the engine (Editor.getTextParts / setTextParts), never by touching tableCells.
  textParts: (el, editor) =>
    el.rows.flatMap((r, i) =>
      el.cols.flatMap((c) => {
        if (typeOf(c) !== 'text' && !(el.header && i === 0)) return [];
        const html = cellText(editor.collection<string>(CELLS), el.id, r.id, c.id);
        return html ? [{ part: cellPart(r.id, c.id), html }] : [];
      }),
    ),
  writeTextPart(el, part, html, editor) {
    const cell = parseCellPart(part);
    const col = el.cols.find((c) => c.id === cell?.colId);
    if (cell && col && (typeOf(col) === 'text' || (el.header && el.rows[0]?.id === cell.rowId)) && el.rows.some((r) => r.id === cell.rowId))
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
    createFromGrid(editor, grid, at);
    return true;
  },
});
