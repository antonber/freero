import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Frame, Lock, LockOpen } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { definePanel, richTextToPlain, useCanEdit, useElements, useSelection, useViewHidden, type Editor } from '@engine';
import { Button, IconButton } from '@ui';
import { buildOutline, previewOf, restackZ, type OutlineGroup } from './lib/outline';
import { PANEL_ID } from './lib/ids';
import { typeInfo } from './lib/types';
import './layers.css';

const DRAG_PX = 4;

function labelOf(editor: Editor, el: BoardElement): string {
  const def = editor.getDefinition(el.type);
  const field = def?.textField;
  const text = def?.toPlainText
    ? def.toPlainText(el as never)
    : field
      ? richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? ''))
      : '';
  return previewOf(text ?? '') ?? typeInfo(el.type).name;
}

/** Hidden for this viewer: itself or a frame it sits in (what Editor.setViewHidden hides). */
function hiddenForMe(editor: Editor, el: BoardElement, hidden: ReadonlySet<string>): boolean {
  let cur: BoardElement | undefined = el;
  for (let i = 0; cur && i < 16; i++) {
    if (hidden.has(cur.id)) return true;
    cur = cur.frameId ? editor.getElement(cur.frameId) : undefined;
  }
  return false;
}

function Toggles({ editor, el, hidden, canEdit }: { editor: Editor; el: BoardElement; hidden: boolean; canEdit: boolean }) {
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
        label={hidden ? 'Show (hidden for you only)' : 'Hide for me (others still see it)'}
        size={32}
        active={hidden}
        className={hidden ? 'is-on' : undefined}
        onClick={() => editor.setViewHidden([el.id], !hidden)}
      />
    </span>
  );
}

function LayersPanel({ editor }: { editor: Editor }) {
  const elements = useElements();
  const selection = useSelection();
  const viewHidden = useViewHidden();
  const canEdit = useCanEdit();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; group: string; to: number } | null>(null);
  const listRefs = useRef(new Map<string, HTMLUListElement>());

  // Items off the board (collapsed mind-map branches) aren't listed; items hidden for me are.
  const groups = useMemo(
    () => buildOutline(elements.filter((el) => editor.getBounds([el.id]) || hiddenForMe(editor, el, viewHidden))),
    [editor, elements, viewHidden],
  );
  const selected = new Set(selection);
  const hiddenCount = useMemo(() => elements.filter((el) => viewHidden.has(el.id)).length, [elements, viewHidden]);

  const reveal = (el: BoardElement, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (hiddenForMe(editor, el, viewHidden)) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return editor.select([el.id], 'toggle');
    editor.select([el.id]);
    editor.zoomToFit([el.id], { maxZoom: Math.max(1, editor.getCamera().zoom), padding: 120 });
  };

  /** Insertion slot (0..n) in a group's list for a pointer at clientY, from row midpoints. */
  const slotAt = (groupKey: string, clientY: number) => {
    const rows = [...(listRefs.current.get(groupKey)?.querySelectorAll<HTMLElement>('[data-layer-id]') ?? [])];
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return clientY < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
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
      to = slotAt(groupKey, ev.clientY);
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

  const toggleGroup = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="fr-layers">
      <h2 className="fr-layers__title">
        Layers<span className="fr-layers__count">{elements.length}</span>
      </h2>
      {hiddenCount > 0 && (
        <div className="fr-layers__hiddenbar" role="status">
          <EyeOff size={14} />
          <span>
            {hiddenCount} hidden for you only
          </span>
          <Button size="sm" variant="ghost" onClick={() => editor.setViewHidden(editor.getViewHidden(), false)}>
            Show all
          </Button>
        </div>
      )}
      {!groups.length && <div className="fr-layers__empty">Nothing on the board yet.</div>}
      {groups.map((g) => {
        const key = g.frame?.id ?? 'board';
        const open = !collapsed.has(key);
        const frameHidden = !!g.frame && hiddenForMe(editor, g.frame, viewHidden);
        const dragFrom = drag && drag.group === key ? g.items.findIndex((x) => x.id === drag.id) : -1;
        const dropAt = drag && drag.group === key && drag.to !== dragFrom && drag.to !== dragFrom + 1 ? drag.to : -1;
        return (
          <section key={key} className={`fr-layers__group${frameHidden ? ' is-hidden' : ''}`}>
            <div
              className={`fr-layers__head${g.frame && selected.has(g.frame.id) ? ' is-selected' : ''}`}
              onClick={(e) => g.frame && reveal(g.frame, e)}
            >
              <IconButton
                icon={open ? ChevronDown : ChevronRight}
                label={open ? 'Collapse' : 'Expand'}
                size={32}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroup(key);
                }}
              />
              {g.frame && <Frame size={15} className="fr-layers__headicon" />}
              <span className="fr-layers__headname">{g.frame ? g.frame.title || 'Untitled frame' : 'Not in a frame'}</span>
              <span className="fr-layers__count">{g.items.length}</span>
              {g.frame && <Toggles editor={editor} el={g.frame} hidden={frameHidden} canEdit={canEdit} />}
            </div>
            {open && (
              <ul
                className="fr-layers__list"
                aria-label={g.frame ? `Items in ${g.frame.title}` : 'Items not in a frame'}
                ref={(node) => {
                  if (node) listRefs.current.set(key, node);
                  else listRefs.current.delete(key);
                }}
              >
                {g.items.map((el, i) => {
                  const hidden = hiddenForMe(editor, el, viewHidden);
                  const { icon: Icon } = typeInfo(el.type);
                  return (
                    <li
                      key={el.id}
                      data-layer-id={el.id}
                      className={[
                        'fr-layers__row',
                        selected.has(el.id) && 'is-selected',
                        hidden && 'is-hidden',
                        drag?.id === el.id && 'is-dragging',
                        dropAt === i && 'drop-before',
                        dropAt === g.items.length && i === g.items.length - 1 && 'drop-after',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onPointerDown={onRowPointerDown(g, key, el)}
                    >
                      <span className="fr-layers__icon">
                        <Icon size={15} />
                      </span>
                      <span className="fr-layers__name">{labelOf(editor, el)}</span>
                      <Toggles editor={editor} el={el} hidden={hidden} canEdit={canEdit} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
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
