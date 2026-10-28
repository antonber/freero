import { Rows3 } from 'lucide-react';
import { defineTool } from '@engine';
import { newSwimlane } from './lib/actions';

export default defineTool({
  id: 'swimlane',
  label: 'Swimlanes',
  icon: Rows3,
  order: 42,
  placement: 'more',
  cursor: 'crosshair',
  // Click places a three-lane pool centered on the pointer.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    editor.create(newSwimlane(point), { select: true });
    editor.setTool('select');
  },
});
