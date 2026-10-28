import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Frame, Lock, LockOpen } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { DockHeader, definePanel, richTextToPlain, useCanEdit, useElements, useSelection, useViewHidden, type Editor } from '@engine';
import { Button, IconButton } from '@ui';
import { buildOutline, previewOf, restackZ, type OutlineGroup } from './lib/outline';
import { PANEL_ID } from './lib/ids';
import { layoutRows, scrollToShow, slotAt, visibleRange, type LayerRow } from './lib/rows';
import { typeInfo } from './lib/types';
import './layers.css';

const DRAG_PX = 4;

function labelOf(editor: Editor, el: BoardElement): string {
  const def = editor.getDefinition(el.type);
  const field = def?.textField;
  const text = def?.toPlainText
    ? def.toPlainText(el as never, editor)
    : field
      ? richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? ''))
      : '';
  return previewOf(text ?? '') ?? typeInfo(el.type).name;
}

function Toggles({ editor, el, viewHidden, canEdit }: { editor: Editor; el: BoardElement; viewHidden: ReadonlySet<string>; canEdit: boolean }) {
  const hidden = editor.isViewHidden(el.id);
  // Hidden because its frame, or an item it is attached to, is: shown from there, not here.
  const inherited = hidden && !viewHidden.has(el.id);
  return (
    <span className="fr-layers__toggles" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {(canEdit || el.locked) && (
        <IconButton
          icon={el.locked ? Lock : LockOpen}
          label={el.locked ? 'Unlock' : 'Lock'}
          size={32}
          active={!!el.locked}
          disabled={!canEdit}
          className={el.locked ? 'is-on' : undefined}
          onClick={() => {
            editor.beginGesture();
            editor.update(el.id, { locked: !el.locked });
            editor.endGesture();
          }}
        />
      )}
      <IconButton
        icon={hidden ? EyeOff : Eye}
        label={inherited ? 'Hidden with its frame or the item it’s attached to' : hidden ? 'Show (hidden for you only)' : 'Hide for me (others still see it)'}
        size={32}
        active={hidden}
        disabled={inherited}
        className={hidden ? 'is-on' : undefined}
        onClick={() => editor.setViewHidden([el.id], !hidden)}
      />
    </span>
  );
}

/** The element a row stands for (a group head: its frame; the loose-items head: none). */
const rowElement = (r: LayerRow): BoardElement | null => (r.kind === 'item' ? r.el : r.group.frame);
/** The row key of an element: frames are group heads. */
const rowKeyOf = (el: Pick<BoardElement, 'id' | 'type'>) => (el.type === 'frame' ? `g:${el.id}` : el.id);

