import { memo, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Gauge, MoreHorizontal, Pencil, Plus, SquareKanban as SquareKanbanIcon, Tag, Trash2 } from 'lucide-react';
import type { CardStatus, KanbanColumn, KanbanElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useEditor,
  useElements,
  type Editor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { Menu, type MenuItem } from '@ui';
import {
  COL_HEAD_H,
  DEFAULT_COL_W,
  GAP,
  HEADER_H,
  MIN_COL_W,
  colLeft,
  columnIndexAt,
  columnsOfChildren,
  kanbanWidth,
  planLayout,
} from './lib/layout';
import { addColumn, columnPart, moveColumn, patchColumn, removeColumn, renameColumn } from './lib/actions';
import { STATUS_LABELS, WIP_CHOICES } from './lib/constants';
import './kanban.css';

/** Below this zoom text is unreadable: draw only the column blocks. */
const LOD_ZOOM = 0.15;

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
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label="Column options" />
    </>
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
  const controls = selected && canEdit && !k.locked;
  const lod = zoom < LOD_ZOOM;
  const bodyH = k.h - HEADER_H - GAP;

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
          <button
            type="button"
            className="fr-kanban__add"
            data-fr-interactive=""
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => addColumn(editor, k.id)}
          >
            <Plus size={14} aria-hidden />
            Column
          </button>
        )}
      </div>
      {k.columns.map((col, i) => {
        const over = !!col.wip && counts[i] > col.wip;
        return (
          <div
            key={col.id}
            className={`fr-kanban__col${over ? ' is-over' : ''}`}
            style={{ left: colLeft(k.colW, i), top: HEADER_H, width: k.colW, height: bodyH, ['--col' as string]: col.color }}
          >
            <div className="fr-kanban__col-head" style={{ height: COL_HEAD_H }}>
              {!lod && (
                <>
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
                      padding={{ top: 0, right: 4, bottom: 0, left: 12 }}
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
                  {col.status && (
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
    const w = kanbanWidth(k.columns.length, k.colW);
    return w !== k.w ? { w } : null;
  },
  // Double-click a column (header or body) to rename it; the board's header edits its title.
  textPartAt(k, local) {
    if (local.y < HEADER_H || !k.columns.length) return null;
    return columnPart(k.columns[columnIndexAt({ ...k, x: 0 }, local.x)].id);
  },
  // Keeps every item stacked in its column and cards' status in step with the column they're in.
  arrange(k, { editor, previous }) {
    const { patches } = planLayout(k, editor.getElements(), previous);
    return patches.length ? patches : null;
  },
});
