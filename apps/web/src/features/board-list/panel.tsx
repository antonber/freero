// "Board as list": the board's semantic outline (Editor.getOutline — what agents read too) as an
// ARIA tree. Frames hold their items in reading order, connectors read as "A → B". One tab stop
// (roving focus): arrows move, Right / Left open and close a frame, Enter goes to the item on the
// canvas. The way to read a whole board with a screen reader, or skim it without panning.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DockHeader, definePanel, useElements, usePeers, useSelection, type Editor } from '@engine';
import type { OutlineItem } from '@freero/shared';
import { PANEL_ID } from './lib/ids';
import { elementIdsOf, kindLabel, rowLabel, treeRows } from './lib/rows';
import './board-list.css';

function BoardList({ editor }: { editor: Editor }) {
  const elements = useElements();
  const peers = usePeers();
  const selection = useSelection();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const focusOnRender = useRef(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => editor.getOutline(), [editor, elements, peers]);
  const rows = useMemo(() => treeRows(outline, collapsed), [outline, collapsed]);
  const byId = useMemo(() => {
    const m = new Map<string, OutlineItem>();
    const walk = (items: OutlineItem[]) => items.forEach((i) => (m.set(i.id, i), walk(i.children ?? [])));
    walk(outline.items);
    return m;
  }, [outline]);
  const selected = new Set(selection);
  const current = rows.find((r) => r.item.id === active) ?? rows.find((r) => selected.has(r.item.id)) ?? rows[0];

  // Opening the list (the command, a click on its button) puts the keyboard in it.
  useLayoutEffect(() => {
    if (!focusOnRender.current || !current) return;
    focusOnRender.current = false;
    treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(current.item.id)}"]`)?.focus({ preventScroll: false });
  });

  const focusRow = (id: string) => {
    setActive(id);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus());
  };

  const goTo = (item: OutlineItem) => {
    const ids = elementIdsOf(editor, item);
    if (!ids.length) return;
    editor.select(ids);
    editor.zoomToFit(ids, { maxZoom: Math.max(1, editor.getCamera().zoom) });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!current) return;
    const i = rows.indexOf(current);
    const row = current;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        if (rows[i + 1]) focusRow(rows[i + 1].item.id);
        return;
      case 'ArrowUp':
        handled();
        if (rows[i - 1]) focusRow(rows[i - 1].item.id);
        return;
      case 'Home':
        handled();
        if (rows[0]) focusRow(rows[0].item.id);
        return;
      case 'End':
        handled();
        if (rows.length) focusRow(rows[rows.length - 1].item.id);
        return;
      case 'ArrowRight':
        handled();
        if (row.hasChildren && collapsed.has(row.item.id)) setCollapsed((c) => new Set([...c].filter((x) => x !== row.item.id)));
        else if (row.hasChildren && rows[i + 1]) focusRow(rows[i + 1].item.id);
        return;
      case 'ArrowLeft':
        handled();
        if (row.hasChildren && !collapsed.has(row.item.id)) setCollapsed((c) => new Set([...c, row.item.id]));
        else if (row.parent) focusRow(row.parent);
        return;
      case 'Enter':
      case ' ':
        handled();
        goTo(row.item);
        return;
    }
  };

  const edgeName = (id: string | null) => {
    const item = id ? byId.get(id) : undefined;
    return item ? [kindLabel(editor, item), item.title ?? item.text?.slice(0, 60)].filter(Boolean).join(': ') : 'nothing';
  };

  return (
    <div className="fr-board-list">
      <DockHeader className="fr-board-list__dockhead">
        <h2 className="fr-board-list__title">
          Board as list<span className="fr-board-list__count">{outline.meta.itemCount}</span>
        </h2>
      </DockHeader>
      <p className="fr-board-list__hint" id="fr-board-list-hint">
        Every item in reading order, a frame’s items under it. Arrow keys move, Right and Left open and close a frame, Enter shows the item on the board.
      </p>
      {rows.length === 0 ? (
        <p className="fr-board-list__empty">This board is empty.</p>
      ) : (
        <ul className="fr-board-list__tree" role="tree" aria-label="Board items" aria-describedby="fr-board-list-hint" ref={treeRef} onKeyDown={onKeyDown}>
          {rows.map((r) => (
            <li
              key={r.item.id}
              data-row={r.item.id}
              role="treeitem"
              aria-level={r.level}
              aria-posinset={r.pos}
              aria-setsize={r.size}
              aria-expanded={r.hasChildren ? !collapsed.has(r.item.id) : undefined}
              aria-selected={selected.has(r.item.id)}
              tabIndex={r === current ? 0 : -1}
              className={`fr-board-list__row${selected.has(r.item.id) ? ' is-selected' : ''}`}
              style={{ paddingLeft: 8 + (r.level - 1) * 16 }}
              onFocus={() => setActive(r.item.id)}
              onClick={() => {
                setActive(r.item.id);
                goTo(r.item);
              }}
            >
              {rowLabel(editor, r.item)}
            </li>
          ))}
        </ul>
      )}
      {outline.edges.length > 0 && (
        <>
          <h3 className="fr-board-list__sub">Connections</h3>
          <ul className="fr-board-list__edges">
            {outline.edges.map((edge) => (
              <li key={edge.id}>
                {edge.arrow === 'backward' ? `${edgeName(edge.to)} → ${edgeName(edge.from)}` : `${edgeName(edge.from)} ${edge.arrow === 'both' ? '↔' : edge.arrow === 'none' ? '—' : '→'} ${edgeName(edge.to)}`}
                {edge.label ? ` (${edge.label})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {outline.notes.length > 0 && (
        <ul className="fr-board-list__notes">
          {outline.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default definePanel({ id: PANEL_ID, slot: 'dock-right', order: 50, minRole: 'viewer', Component: BoardList });