function LayersPanel({ editor }: { editor: Editor }) {
  const elements = useElements();
  const selection = useSelection();
  const viewHidden = useViewHidden();
  const canEdit = useCanEdit();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; group: string; to: number } | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  /** Keyboard cursor (row key). */
  const [cursor, setCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Items off the board (collapsed mind-map branches) aren't listed; items hidden for me are.
  const groups = useMemo(
    () => buildOutline(elements.filter((el) => editor.getBounds([el.id]) || editor.isViewHidden(el.id))),
    // viewHidden: what isViewHidden answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, elements, viewHidden],
  );
  const { rows, height } = useMemo(() => layoutRows(groups, collapsed), [groups, collapsed]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selected = new Set(selection);
  const hiddenCount = useMemo(() => elements.filter((el) => viewHidden.has(el.id)).length, [elements, viewHidden]);
  const [from, to] = visibleRange(rows, view.top, view.height);

  // Track the scroll box's size (the dock can change height with the window).
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => setView({ top: box.scrollTop, height: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const showRow = (key: string) => {
    const box = scrollRef.current;
    const row = rowsRef.current.find((r) => r.key === key);
    if (!box || !row) return;
    const next = scrollToShow(row, box.scrollTop, box.clientHeight);
    if (next !== null) box.scrollTop = next;
  };

  // Selected on the canvas (or here): its row scrolls into view and takes the keyboard cursor.
  const selId = selection[selection.length - 1] ?? null;
  useEffect(() => {
    const el = selId ? editor.getElement(selId) : undefined;
    if (!el) return;
    setCursor(rowKeyOf(el));
    showRow(rowKeyOf(el));
    // Only when the selection changes, never because the board changed under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const reveal = (el: BoardElement, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    setCursor(rowKeyOf(el));
    if (editor.isViewHidden(el.id)) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return editor.select([el.id], 'toggle');
    editor.select([el.id]);
    editor.zoomToFit([el.id], { maxZoom: Math.max(1, editor.getCamera().zoom), padding: 120 });
  };

  const onRowPointerDown = (group: OutlineGroup, groupKey: string, el: BoardElement) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const mods = { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey };
    let to = -1;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!canEdit || el.locked) return;
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
      dragging = true;
      const top = canvasRef.current?.getBoundingClientRect().top ?? 0;
      to = slotAt(rowsRef.current, groupKey, ev.clientY - top);
      setDrag({ id: el.id, group: groupKey, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!dragging) return reveal(el, mods);
      const z = restackZ(group.items, el.id, to);
      if (z === null) return;
      editor.beginGesture();
      editor.update(el.id, { z });
      editor.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const toggleGroup = (key: string, open?: boolean) =>
    setCollapsed((cur) => {
      const isOpen = !cur.has(key);
      if (open !== undefined && open === isOpen) return cur;
      const next = new Set(cur);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });

  // Arrow keys walk the rows (selecting what they land on), Enter shows it on the board,
  // Left / Right fold a group. The engine leaves keys inside this list alone (keyboard trap).
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== e.currentTarget || !rows.length) return;
    const at = Math.max(0, rows.findIndex((r) => r.key === cursor));
    const cur = rows[at];
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, cursor ? at + 1 : 0);
    else if (e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'Enter') {
      const el = rowElement(cur);
      if (el) reveal(el, e);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && cur.kind === 'head') toggleGroup(cur.groupKey, e.key === 'ArrowRight');
    else if (e.key === 'ArrowLeft' && cur.kind === 'item') next = rows.findIndex((r) => r.kind === 'head' && r.groupKey === cur.groupKey);
    else return;
    e.preventDefault();
    if (next < 0) return;
    const row = rows[next];
    setCursor(row.key);
    showRow(row.key);
    const el = rowElement(row);
    if (el && !editor.isViewHidden(el.id)) editor.select([el.id]);
  };

  const renderRow = (r: LayerRow) => {
    const style = { top: r.top };
    if (r.kind === 'head') {
      const g = r.group;
      const open = !collapsed.has(r.groupKey);
      const frameHidden = !!g.frame && editor.isViewHidden(g.frame.id);
      return (
        <div
          key={r.key}
          role="treeitem"
          aria-level={1}
          aria-expanded={open}
          aria-selected={!!g.frame && selected.has(g.frame.id)}
          style={style}
          className={[
            'fr-layers__head',
            g.frame && selected.has(g.frame.id) && 'is-selected',
            frameHidden && 'is-hidden',
            cursor === r.key && 'is-cursor',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={(e) => g.frame && reveal(g.frame, e)}
        >
          <IconButton
            icon={open ? ChevronDown : ChevronRight}
            label={open ? 'Collapse' : 'Expand'}
            size={32}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroup(r.groupKey);
            }}
          />
          {g.frame && <Frame size={15} className="fr-layers__headicon" />}
          <span className="fr-layers__headname">{g.frame ? g.frame.title || 'Untitled frame' : 'Not in a frame'}</span>
          <span className="fr-layers__count">{g.items.length}</span>
          {g.frame && <Toggles editor={editor} el={g.frame} viewHidden={viewHidden} canEdit={canEdit} />}
        </div>
      );
    }
    const { el, index: i, group: g } = r;
    const dragFrom = drag && drag.group === r.groupKey ? g.items.findIndex((x) => x.id === drag.id) : -1;
    const dropAt = drag && drag.group === r.groupKey && drag.to !== dragFrom && drag.to !== dragFrom + 1 ? drag.to : -1;
    const { icon: Icon } = typeInfo(el.type);
    return (
      <div
        key={r.key}
        role="treeitem"
        aria-level={2}
        aria-selected={selected.has(el.id)}
        data-layer-id={el.id}
        style={style}
        className={[
          'fr-layers__row',
          selected.has(el.id) && 'is-selected',
          editor.isViewHidden(el.id) && 'is-hidden',
          cursor === r.key && 'is-cursor',
          drag?.id === el.id && 'is-dragging',
          dropAt === i && 'drop-before',
          dropAt === g.items.length && i === g.items.length - 1 && 'drop-after',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={onRowPointerDown(g, r.groupKey, el)}
      >
        <span className="fr-layers__icon">
          <Icon size={15} />
        </span>
        <span className="fr-layers__name">{labelOf(editor, el)}</span>
        <Toggles editor={editor} el={el} viewHidden={viewHidden} canEdit={canEdit} />
      </div>
    );
  };

  return (
    <div className="fr-layers">
      <DockHeader className="fr-layers__dockhead">
        <h2 className="fr-layers__title">
          Layers<span className="fr-layers__count">{elements.length}</span>
        </h2>
      </DockHeader>
      {hiddenCount > 0 && (
        <div className="fr-layers__hiddenbar" role="status">
          <EyeOff size={14} />
          <span>{hiddenCount} hidden for you only</span>
          <Button size="sm" variant="ghost" onClick={() => editor.setViewHidden(editor.getViewHidden(), false)}>
            Show all
          </Button>
        </div>
      )}
      {!groups.length && <div className="fr-layers__empty">Nothing on the board yet.</div>}
      <div
        ref={scrollRef}
        className="fr-layers__scroll"
        role="tree"
        aria-label="Layers"
        tabIndex={rows.length ? 0 : -1}
        data-fr-keyboard-trap
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          const box = e.currentTarget;
          setView({ top: box.scrollTop, height: box.clientHeight });
        }}
      >
        <div ref={canvasRef} className="fr-layers__canvas" style={{ height }}>
          {rows.slice(from, to).map(renderRow)}
        </div>
      </div>
      {canEdit && groups.some((g) => g.items.length > 1) && <p className="fr-layers__tip">Drag to restack: the top of each list is in front.</p>}
    </div>
  );
}

export default definePanel({
  id: PANEL_ID,
  slot: 'dock-right',
  order: 45,
  minRole: 'viewer',
  Component: LayersPanel,
});
