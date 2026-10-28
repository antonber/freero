import { MessageSquarePlus } from 'lucide-react';
import { defineTool, usePointer, useCamera } from '@engine';
import { Avatar } from '@ui';
import { anchorFor } from './lib/model';
import { TOOL_ID, startDraft } from './lib/state';

// A speech-bubble cursor with the hotspot at its tail (Freero's own drawing).
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 22V7a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H7z" fill="#5b3ff0" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 2 22, crosshair`;

export default defineTool({
  id: TOOL_ID,
  label: 'Comment',
  icon: MessageSquarePlus,
  shortcut: 'c',
  order: 80,
  placement: 'main',
  // Commenters can use it; the server accepts their writes to the comments map only.
  minRole: 'commenter',
  cursor: CURSOR,
  snapToGrid: false, // a pin goes exactly where it was clicked

  // Click pins a draft: to the item under the pointer (it follows the item), else to the
  // board. Nothing is stored until the first message is sent.
  onPointerDown({ editor, point, target, button }) {
    if (button !== 0) return;
    startDraft(editor, anchorFor(point, target));
  },

  // Ghost pin under the pointer (world space, kept constant size).
  Preview: ({ editor }) => {
    const p = usePointer();
    const cam = useCamera();
    if (!p) return null;
    return (
      <div className="fr-cm-pin-anchor" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${1 / cam.zoom})` }}>
        <div className="fr-cm-pin is-ghost is-preview">
          <Avatar name={editor.user.name} color={editor.user.color} size={26} />
        </div>
      </div>
    );
  },
});
