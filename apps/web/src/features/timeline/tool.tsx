import { ChartGantt } from 'lucide-react';
import { defineTool } from '@engine';
import { newTimeline } from './lib/actions';

export default defineTool({
  id: 'timeline',
  label: 'Timeline',
  icon: ChartGantt,
  order: 43,
  placement: 'more',
  cursor: 'crosshair',
  creates: ['timeline', 'timelinebar'],
  // Click places an eight-week timeline from this week's Monday, centered on the pointer.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    editor.create(newTimeline(point, editor.host.serverNow()), { select: true });
    editor.setTool('select');
  },
});
