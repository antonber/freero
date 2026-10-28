import { SquareKanban } from 'lucide-react';
import { defineTool } from '@engine';
import { TOOL_ID } from './lib/constants';
import { newKanban } from './lib/actions';

export default defineTool({
  id: TOOL_ID,
  label: 'Kanban board',
  icon: SquareKanban,
  order: 41,
  placement: 'more',
  cursor: 'crosshair',
  // Click places a three-column board (To do / In progress / Done) centered on the pointer.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    editor.create(newKanban(point), { select: true });
    editor.setTool('select');
  },
});
