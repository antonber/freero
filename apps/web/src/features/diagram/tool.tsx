import { Workflow } from 'lucide-react';
import { defineTool } from '@engine';
import { insertDiagram } from './lib/actions';

// Insert ▸ Diagram (the "+" tools): an empty diagram on a free spot; double-click inside it to add a
// step, or drop shapes onto it.
export default defineTool({
  id: 'diagram',
  label: 'Diagram',
  icon: Workflow,
  order: 43,
  placement: 'more',
  creates: ['diagram'],
  onSelect(editor) {
    insertDiagram(editor);
  },
});
