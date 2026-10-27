import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FrameElement } from '@freero/shared';
import { defineElement, useCanEdit, useChromeHidden, useEditor, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { DEFAULT_FILL, presetById } from './lib/frames';
import { renameFrame } from './lib/actions';
import { startTitleDrag } from './lib/titleDrag';
import './frame.css';

/** Title text size on screen (px) while the frame is comfortably large. */
const TITLE_PX = 13;
/** Below this on-screen size the title is unreadable: hide it. */
const TITLE_MIN_PX = 7;

/** Live camera zoom (only re-renders when the zoom itself changes, not on pans). */
function useLiveZoom(editor: Editor): number {
  const subscribe = useCallback((cb: () => void) => editor.on('camera', cb), [editor]);
  return useSyncExternalStore(subscribe, () => editor.getCamera().zoom);
}

/** On-screen title font size for a frame `screenW` px wide: constant, shrinking only for tiny frames. */
function titleSize(screenW: number): number {
  return Math.min(TITLE_PX, screenW * 0.1);
}

function FrameTitle({ frame, zoom, selected }: { frame: FrameElement; zoom: number; selected: boolean }) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  // Presenting: slides show only their content.
  const chromeHidden = useChromeHidden();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(frame.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const screenW = frame.w * zoom;
  const px = titleSize(screenW);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if ((px < TITLE_MIN_PX || chromeHidden) && !editing) return null;

  const commit = () => {
    setEditing(false);
    renameFrame(editor, frame.id, draft);
  };

  return (
    <div
      className={`fr-frame__title${selected ? ' is-selected' : ''}`}
      style={{
        width: screenW,
        fontSize: Math.max(px, TITLE_MIN_PX),
        transform: `scale(${1 / zoom})`,
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          data-fr-interactive=""
          className="fr-frame__title-input"
          value={draft}
          aria-label="Frame title"
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(frame.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          data-fr-interactive=""
          className="fr-frame__title-text"
          title={frame.title}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            if (e.shiftKey) editor.select([frame.id], 'toggle');
            else if (!editor.getSelection().includes(frame.id)) editor.select([frame.id]);
            if (canEdit && !frame.locked) startTitleDrag(editor, frame.id, e.nativeEvent);
          }}
          onDoubleClick={() => {
            if (!canEdit) return;
            setDraft(frame.title);
            setEditing(true);
          }}
        >
          {frame.title || 'Untitled frame'}
        </span>
      )}
    </div>
  );
}

const FrameView = memo(function FrameView({ element, selected }: ElementRenderProps<FrameElement>) {
  const editor = useEditor();
  const zoom = useLiveZoom(editor);
  return (
    <>
      <div
        className="fr-frame"
        style={{
          background: element.fill || DEFAULT_FILL,
          // A hairline that stays 1 screen px at any zoom.
          boxShadow: `0 0 0 ${1 / zoom}px rgba(23, 22, 43, 0.14), 0 ${2 / zoom}px ${10 / zoom}px rgba(23, 22, 43, 0.05)`,
        }}
      />
      <FrameTitle frame={element} zoom={zoom} selected={selected} />
    </>
  );
});

export default defineElement({
  type: 'frame',
  resize: 'free',
  minSize: { w: 40, h: 40 },
  container: true,
  rotatable: false,
  defaults: (): Omit<NewElement<'frame'>, 'x' | 'y'> => {
    const p = presetById('16:9');
    return { type: 'frame', w: p.w, h: p.h, title: 'Frame', fill: DEFAULT_FILL, index: 0, preset: p.id };
  },
  Component: FrameView,
  toPlainText: (el) => el.title,
});
