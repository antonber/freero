import { FileText } from 'lucide-react';
import { defineTool } from '@engine';
import { createDocFrom } from './lib/create';

// "Doc": a new collaborative doc (KAI-124, KAI-162) next to this board, placed on a free spot and
// ready to type into. Act-now: the current tool stays.
export default defineTool({
  id: 'doc',
  label: 'Doc',
  icon: FileText,
  order: 47,
  placement: 'more',
  creates: ['doc'],
  onSelect(editor) {
    if (!editor.host.docs) return editor.host.notify('Docs need a Freero account and a saved board.', 'info');
    void createDocFrom(editor, { title: 'Untitled doc' }, null);
  },
});
