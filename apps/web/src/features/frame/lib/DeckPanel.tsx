// The slide deck (KAI-126): the board's frames as slides, in presentation order — the order
// presenting and PDF export use. Drag to reorder, skip, duplicate, give a slide a layout, and
// write its speaker notes (the present feature's presenter notes, written through its command).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, EyeOff, Eye, LayoutTemplate, MoreHorizontal, Play, Plus, Presentation, Trash2 } from 'lucide-react';
import type { BoardElement, FrameElement } from '@freero/shared';
import { DockHeader, useCanEdit, useCollection, useElements, useSelection, type Editor } from '@engine';
import { Button, Menu, type MenuItem } from '@ui';
import { isFrame, orderFrames } from './frames';
import { applyLayout, duplicateSlide, moveSlide, newSlide, setSkipped, zoomToFrame } from './actions';
import { SLIDE_LAYOUTS, type SlideLayoutId } from './layouts';
import { Thumb } from './Thumb';

export const DECK_PANEL_ID = 'frame.deck';
/** Presenter notes (owned by features/present; read here, written with `present.setNote`). */
const NOTES = 'presenterNotes';
const THUMB_W = 276;
const THUMB_H = 156;
const DRAG_PX = 4;

const noteText = (v: unknown) => {
  const t = (v as { text?: unknown } | undefined)?.text;
  return typeof t === 'string' ? t : '';
};

function layoutMenu(onPick: (id: SlideLayoutId | null) => void, blank: boolean): MenuItem[] {
  return [
    ...(blank ? [{ id: 'blank', label: 'Blank', onSelect: () => onPick(null) }] : []),
    ...SLIDE_LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: LayoutTemplate, onSelect: () => onPick(l.id) })),
  ];
}

