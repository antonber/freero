import { Network } from 'lucide-react';
import { defineTool, usePointer } from '@engine';
import { nodeSize } from './lib/measure';
import { TOOL_ID } from './lib/constants';
import { newRoot } from './lib/actions';

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
    const id = editor.create(newRoot(point), { select: true });
    editor.setTool('select');
    if (id) editor.startEditing(id);
  },

  Preview: () => {
    const p = usePointer();
    if (!p) return null;
    const { w, h } = nodeSize('', true);
    return (
      <div className="fr-mm-ghost" style={{ width: w, height: h, transform: `translate(${p.x - w / 2}px, ${p.y - h / 2}px)` }}>
        Central topic
      </div>
    );
  },
});
