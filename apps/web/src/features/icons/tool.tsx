import { Sparkles } from 'lucide-react';
import { defineTool } from '@engine';
import { LIBRARY_PANEL } from './lib/insert';

// "+" more-tools entry. Not a canvas tool: picking it opens the icon library (act-now tool).
export default defineTool({
  id: 'icons',
  creates: ['icon'],
  label: 'Icons',
  icon: Sparkles,
  order: 92,
  placement: 'more',
  onSelect(editor) {
    editor.openPanel(LIBRARY_PANEL);
  },
});
