import { Network } from 'lucide-react';
import { defineTool, useToolGhost, type Editor, type Point } from '@engine';
import { nodeSize } from './lib/measure';
import { TOOL_ID } from './lib/constants';
import { newRoot } from './lib/actions';

function start(editor: Editor, at: Point) {
  const id = editor.create(newRoot(at), { select: true });
  editor.setTool('select');
  if (id) editor.startEditing(id);
}

export default defineTool({
  id: TOOL_ID,
  label: 'Mind map',
  icon: Network,
  shortcut: 'm',
  order: 45,
  placement: 'main',
  cursor: 'crosshair',

  // Click drops a central topic and starts typing into it (one undo step with the typing's
  // first gesture). Then Tab adds a child, Enter a sibling.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    start(editor, point);
  },

  // Keyboard-only: M then Enter drops the central topic in a free spot in view.
  onKeyDown(editor, e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    const { w, h } = nodeSize('', true);
    const spot = editor.findFreeSpot({ w: w * 4, h: h * 6 });
    start(editor, { x: spot.x + w * 2, y: spot.y + h * 3 });
    return true;
  },

  Preview: () => {
    const { w, h } = nodeSize('', true);
    const p = useToolGhost({ w, h });
    if (!p) return null;
    return (
      <div className="fr-mm-ghost" style={{ width: w, height: h, transform: `translate(${p.x}px, ${p.y}px)` }}>
        Central topic
      </div>
    );
  },
});
