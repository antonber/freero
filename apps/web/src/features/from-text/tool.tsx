import { TextCursorInput } from 'lucide-react';
import { defineTool } from '@engine';
import { DIALOG_ID } from './lib/insert';

// "+" more-tools entry. Not a canvas tool: picking it opens the dialog (the current tool stays).
export default defineTool({
  id: 'from-text',
  creates: ['mindmap', 'shape', 'connector', 'frame', 'sticky', 'text', 'table', 'kanban', 'card'],
  label: 'Insert from text',
  icon: TextCursorInput,
  order: 92,
  placement: 'more',
  onSelect(editor) {
    editor.openPanel(DIALOG_ID, { at: editor.getViewportCenter() });
  },
});
