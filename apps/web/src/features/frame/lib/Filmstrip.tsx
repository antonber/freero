// The slide filmstrip (#52): the deck as a strip under the canvas (the engine's 'dock-bottom'
// slot), in the order presenting and PDF export use. Real slide pictures, drag sideways to
// reorder, a slide's options on its "…" (or right-click), a new slide with a layout at the end of
// the strip, and the side deck (speaker notes) one click away.
import { memo, useEffect, useRef, useState } from 'react';
import { EyeOff, MoreHorizontal, NotebookText, Play, Plus, X } from 'lucide-react';
import type { BoardElement, FrameElement } from '@freero/shared';
import { useCanEdit, useSelection, type Editor } from '@engine';
import { Button, IconButton, Menu, type MenuItem } from '@ui';
import { moveSlide, newSlide, zoomToFrame } from './actions';
import { DECK_PANEL_ID } from './DeckPanel';
import type { SlideLayoutId } from './layouts';
import { layoutMenu, slideMenu } from './slideMenu';
import { SlideThumb } from './Thumb';
import { useSlides } from './useSlides';

export const FILMSTRIP_ID = 'frame.filmstrip';
const THUMB_W = 148;
const THUMB_H = 84;
const DRAG_PX = 4;

const Tile = memo(function Tile(props: {
  editor: Editor;
  frame: FrameElement;
  position: number;
  children: BoardElement[];
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropSide: 'before' | 'after' | null;
  extraMenu: (frame: FrameElement) => MenuItem[];
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const { editor, frame, canEdit } = props;
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tileRef = useRef<HTMLLIElement>(null);
  const name = frame.title || 'Untitled slide';
  useEffect(() => {
    if (props.selected) tileRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [props.selected]);
  return (
    <li
      ref={tileRef}
      data-frame-id={frame.id}
      className={`fr-film__tile${props.selected ? ' is-selected' : ''}${frame.skip ? ' is-skipped' : ''}${props.dragging ? ' is-dragging' : ''}${props.dropSide ? ` drop-${props.dropSide}` : ''}`}
      onContextMenu={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setMenu(true);
      }}
    >
      <div
        className="fr-film__card"
        role="button"
        tabIndex={0}
        aria-label={`Slide ${props.position + 1}: ${name}`}
        aria-pressed={props.selected}
        onPointerDown={props.onPointerDown}
        onDoubleClick={props.onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onOpen();
        }}
      >
        <span className="fr-film__thumb" style={{ width: THUMB_W, height: THUMB_H }}>
          <SlideThumb editor={editor} frame={frame} children={props.children} w={THUMB_W} h={THUMB_H} />
          {frame.skip && (
            <span className="fr-film__skipped" title="Skipped in presentation">
              <EyeOff size={12} aria-label="Skipped" />
            </span>
          )}
        </span>
        <span className="fr-film__label">
          <span className="fr-film__num">{props.position + 1}</span>
          <span className="fr-film__name" title={frame.title}>
            {name}
          </span>
        </span>
      </div>
      {canEdit && (
        <>
          <button
            ref={ref}
            type="button"
            className="fr-film__more"
            aria-label={`Slide options: ${name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenu((o) => !o)}
          >
            <MoreHorizontal size={14} aria-hidden />
          </button>
          <Menu open={menu} onClose={() => setMenu(false)} anchor={ref.current} side="top" items={slideMenu(editor, frame, props.extraMenu(frame))} aria-label="Slide options" />
        </>
      )}
    </li>
  );
});

/**
 * The strip. `extraMenu` adds entries to the front of a slide's menu, and `onOpen` is what a
 * double-click (or Enter) on a slide does — both supplied by the panel (the slide editor, #135).
 */
export function Filmstrip({ editor, onOpen, extraMenu }: { editor: Editor; onOpen?: (frame: FrameElement) => void; extraMenu?: (frame: FrameElement) => MenuItem[] }) {
  const { frames, childrenOf } = useSlides();
  const selection = useSelection();
  const canEdit = useCanEdit();
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const shown = frames.filter((f) => !f.skip).length;

  /** Insertion slot (0..n) for a pointer at clientX, from the tiles' midpoints. */
  const dropIndex = (clientX: number) => {
    const tiles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-frame-id]') ?? [])];
    const i = tiles.findIndex((t) => {
      const b = t.getBoundingClientRect();
      return clientX < b.left + b.width / 2;
    });
    return i < 0 ? tiles.length : i;
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
      to = dropIndex(ev.clientX);
      setDrag({ id: frame.id, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (dragging) return moveSlide(editor, frame.id, to);
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
    <div className="fr-film">
      <div className="fr-film__side">
        <span className="fr-film__count">
          {frames.length ? (shown === frames.length ? `${frames.length} ${frames.length === 1 ? 'slide' : 'slides'}` : `${shown} of ${frames.length} shown`) : 'No slides'}
        </span>
        <Button size="sm" variant="primary" icon={Play} disabled={!shown} onClick={() => editor.runCommand('present.start')}>
          Present
        </Button>
      </div>
      <ul className="fr-film__list" ref={listRef} aria-label="Slides" data-fr-scrollable="">
        {frames.map((f, i) => (
          <Tile
            key={f.id}
            editor={editor}
            frame={f}
            position={i}
            children={childrenOf.get(f.id) ?? []}
            selected={selection.includes(f.id)}
            canEdit={canEdit}
            dragging={drag?.id === f.id}
            dropSide={sideFor(i)}
            extraMenu={extraMenu ?? (() => [])}
            onPointerDown={onPointerDown(f)}
            onOpen={() => onOpen?.(f)}
          />
        ))}
        {canEdit && (
          <li className="fr-film__add">
            <button
              ref={addRef}
              type="button"
              className="fr-film__addbtn"
              style={{ width: THUMB_W, height: THUMB_H }}
              aria-haspopup="menu"
              aria-expanded={adding}
              onClick={() => setAdding((o) => !o)}
            >
              <Plus size={20} aria-hidden />
              <span>New slide</span>
            </button>
            <Menu open={adding} onClose={() => setAdding(false)} anchor={addRef.current} side="top" items={layoutMenu(add, true)} aria-label="New slide layout" />
          </li>
        )}
      </ul>
      <div className="fr-film__side fr-film__side--end">
        <IconButton icon={NotebookText} label="Slides with speaker notes" size={32} tooltipSide="top" onClick={() => editor.openDock(editor.getDock() === DECK_PANEL_ID ? null : DECK_PANEL_ID)} />
        <IconButton icon={X} label="Close filmstrip" size={32} tooltipSide="top" onClick={() => editor.openBottomDock(null)} />
      </div>
    </div>
  );
}
