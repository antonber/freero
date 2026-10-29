import { memo, useMemo, useRef, useState } from 'react';
import { Frame, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { BoardElement, FrameElement } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, useElements, useSelection, type Editor } from '@engine';
import { Button, IconButton, Input } from '@ui';
import { DEFAULT_FILL, isFrame, orderFrames, PANEL_ID, reorderPatches, TOOL_ID } from './lib/frames';
import { renameFrame, zoomToFrame } from './lib/actions';
import { Thumb } from './lib/Thumb';
import { DeckPanel, DECK_PANEL_ID } from './lib/DeckPanel';

const DRAG_PX = 4;

function Row(props: {
  editor: Editor;
  frame: FrameElement;
  position: number;
  children: BoardElement[];
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropSide: 'before' | 'after' | null;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { editor, frame, canEdit } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(frame.title);
  const startRename = () => {
    if (!canEdit) return;
    setDraft(frame.title);
    setRenaming(true);
  };
  const commit = () => {
    setRenaming(false);
    renameFrame(editor, frame.id, draft);
  };
  return (
    <li
      data-frame-id={frame.id}
      className={`fr-frames__item${props.selected ? ' is-selected' : ''}${props.dragging ? ' is-dragging' : ''}${props.dropSide ? ` drop-${props.dropSide}` : ''}`}
      onPointerDown={renaming ? undefined : props.onPointerDown}
      onDoubleClick={startRename}
    >
      <span className="fr-frames__num">{props.position + 1}</span>
      <span className="fr-frames__thumb">
        <Thumb frame={frame} children={props.children} w={84} h={56} />
      </span>
      {renaming ? (
        <Input
          className="fr-frames__name-input"
          value={draft}
          autoFocus
          aria-label="Frame title"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="fr-frames__name" title={frame.title}>
          {frame.title || 'Untitled frame'}
        </span>
      )}
      {canEdit && !renaming && (
        <span className="fr-frames__actions" onPointerDown={(e) => e.stopPropagation()}>
          <IconButton icon={Pencil} label="Rename" size={32} onClick={startRename} />
          <IconButton icon={Trash2} label="Delete frame" size={32} onClick={() => editor.remove([frame.id])} />
        </span>
      )}
    </li>
  );
}

function FramesPanel({ editor }: { editor: Editor }) {
  const all = useElements();
  const selection = useSelection();
  const canEdit = useCanEdit();
  const listRef = useRef<HTMLUListElement>(null);
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

  /** Insertion position (0..n) for a pointer at clientY, from the rows' midpoints. */
  const dropIndex = (clientY: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-frame-id]') ?? [])];
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return clientY < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };

  const onRowPointerDown = (frame: FrameElement) => (e: React.PointerEvent) => {
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
        const patches = reorderPatches(frames, frame.id, to);
        if (patches.length) editor.transact(() => patches.forEach(({ id, index }) => editor.update<FrameElement>(id, { index })));
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

  return (
    <div className="fr-frames">
      <DockHeader className="fr-frames__head">
        <h2 className="fr-frames__title">
          Frames{frames.length > 0 && <span className="fr-frames__count">{frames.length}</span>}
        </h2>
        <Button size="sm" variant="primary" icon={Play} onClick={() => editor.runCommand('present.start')}>
          Present
        </Button>
      </DockHeader>
      {frames.length ? (
        <ul className="fr-frames__list" ref={listRef} aria-label="Frames">
          {frames.map((f, i) => (
            <Row
              key={f.id}
              editor={editor}
              frame={f}
              position={i}
              children={childrenOf.get(f.id) ?? []}
              selected={selection.includes(f.id)}
              canEdit={canEdit}
              dragging={drag?.id === f.id}
              dropSide={sideFor(i)}
              onPointerDown={onRowPointerDown(f)}
            />
          ))}
        </ul>
      ) : (
        <div className="fr-frames__empty">
          <Frame size={28} strokeWidth={1.5} />
          <strong>No frames yet</strong>
          <span>Frames turn areas of the board into slides you can present, in this order.</span>
        </div>
      )}
      {canEdit && (
        <div className="fr-frames__foot">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => editor.setTool(TOOL_ID)}>
            Add frame
          </Button>
        </div>
      )}
    </div>
  );
}

export default [
  definePanel({
    id: PANEL_ID,
    slot: 'dock-right',
    order: 50,
    Component: FramesPanel,
  }),
  // The slide deck (KAI-126): the same frames in the same order, as slides with notes and layouts.
  definePanel({
    id: DECK_PANEL_ID,
    slot: 'dock-right',
    order: 51,
    Component: DeckPanel,
  }),
];
