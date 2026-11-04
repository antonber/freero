import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowDownUp,
  Check,
  Filter,
  FoldHorizontal,
  Gauge,
  ListEnd,
  GripVertical,
  Link2,
  Maximize2,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  SquareKanban as SquareKanbanIcon,
  Tag,
  Trash2,
  UnfoldHorizontal,
} from 'lucide-react';
import { LINKED_VIEW_MIN, LINKED_VIEW_SIZES, MY_TAB_KEY, NO_GROUP, linkedView as linkedView_, newLinkedView, boardView, collectionSchema, describeFilter, describeSort, groupFieldId, shownTabId, viewTabs, type BoardElement, type CardStatus, type FieldDef, type KanbanColumn, type KanbanElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useDragPreview,
  useEditor,
  useElements,
  useIsExporting,
  usePeople,
  usePersonalView,
  usePhoneLayout,
  type Editor,
  type ElementDefinition,
  type ElementRenderProps,
  type LowDetailPaint,
  type NewElement,
} from '@engine';
import { ColorSwatches, Menu, Popover, type MenuItem } from '@ui';
import {
  COL_HEAD_H,
  DEFAULT_COL_W,
  GAP,
  HEADER_H,
  ITEM_GAP,
  LANE_HEAD_H,
  MIN_COL_W,
  PAD,
  beyondLimit,
  boardWidth,
  colLeft,
  colWidth,
  columnIndexAt,
  columnsOfChildren,
  filteredOut,
  inCollapsedColumn,
  innerWidth,
  isStackable,
  kanbanWidth,
  laneField,
  planDrop,
  planLayout,
} from './lib/layout';
import { addColumn, columnPart, moveColumn, moveColumnTo, patchColumn, removeColumn, renameColumn, setCollapsed, setColumnLimit, setColumnWidth } from './lib/actions';
import { CARD_LIMITS, COLUMN_COLOR_NAMES, COLUMN_PALETTE, FOCUS_PANEL, STATUS_LABELS, VIEW_PANEL, WIP_CHOICES } from './lib/constants';
import { columnsAreOptions, groupTitle, storedKey } from './lib/group';
import { presentCard, presentationKey } from './lib/view';
import { showsProjection } from './lib/tabs';
import { TabStrip } from './lib/TabStrip';
import { ProjectionTab } from './lib/ProjectionTab';
import { LinkedViewElement } from './lib/LinkedView';
import { sourceOf } from './lib/linked';
import './kanban.css';

/** Below this zoom text is unreadable: draw only the column blocks. */
const LOD_ZOOM = 0.15;
/** Screen px a column header grip moves before it counts as a drag (not a click). */
const DRAG_PX = 4;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

