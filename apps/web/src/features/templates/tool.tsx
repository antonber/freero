import { LayoutTemplate } from 'lucide-react';
import { defineTool } from '@engine';
import { DOCK_ID } from './lib/insert';

// "+" more-tools entry. Templates aren't a canvas tool: picking it opens the templates panel
// (act-now tool; the current tool stays).
export default defineTool({
  id: 'templates',
  // Templates add frames, stickies, shapes, text…: offered only while anything may be added.
  creates: ['frame', 'sticky', 'shape', 'text', 'connector'],
  label: 'Templates',
  icon: LayoutTemplate,
  order: 90,
  placement: 'more',
  onSelect(editor) {
    editor.openPanel(DOCK_ID);
  },
});
