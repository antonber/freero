import { MessageSquarePlus } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { defineTool, usePointer, useCamera, type Editor, type Point } from '@engine';
import { Avatar } from '@ui';
import { anchorFor, areaFromDrag } from './lib/model';
import { TOOL_ID, setUi, startDraft, useCommentsUi } from './lib/state';

import { t } from './messages';
// A speech-bubble cursor with the hotspot at its tail (Freero's own drawing).
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 22V7a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H7z" fill="#5b3ff0" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 2 22, crosshair`;

/** The press in progress: where it started and what was under it. */
const pressing = new WeakMap<Editor, { start: Point; target: BoardElement | null }>();

export default defineTool({
  id: TOOL_ID,
  label: t('comment'),
  icon: MessageSquarePlus,
  shortcut: 'c',
  order: 80,
  placement: 'main',
  // Commenters can use it; the server accepts their writes to the comments map only.
  minRole: 'commenter',
  cursor: CURSOR,
  snapToGrid: false, // a pin goes exactly where it was clicked

  // A click pins a draft to the item under the pointer (it follows the item), else to the board;
  // a drag (#143) draws an area of the board the thread is about. Nothing is stored until the
  // first message is sent.
  onPointerDown({ editor, point, target, button }) {
    if (button !== 0) return;
    pressing.set(editor, { start: point, target });
  },
  onPointerMove({ editor, point, buttons }) {
    const p = pressing.get(editor);
    if (!p || !(buttons & 1)) return;
    const drag = areaFromDrag(p.start, point, editor.getCamera().zoom);
    setUi(editor, { dragArea: drag?.area ?? null });
  },
  onPointerUp({ editor, point }) {
    const p = pressing.get(editor);
    pressing.delete(editor);
    if (!p) return;
    setUi(editor, { dragArea: null });
    const drag = areaFromDrag(p.start, point, editor.getCamera().zoom);
    if (drag) startDraft(editor, { x: drag.x, y: drag.y, elementId: null, area: drag.area });
    else startDraft(editor, anchorFor(p.start, p.target));
  },
  onCancel(editor) {
    pressing.delete(editor);
    setUi(editor, { dragArea: null });
  },

  // Ghost pin under the pointer (world space, kept constant size), and the area being drawn.
  Preview: ({ editor }) => {
    const p = usePointer();
    const cam = useCamera();
    const area = useCommentsUi(editor, (s) => s.dragArea);
    return (
      <>
        {area ? (
          <div
            className="fr-cm-area is-drawing"
            style={{ transform: `translate(${area.x}px, ${area.y}px)`, width: area.w, height: area.h, borderWidth: 1.5 / cam.zoom, borderRadius: 6 / cam.zoom }}
          />
        ) : null}
        {p ? (
          <div className="fr-cm-pin-anchor" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${1 / cam.zoom})` }}>
            <div className="fr-cm-pin is-ghost is-preview">
              <Avatar name={editor.user.name} color={editor.user.color} size={26} />
            </div>
          </div>
        ) : null}
      </>
    );
  },
});