function ColumnMenu({ editor, k, col, index, title, options }: { editor: Editor; k: KanbanElement; col: KanbanColumn; index: number; title: string; options: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const statuses = Object.keys(STATUS_LABELS) as CardStatus[];
  // Columns that are a select field's options are renamed, added and deleted like options; people,
  // checkbox values and "No <field>" are what the cards say, so only their look and limits change.
  const isOption = options && col.id !== NO_GROUP;
  const items: MenuItem[] = [
    ...(isOption ? [{ id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => renameColumn(editor, k.id, col.id) }] : []),
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
      id: 'limit',
      label: 'Cards shown',
      icon: ListEnd,
      onSelect: () => undefined,
      submenu: [
        { id: 'limit-0', label: 'All', checked: !col.limit, onSelect: () => setColumnLimit(editor, k.id, col.id, 0) },
        ...CARD_LIMITS.map((n) => ({
          id: `limit-${n}`,
          label: `First ${n}`,
          checked: col.limit === n,
          onSelect: () => setColumnLimit(editor, k.id, col.id, n),
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
    ...(options ? [{ id: 'add', label: 'Add column after', icon: Plus, onSelect: () => addColumn(editor, k.id, index) }] : []),
    ...(isOption
      ? [
          { divider: true as const },
          {
            id: 'delete',
            label: 'Delete column',
            icon: Trash2,
            danger: true,
            disabled: k.columns.filter((c) => c.id !== NO_GROUP).length < 2,
            onSelect: () => removeColumn(editor, k.id, col.id),
          },
        ]
      : []),
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-kanban__col-menu${open ? ' is-open' : ''}`}
        data-fr-interactive=""
        aria-label={`Column options: ${title}`}
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

/**
 * What the board shows besides its columns: swimlane counts, and under each column (cell) the cards
 * folded away below the board: "+N more" beyond its card limit, and how many the filter hides.
 */
function useGroups(k: KanbanElement, all: BoardElement[]) {
  return useMemo(() => {
    const counts = k.columns.map(() => 0);
    for (const idx of columnsOfChildren(k, all).values()) counts[idx]++;
    const lanes = laneField(k);
    const laneIds = (k.lanes ?? []).map((l) => l.id);
    const laneCounts = laneIds.map(() => 0);
    // Where a cell's items start (element-local), for a cell whose items are all folded away.
    const cellTop = (lane: number) =>
      HEADER_H + COL_HEAD_H + (lanes ? (k.lanes ?? []).slice(0, lane).reduce((sum, l) => sum + l.h, 0) + LANE_HEAD_H : 0) + PAD - ITEM_GAP;
    // Per column and lane: items folded away beyond the limit, those the filter hides, and where the visible ones end.
    const more = new Map<string, { n: number; hidden: number; bottom: number; col: number; lane: number }>();
    for (const el of all) {
      if (!isStackable(el, k.id)) continue;
      const col = columnIndexAt(k, el.x + el.w / 2);
      const lane = lanes ? Math.max(0, laneIds.indexOf(storedKey(lanes, el))) : 0;
      if (lanes) laneCounts[lane]++;
      const key = `${col}:${lane}`;
      const m = more.get(key) ?? { n: 0, hidden: 0, bottom: k.y + cellTop(lane), col, lane };
      if (filteredOut(k, el)) m.hidden++;
      else if (beyondLimit(k, el)) m.n++;
      else m.bottom = Math.max(m.bottom, el.y + el.h);
      more.set(key, m);
    }
    return { counts, lanes, laneCounts, more: [...more.values()].filter((m) => m.n > 0 || m.hidden > 0) };
  }, [k, all]);
}

/** Column titles: a select's options as written; people by their current name; the rest as the field says. */
function useColumnTitles(k: KanbanElement): { group: FieldDef | undefined; titles: string[]; laneTitles: string[] } {
  const schema = useMemo(() => collectionSchema(k), [k]);
  const group = schema.find((f) => f.id === groupFieldId(k));
  const lanes = laneField(k);
  const ids = [...(group?.type === 'person' ? k.columns.map((c) => c.id) : []), ...(lanes?.type === 'person' ? (k.lanes ?? []).map((l) => l.id) : [])].filter((id) => id !== NO_GROUP);
  const people = usePeople(ids);
  const name = (id: string) => people[id]?.name;
  return {
    group,
    titles: k.columns.map((c) => (group && group.type !== 'select' ? groupTitle(group, c.id, name) : richTextToPlain(c.title) || 'Untitled')),
    laneTitles: lanes ? (k.lanes ?? []).map((l) => groupTitle(lanes, l.id, name)) : [],
  };
}

/** "Focus": the kanban as a page of its own (lib/Focus.tsx). */
function FocusButton({ editor, k }: { editor: Editor; k: KanbanElement }) {
  return (
    <button
      type="button"
      className="fr-kanban__focus"
      data-fr-interactive=""
      title="Open in focus mode: all its cards as a list you arrange your way"
      aria-label="Open in focus mode"
      onPointerDown={stop}
      onClick={() => editor.openPanel(FOCUS_PANEL, { id: k.id })}
    >
      <Maximize2 size={14} aria-hidden />
    </button>
  );
}

/** The kanban's title band: its title, its tabs, what the board view says (filtered, sorted), and the board's buttons. */
function Head({ editor, k, selected, lod, tabId, board, canEdit, phone }: { editor: Editor; k: KanbanElement; selected: boolean; lod: boolean; tabId: string; board: boolean; canEdit: boolean; phone: boolean }) {
  const schema = useMemo(() => collectionSchema(k), [k]);
  const view = boardView(k);
  const sortedBy = board && view.sort?.length ? describeSort(view.sort, schema) : '';
  const filterWords = board && view.filter ? describeFilter(view.filter, schema) : '';
  const controls = selected && canEdit && !k.locked;
  return (
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
      {!lod && <TabStrip editor={editor} k={k} shownId={tabId} selected={selected} canEdit={canEdit} />}
      {!lod && (sortedBy || filterWords) && (
        <span className="fr-kanban__view-state">
          {filterWords && (
            <button type="button" className="fr-kanban__view-chip" data-fr-interactive="" title={`Filtered: ${filterWords}`} onPointerDown={stop} onClick={() => editor.openDock(VIEW_PANEL)}>
              <Filter size={12} aria-hidden />
              Filtered
            </button>
          )}
          {sortedBy && (
            <button
              type="button"
              className="fr-kanban__view-chip"
              data-fr-interactive=""
              title={`Sorted by ${sortedBy}: each column keeps that order (cards still move between columns)`}
              onPointerDown={stop}
              onClick={() => editor.openDock(VIEW_PANEL)}
            >
              <ArrowDownUp size={12} aria-hidden />
              Sorted by {sortedBy}
            </button>
          )}
        </span>
      )}
      {controls && board && columnsAreOptions(k) && (
        <button type="button" className="fr-kanban__add" data-fr-interactive="" onPointerDown={stop} onClick={() => addColumn(editor, k.id)}>
          <Plus size={14} aria-hidden />
          Column
        </button>
      )}
      {!lod && (selected || phone) && <FocusButton editor={editor} k={k} />}
    </div>
  );
}

const KanbanView = memo(function KanbanView(props: ElementRenderProps<KanbanElement>) {
  const { element: k, selected, zoom } = props;
  const editor = useEditor();
  const canEdit = useCanEdit();
  const exporting = useIsExporting();
  const phone = usePhoneLayout();
  const tabId = shownTabId(k, usePersonalView(k.id, MY_TAB_KEY));
  const tab = viewTabs(k).find((t) => t.id === tabId)!;
  const lod = zoom < LOD_ZOOM;
  // On a phone (viewing, not editing the board) a kanban opens in focus mode: its cards as a list.
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (selected && !wasSelected.current && phone === 'phone' && !exporting) editor.openPanel(FOCUS_PANEL, { id: k.id });
    wasSelected.current = selected;
  }, [selected, phone, exporting, editor, k.id]);
  if (tab.layout !== 'board')
    return (
      <div className="fr-kanban is-table">
        <Head editor={editor} k={k} selected={selected} lod={lod} tabId={tabId} board={false} canEdit={canEdit} phone={!!phone} />
        {lod ? (
          <div className="fr-kanban__table-lod" style={{ top: HEADER_H }} aria-hidden>
            {tab.name}
          </div>
        ) : (
          <ProjectionTab editor={editor} k={k} tab={tab} selected={selected && !exporting} />
        )}
      </div>
    );
  return <BoardTab {...props} tabId={tabId} phone={!!phone} />;
});

/** The Board tab: the columns (and swimlanes) the real cards stand in. */
function BoardTab({ element: k, selected, zoom, tabId, phone }: ElementRenderProps<KanbanElement> & { tabId: string; phone: boolean }) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const all = useElements();
  const { counts, laneCounts, more } = useGroups(k, all);
  const { titles, laneTitles } = useColumnTitles(k);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const view = boardView(k);
  const filterWords = view.filter ? describeFilter(view.filter, schema) : '';
  const options = columnsAreOptions(k);
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
      <Head editor={editor} k={k} selected={selected} lod={lod} tabId={tabId} board canEdit={canEdit} phone={phone} />
      {k.columns.map((col, i) => {
        const over = !!col.wip && counts[i] > col.wip;
        const title = titles[i];
        // Only a select's options are renamed in place; people and checkbox values say what the cards say.
        const renamable = options && col.id !== NO_GROUP;
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
                    {renamable ? (
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
                    ) : (
                      <span className={`fr-kanban__col-label${col.id === NO_GROUP ? ' is-none' : ''}`} style={{ paddingLeft: controls ? 4 : 12 }}>
                        {title}
                      </span>
                    )}
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
                  {controls && <ColumnMenu editor={editor} k={k} col={col} index={i} title={title} options={options} />}
                </>
              )}
            </div>
          </div>
        );
      })}
      {!lod &&
        (k.lanes ?? []).map((lane, i) => {
          const top = HEADER_H + COL_HEAD_H + (k.lanes ?? []).slice(0, i).reduce((sum, l) => sum + l.h, 0);
          return (
            <div key={lane.id} className={`fr-kanban__lane${lane.id === NO_GROUP ? ' is-none' : ''}`} style={{ top, left: GAP / 2, width: k.w - GAP, height: LANE_HEAD_H }}>
              <span className="fr-kanban__lane-title">{laneTitles[i]}</span>
              <span className="fr-kanban__count" title={`${laneCounts[i] ?? 0} items`}>
                {laneCounts[i] ?? 0}
              </span>
            </div>
          );
        })}
      {!lod &&
        more.map((m) =>
          k.columns[m.col]?.collapsed ? null : (
            <div key={`${m.col}:${m.lane}`} className="fr-kanban__folded" style={{ left: colLeft(k, m.col) + PAD, top: m.bottom - k.y + ITEM_GAP / 2, width: innerWidth(k.colW) }}>
              {m.n > 0 && (
                <button
                  type="button"
                  className="fr-kanban__more"
                  data-fr-interactive=""
                  // Editors show them on the board (for everyone); anyone else reads them in focus mode.
                  title={canEdit && !k.locked ? 'Show every card in this column' : `${m.n} more cards in this column: open in focus mode`}
                  onPointerDown={stop}
                  onClick={() => (canEdit && !k.locked ? setColumnLimit(editor, k.id, k.columns[m.col].id, 0) : editor.openPanel(FOCUS_PANEL, { id: k.id }))}
                >
                  +{m.n} more
                </button>
              )}
              {m.hidden > 0 && (
                <span className="fr-kanban__hidden" title={filterWords ? `Hidden by the filter: ${filterWords}` : undefined}>
                  {m.hidden} hidden by filter
                </span>
              )}
            </div>
          ),
        )}
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
}

/**
 * Zoomed out to low detail (#185): the board as its far-away drawing shows it (no text) — the
 * paper, and its columns with their colour band, or the tab's body — on the shared canvas. Its
 * cards paint themselves there too. The saved tab: what someone looks at for themselves is a
 * personal view the painter can't read, and at this size a column block reads the same.
 */
function paintKanban(k: KanbanElement, p: LowDetailPaint) {
  p.box({ fill: '#f4f3f9', stroke: '#17162B', strokeAlpha: 0.1, strokeWidth: 1 / p.zoom, radius: 14 });
  const tab = viewTabs(k).find((t) => t.id === shownTabId(k, undefined));
  const bodyH = k.h - HEADER_H - GAP;
  if (tab && tab.layout !== 'board') {
    p.rect(GAP, HEADER_H, k.w - 2 * GAP, bodyH, '#ffffff');
    return;
  }
  k.columns.forEach((col, i) => {
    const x = colLeft(k, i);
    const w = colWidth(k, i);
    p.rect(x, HEADER_H, w, bodyH, col.collapsed ? '#faf9fd' : '#ffffff');
    if (col.color) p.rect(x, HEADER_H, w, Math.min(4, bodyH), col.color);
  });
}

const kanban = defineElement({
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
  lowDetail: paintKanban,
  toPlainText: (k) => [richTextToPlain(k.title), ...k.columns.map((c) => richTextToPlain(c.title))].filter(Boolean).join('\n'),
  normalize(k) {
    const w = k.columns.length ? boardWidth(k) : kanbanWidth(0, k.colW);
    return w !== k.w ? { w } : null;
  },
  // Double-click a column (header or body) to rename it (a select's option); the board's header edits its title.
  textPartAt(k, local) {
    if (local.y < HEADER_H || !k.columns.length) return null;
    const col = k.columns[columnIndexAt({ ...k, x: 0 }, local.x)];
    return col.collapsed || col.id === NO_GROUP || !columnsAreOptions(k) ? null : columnPart(col.id);
  },
  // Keeps every item stacked in its column and cards' status (and colour) in step with the column they're in.
  arrange(k, { editor, previous }) {
    const { patches } = planLayout(k, editor.getElements(), previous);
    return patches.length ? patches : null;
  },
  // While cards are dragged over the board: where they would land, and the others making room.
  dragPreview: (k, { editor, moving }) => planDrop(k, editor.getElements(), moving),
  // A collapsed column's items, those beyond a column's card limit and the cards the view's filter
  // leaves out stay in it (in the outline, in the WIP count), folded away.
  // While I look at any tab but the board (a table, list, calendar, timeline), every item in it is
  // folded away for me alone (the tab draws the cards).
  hidesMember: (k, el, { editor }) => inCollapsedColumn(k, el) || beyondLimit(k, el) || filteredOut(k, el) || showsProjection(editor, k),
  // Cards show what the board view says: their colour (by column, by a field, or their own) and
  // the fields chosen, drawn by the card itself. Density changes their height (re-normalised).
  presentChild: (k, child, { editor, personal }) => presentCard(k, child, editor, personal),
  presentationKey,
});

/**
 * A linked view (step 3c, lib/LinkedView.tsx): a kanban elsewhere on the board as a table, list,
 * calendar or timeline in a box of its own. Not a container: the cards stay the kanban's. Copying it
 * within the board keeps its link (with its kanban copied along, the copy shows the kanban's copy);
 * pasting it onto another board, without its kanban, is refused for now — linked views across
 * boards are step 3d.
 */
const linkedView = defineElement({
  type: 'kanbanview',
  label: { one: 'Linked view', many: 'Linked views' },
  icon: Link2,
  resize: 'free',
  rotatable: false,
  minSize: LINKED_VIEW_MIN,
  defaults: (): Omit<NewElement<'kanbanview'>, 'x' | 'y'> => ({ type: 'kanbanview', ...LINKED_VIEW_SIZES.table, sourceId: '', view: newLinkedView('table') }),
  Component: LinkedViewElement,
  // Its box's paper colour (a thumbnail draws a far-away view as a box of it).
  swatch: () => '#f4f3f9',
  toPlainText: (lv) => linkedView_(lv).name,
  // Which board it was copied from, so a paste can tell a copy on the same board from one onto another.
  copyContent: (_lv, editor) => ({ board: editor.boardId }),
  pasteContent(lv, content, editor) {
    const from = content && typeof content === 'object' ? (content as { board?: unknown }).board : undefined;
    if (typeof from !== 'string' || from === editor.boardId || sourceOf(editor, lv)) return;
    editor.remove([lv.id]);
    editor.host.notify('Linked views stay on the board of their kanban for now: copy the kanban itself to take its cards along.', 'info');
  },
});

export default [kanban, linkedView] as unknown as ElementDefinition[];
