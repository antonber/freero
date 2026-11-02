import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FoldHorizontal,
  Gauge,
  GripVertical,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  SquareKanban as SquareKanbanIcon,
  Tag,
  Trash2,
  UnfoldHorizontal,
} from 'lucide-react';
import type { CardStatus, KanbanColumn, KanbanElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useDragPreview,
  useEditor,
  useElements,
  type Editor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { ColorSwatches, Menu, Popover, type MenuItem } from '@ui';
import {
  COL_HEAD_H,
  DEFAULT_COL_W,
  GAP,
  HEADER_H,
  MIN_COL_W,
  boardWidth,
  colLeft,
  colWidth,
  columnIndexAt,
  columnsOfChildren,
  inCollapsedColumn,
  kanbanWidth,
  planDrop,
  planLayout,
} from './lib/layout';
import { addColumn, columnPart, moveColumn, moveColumnTo, patchColumn, removeColumn, renameColumn, setCollapsed, setColumnWidth } from './lib/actions';
import { COLUMN_COLOR_NAMES, COLUMN_PALETTE, STATUS_LABELS, WIP_CHOICES } from './lib/constants';
import './kanban.css';

/** Below this zoom text is unreadable: draw only the column blocks. */
const LOD_ZOOM = 0.15;
/** Screen px a column header grip moves before it counts as a drag (not a click). */
const DRAG_PX = 4;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

function ColumnMenu({ editor, k, col, index }: { editor: Editor; k: KanbanElement; col: KanbanColumn; index: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const statuses = Object.keys(STATUS_LABELS) as CardStatus[];
  const items: MenuItem[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => renameColumn(editor, k.id, col.id) },
    {
      id: 'status',
      label: 'Sets card status',
      icon: Tag,
      onSelect: () => undefined,
      submenu: [
        ...statuses.map((s) => ({
          id: s,
          label: STATUS_LABELS[s],
          checked: col.status === s,
          onSelect: () => patchColumn(editor, k.id, col.id, { status: s }),
        })),
        { id: 'none', label: 'Leave status as is', checked: !col.status, onSelect: () => patchColumn(editor, k.id, col.id, { status: null }) },
      ],
    },
    {
      id: 'color',
      label: 'Colour',
      icon: Palette,
      onSelect: () => undefined,
      submenu: COLUMN_PALETTE.map((c) => ({
        id: `color-${c}`,
        label: (
          <span className="fr-kanban-menu-swatch">
            <span style={{ background: c }} aria-hidden />
            {COLUMN_COLOR_NAMES[c] ?? c}
          </span>
        ),
        checked: col.color.toLowerCase() === c.toLowerCase(),
        onSelect: () => patchColumn(editor, k.id, col.id, { color: c }),
      })),
    },
    {
      id: 'wip',
      label: 'WIP limit',
      icon: Gauge,
      onSelect: () => undefined,
      submenu: [
        { id: 'wip-0', label: 'No limit', checked: !col.wip, onSelect: () => patchColumn(editor, k.id, col.id, { wip: 0 }) },
        ...WIP_CHOICES.map((n) => ({
          id: `wip-${n}`,
          label: `${n} ${n === 1 ? 'item' : 'items'}`,
          checked: col.wip === n,
          onSelect: () => patchColumn(editor, k.id, col.id, { wip: n }),
        })),
      ],
    },
    {
      id: 'collapse',
      label: col.collapsed ? 'Expand column' : 'Collapse column',
      icon: col.collapsed ? UnfoldHorizontal : FoldHorizontal,
      onSelect: () => setCollapsed(editor, k.id, col.id, !col.collapsed),
    },
    { divider: true },
    { id: 'left', label: 'Move left', icon: ArrowLeft, disabled: index === 0, onSelect: () => moveColumn(editor, k.id, col.id, -1) },
    { id: 'right', label: 'Move right', icon: ArrowRight, disabled: index === k.columns.length - 1, onSelect: () => moveColumn(editor, k.id, col.id, 1) },
    { id: 'add', label: 'Add column after', icon: Plus, onSelect: () => addColumn(editor, k.id, index) },
    { divider: true },
    {
      id: 'delete',
      label: 'Delete column',
      icon: Trash2,
      danger: true,
      disabled: k.columns.length < 2,
      onSelect: () => removeColumn(editor, k.id, col.id),
    },
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-kanban__col-menu${open ? ' is-open' : ''}`}
        data-fr-interactive=""
        aria-label={`Column options: ${richTextToPlain(col.title) || 'Untitled'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={stop}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label="Column options" />
    </>
  );
}

/** The column's colour, picked from the column header. */
function ColumnColor({ editor, k, col }: { editor: Editor; k: KanbanElement; col: KanbanColumn }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-kanban__col-color"
        data-fr-interactive=""
        style={{ background: col.color }}
        aria-label={`Column colour: ${COLUMN_COLOR_NAMES[col.color] ?? col.color}`}
        aria-expanded={open}
        onPointerDown={stop}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="start" aria-label="Column colour">
        <ColorSwatches
          colors={COLUMN_PALETTE}
          names={COLUMN_COLOR_NAMES}
          value={col.color}
          columns={6}
          aria-label="Column colour"
          onChange={(c) => {
            patchColumn(editor, k.id, col.id, { color: c });
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

interface ColumnDrag {
  colId: string;
  /** World units the header has been dragged. */
  dx: number;
  /** Index it would take (among the other columns). */
  to: number;
}

/**
 * The grip in a column header: drag it sideways to reorder the columns (their items go along on
 * the drop). A pointer drag of our own, not the select tool's: the board itself stays put.
 */
function ColumnGrip({ editor, k, index, onDrag }: { editor: Editor; k: KanbanElement; index: number; onDrag: (d: ColumnDrag | null) => void }) {
  const start = useRef<{ x: number; zoom: number; moved: boolean; last: ColumnDrag | null } | null>(null);
  const col = k.columns[index];
  const target = (dx: number) => {
    const mid = k.x + colLeft(k, index) + colWidth(k, index) / 2 + dx;
    return k.columns.filter((c, j) => j !== index && k.x + colLeft(k, j) + colWidth(k, j) / 2 < mid).length;
  };
  const end = (e: ReactPointerEvent, drop: boolean) => {
    const s = start.current;
    start.current = null;
    onDrag(null);
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    if (drop && s?.moved && s.last && s.last.to !== index) moveColumnTo(editor, k.id, col.id, s.last.to);
  };
  return (
    <span
      className="fr-kanban__grip"
      data-fr-interactive=""
      title="Drag to move the column"
      aria-hidden
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, zoom: editor.getCamera().zoom, moved: false, last: null };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (!s.moved && Math.abs(e.clientX - s.x) < DRAG_PX) return;
        s.moved = true;
        const dx = (e.clientX - s.x) / s.zoom;
        s.last = { colId: col.id, dx, to: target(dx) };
        onDrag(s.last);
      }}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
    >
      <GripVertical size={14} aria-hidden />
    </span>
  );
}

/**
 * The right edge of a column: drag it to make every column wider or narrower (one width for all,
 * like the S / M / L choice). One undo step; the items re-stack at the new width on release.
 */
function ColumnEdge({ editor, k, index, height }: { editor: Editor; k: KanbanElement; index: number; height: number }) {
  const start = useRef<{ x: number; zoom: number; colW: number; open: number } | null>(null);
  const end = (e: ReactPointerEvent) => {
    if (!start.current) return;
    start.current = null;
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    editor.endGesture();
  };
  return (
    <div
      className="fr-kanban__edge"
      data-fr-interactive=""
      title="Drag to change the column width"
      aria-hidden
      style={{ left: colLeft(k, index) + colWidth(k, index), top: HEADER_H, width: GAP, height }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        // The edge stays under the pointer: it moves by the width change times the open columns up to it.
        const open = k.columns.slice(0, index + 1).filter((c) => !c.collapsed).length;
        start.current = { x: e.clientX, zoom: editor.getCamera().zoom, colW: k.colW, open: Math.max(1, open) };
        editor.beginGesture();
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) setColumnWidth(editor, k.id, s.colW + (e.clientX - s.x) / s.zoom / s.open);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}

const KanbanView = memo(function KanbanView({ element: k, selected, zoom }: ElementRenderProps<KanbanElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const all = useElements();
  const counts = useMemo(() => {
    const out = k.columns.map(() => 0);
    for (const idx of columnsOfChildren(k, all).values()) out[idx]++;
    return out;
  }, [k, all]);
  const slots = useDragPreview(k.id);
  const [colDrag, setColDrag] = useState<ColumnDrag | null>(null);
  const controls = selected && canEdit && !k.locked;
  const lod = zoom < LOD_ZOOM;
  const bodyH = k.h - HEADER_H - GAP;
  // Narrow columns keep their title readable while selected: colour and status stay in the menu.
  const roomy = k.colW >= 240;
  // Columns the drag would drop into (a slot over a collapsed strip lights the strip instead).
  const targets = new Set((slots ?? []).map((s) => columnIndexAt(k, s.x + s.w / 2)));
  const dragIdx = colDrag ? k.columns.findIndex((c) => c.id === colDrag.colId) : -1;
  // Where a dragged column header would go: a bar in the gap before the column now at that place.
  const insertAt = (() => {
    if (!colDrag || dragIdx < 0 || colDrag.to === dragIdx) return null;
    const others = k.columns.map((_, j) => j).filter((j) => j !== dragIdx);
    const before = others[colDrag.to];
    return before === undefined ? colLeft(k, k.columns.length) - GAP / 2 : colLeft(k, before) - GAP / 2;
  })();

  return (
    <div className="fr-kanban">
      <div className="fr-kanban__head" style={{ height: HEADER_H }}>
        {!lod && (
          <div className="fr-kanban__title">
            <ElementText
              element={k}
              field="title"
              fontSize={18}
              fontFamily="sans"
              align="left"
              vAlign="middle"
              color="var(--fr-ink)"
              padding={{ top: 0, right: 8, bottom: 0, left: 16 }}
              style={{ fontWeight: 650 }}
              placeholder="Kanban"
            />
          </div>
        )}
        {controls && (
          <button type="button" className="fr-kanban__add" data-fr-interactive="" onPointerDown={stop} onClick={() => addColumn(editor, k.id)}>
            <Plus size={14} aria-hidden />
            Column
          </button>
        )}
      </div>
      {k.columns.map((col, i) => {
        const over = !!col.wip && counts[i] > col.wip;
        const title = richTextToPlain(col.title) || 'Untitled';
        const cls = `fr-kanban__col${over ? ' is-over' : ''}${col.collapsed ? ' is-collapsed' : ''}${targets.has(i) ? ' is-target' : ''}${i === dragIdx ? ' is-moving' : ''}`;
        const box = { left: colLeft(k, i), top: HEADER_H, width: colWidth(k, i), height: bodyH, ['--col' as string]: col.color };
        if (col.collapsed)
          return (
            <div key={col.id} className={cls} style={box}>
              {!lod && (
                <div className="fr-kanban__strip">
                  <span className="fr-kanban__count" title={`${counts[i]} items, folded away`}>
                    {counts[i]}
                  </span>
                  {canEdit && !k.locked && (
                    <button
                      type="button"
                      className="fr-kanban__col-menu"
                      data-fr-interactive=""
                      aria-label={`Expand column: ${title}`}
                      title="Expand column"
                      onPointerDown={stop}
                      onClick={() => setCollapsed(editor, k.id, col.id, false)}
                    >
                      <UnfoldHorizontal size={16} aria-hidden />
                    </button>
                  )}
                  <span className="fr-kanban__strip-title">{title}</span>
                </div>
              )}
            </div>
          );
        return (
          <div key={col.id} className={cls} style={box}>
            <div className="fr-kanban__col-head" style={{ height: COL_HEAD_H }}>
              {!lod && (
                <>
                  {controls && <ColumnGrip editor={editor} k={k} index={i} onDrag={setColDrag} />}
                  {controls && roomy && <ColumnColor editor={editor} k={k} col={col} />}
                  <div className="fr-kanban__col-title">
                    <ElementText
                      element={k}
                      field="columns"
                      part={columnPart(col.id)}
                      value={col.title}
                      onCommit={(html) => patchColumn(editor, k.id, col.id, { title: sanitizeRichText(html) })}
                      fontSize={14}
                      fontFamily="sans"
                      align="left"
                      vAlign="middle"
                      color="var(--fr-ink)"
                      padding={{ top: 0, right: 4, bottom: 0, left: controls ? 4 : 12 }}
                      style={{ fontWeight: 600 }}
                      placeholder="Column"
                    />
                  </div>
                  <span
                    className="fr-kanban__count"
                    title={col.wip ? `${counts[i]} of ${col.wip} allowed (work-in-progress limit)` : `${counts[i]} items`}
                  >
                    {counts[i]}
                    {col.wip ? `/${col.wip}` : ''}
                  </span>
                  {col.status && (!controls || roomy) && (
                    <span className="fr-kanban__status" title={`Cards dropped here become “${STATUS_LABELS[col.status]}”`}>
                      <Check size={11} strokeWidth={3} aria-hidden />
                    </span>
                  )}
                  {controls && <ColumnMenu editor={editor} k={k} col={col} index={i} />}
                </>
              )}
            </div>
          </div>
        );
      })}
      {controls && !lod && k.columns.map((col, i) => (col.collapsed ? null : <ColumnEdge key={col.id} editor={editor} k={k} index={i} height={bodyH} />))}
      {slots?.map((s, n) =>
        k.columns[columnIndexAt(k, s.x + s.w / 2)]?.collapsed ? null : (
          <div key={n} className="fr-kanban__slot" style={{ left: s.x - k.x, top: s.y - k.y, width: s.w, height: s.h }} aria-hidden />
        ),
      )}
      {colDrag && dragIdx >= 0 && (
        <>
          <div
            className="fr-kanban__ghost"
            style={{ left: colLeft(k, dragIdx) + colDrag.dx, top: HEADER_H, width: colWidth(k, dragIdx), height: COL_HEAD_H, ['--col' as string]: k.columns[dragIdx].color }}
            aria-hidden
          >
            {richTextToPlain(k.columns[dragIdx].title) || 'Untitled'}
          </div>
          {insertAt !== null && <div className="fr-kanban__insert" style={{ left: insertAt - 2, top: HEADER_H, height: bodyH }} aria-hidden />}
        </>
      )}
    </div>
  );
});

export default defineElement({
  type: 'kanban',
  label: { one: 'Kanban board', many: 'Kanban boards' },
  icon: SquareKanbanIcon,
  // Columns size the board: width from their count and width, height from the tallest stack.
  resize: 'none',
  rotatable: false,
  container: true,
  textField: 'title',
  minSize: { w: kanbanWidth(1, MIN_COL_W), h: 200 },
  defaults: (): Omit<NewElement<'kanban'>, 'x' | 'y'> => ({
    type: 'kanban',
    w: kanbanWidth(3, DEFAULT_COL_W),
    h: 320,
    title: 'Kanban',
    columns: [],
    colW: DEFAULT_COL_W,
  }),
  Component: KanbanView,
  toPlainText: (k) => [richTextToPlain(k.title), ...k.columns.map((c) => richTextToPlain(c.title))].filter(Boolean).join('\n'),
  normalize(k) {
    const w = k.columns.length ? boardWidth(k) : kanbanWidth(0, k.colW);
    return w !== k.w ? { w } : null;
  },
  // Double-click a column (header or body) to rename it; the board's header edits its title.
  textPartAt(k, local) {
    if (local.y < HEADER_H || !k.columns.length) return null;
    const col = k.columns[columnIndexAt({ ...k, x: 0 }, local.x)];
    return col.collapsed ? null : columnPart(col.id);
  },
  // Keeps every item stacked in its column and cards' status (and colour) in step with the column they're in.
  arrange(k, { editor, previous }) {
    const { patches } = planLayout(k, editor.getElements(), previous);
    return patches.length ? patches : null;
  },
  // While cards are dragged over the board: where they would land, and the others making room.
  dragPreview: (k, { editor, moving }) => planDrop(k, editor.getElements(), moving),
  // A collapsed column's items stay in it (and in the outline), folded away.
  hidesMember: (k, el) => inCollapsedColumn(k, el),
});