function Notes({ editor, frame, text, canEdit }: { editor: Editor; frame: FrameElement; text: string; canEdit: boolean }) {
  const [draft, setDraft] = useState(text);
  const focused = useRef(false);
  // Someone else's edit shows unless this person is typing.
  useEffect(() => {
    if (!focused.current) setDraft(text);
  }, [text]);
  const save = () => editor.runCommand('present.setNote', { frameId: frame.id, text: draft });
  if (!canEdit)
    return text ? (
      <p className="fr-deck__notes is-read">{text}</p>
    ) : null;
  return (
    <textarea
      className="fr-deck__notes"
      aria-label={`Speaker notes for ${frame.title || 'this slide'}`}
      placeholder="Speaker notes (only you see them while presenting)"
      value={draft}
      rows={3}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        save();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

const Slide = memo(function Slide(props: {
  editor: Editor;
  frame: FrameElement;
  position: number;
  children: BoardElement[];
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropSide: 'before' | 'after' | null;
  note: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { editor, frame, canEdit } = props;
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [
    { id: 'layout', label: 'Layout', icon: LayoutTemplate, onSelect: () => undefined, submenu: layoutMenu((id) => id && applyLayout(editor, frame.id, id), false) },
    { id: 'dup', label: 'Duplicate slide', icon: Copy, onSelect: () => duplicateSlide(editor, frame.id) },
    frame.skip
      ? { id: 'unskip', label: 'Include in presentation', icon: Eye, onSelect: () => setSkipped(editor, [frame], false) }
      : { id: 'skip', label: 'Skip in presentation', icon: EyeOff, onSelect: () => setSkipped(editor, [frame], true) },
    { divider: true },
    { id: 'delete', label: 'Delete slide', icon: Trash2, danger: true, onSelect: () => editor.remove([frame.id]) },
  ];
  return (
    <li
      data-frame-id={frame.id}
      className={`fr-deck__slide${props.selected ? ' is-selected' : ''}${frame.skip ? ' is-skipped' : ''}${props.dragging ? ' is-dragging' : ''}${props.dropSide ? ` drop-${props.dropSide}` : ''}`}
    >
      <div className="fr-deck__card" onPointerDown={props.onPointerDown}>
        <span className="fr-deck__num">{props.position + 1}</span>
        <span className="fr-deck__thumb" style={{ height: THUMB_H }}>
          <Thumb frame={frame} children={props.children} w={THUMB_W} h={THUMB_H} />
          {frame.skip && (
            <span className="fr-deck__skipped">
              <EyeOff size={12} aria-hidden /> Skipped
            </span>
          )}
        </span>
        <span className="fr-deck__title">
          <span title={frame.title}>{frame.title || 'Untitled slide'}</span>
          {canEdit && (
            <button
              ref={ref}
              type="button"
              className="fr-deck__more"
              aria-label={`Slide options: ${frame.title || 'Untitled slide'}`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setMenu((o) => !o)}
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
          )}
        </span>
      </div>
      {props.selected && <Notes editor={editor} frame={frame} text={props.note} canEdit={canEdit} />}
      {canEdit && <Menu open={menu} onClose={() => setMenu(false)} anchor={ref.current} items={items} aria-label="Slide options" />}
    </li>
  );
});

export function DeckPanel({ editor }: { editor: Editor }) {
  const all = useElements();
  const selection = useSelection();
  const canEdit = useCanEdit();
  const notes = useCollection<unknown>(NOTES);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);

  const { frames, childrenOf } = useMemo(() => {
    const fs = orderFrames(all.filter(isFrame));
    const map = new Map<string, BoardElement[]>();
    for (const el of all) {
      if (!el.frameId || el.type === 'frame') continue;
      const list = map.get(el.frameId) ?? [];
      list.push(el);
      map.set(el.frameId, list);
    }
    return { frames: fs, childrenOf: map };
  }, [all]);
  const noteOf = useMemo(() => new Map(notes.map(([k, v]) => [k, noteText(v)])), [notes]);
  const shown = frames.filter((f) => !f.skip).length;

  const dropIndex = (clientY: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-frame-id]') ?? [])];
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return clientY < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };

  const onPointerDown = (frame: FrameElement) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let to = -1;
    const move = (ev: PointerEvent) => {
      if (!canEdit) return;
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
      dragging = true;
      to = dropIndex(ev.clientY);
      setDrag({ id: frame.id, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (dragging) {
        moveSlide(editor, frame.id, to);
        return;
      }
      const fresh = editor.getElement<FrameElement>(frame.id);
      if (!fresh) return;
      editor.select([fresh.id]);
      zoomToFrame(editor, fresh);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const dragFrom = drag ? frames.findIndex((f) => f.id === drag.id) : -1;
  const sideFor = (i: number): 'before' | 'after' | null => {
    if (!drag || drag.to === dragFrom || drag.to === dragFrom + 1) return null;
    if (drag.to === i) return 'before';
    if (i === frames.length - 1 && drag.to === frames.length) return 'after';
    return null;
  };
  const selectedFrame = frames.find((f) => selection.includes(f.id));
  const add = (layout: SlideLayoutId | null) => {
    const id = newSlide(editor, layout, selectedFrame?.id);
    const f = id ? editor.getElement<FrameElement>(id) : undefined;
    if (f) zoomToFrame(editor, f);
  };

  return (
    <div className="fr-deck">
      <DockHeader className="fr-frames__head">
        <h2 className="fr-frames__title">
          Slides
          {frames.length > 0 && <span className="fr-frames__count">{shown === frames.length ? frames.length : `${shown} of ${frames.length}`}</span>}
        </h2>
        <Button size="sm" variant="primary" icon={Play} disabled={!shown} onClick={() => editor.runCommand('present.start')}>
          Present
        </Button>
      </DockHeader>
      {frames.length ? (
        <ul className="fr-deck__list" ref={listRef} aria-label="Slides">
          {frames.map((f, i) => (
            <Slide
              key={f.id}
              editor={editor}
              frame={f}
              position={i}
              children={childrenOf.get(f.id) ?? []}
              selected={selection.includes(f.id)}
              canEdit={canEdit}
              dragging={drag?.id === f.id}
              dropSide={sideFor(i)}
              note={noteOf.get(f.id) ?? ''}
              onPointerDown={onPointerDown(f)}
            />
          ))}
        </ul>
      ) : (
        <div className="fr-frames__empty">
          <Presentation size={28} strokeWidth={1.5} />
          <strong>No slides yet</strong>
          <span>Each frame is a slide. Add one with a layout to start a deck; presenting and PDF export follow this order.</span>
        </div>
      )}
      {canEdit && (
        <div className="fr-frames__foot" ref={addRef}>
          <Button size="sm" variant="secondary" icon={Plus} aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding((o) => !o)}>
            New slide
          </Button>
          <Menu open={adding} onClose={() => setAdding(false)} anchor={addRef.current} side="top" items={layoutMenu(add, true)} aria-label="New slide layout" />
        </div>
      )}
    </div>
  );
}
