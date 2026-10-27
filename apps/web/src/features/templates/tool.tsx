import { LayoutTemplate } from 'lucide-react';
import { defineTool } from '@engine';
import { DOCK_ID } from './lib/insert';

// "+" more-tools entry. Templates aren't a canvas tool, so activating it opens the templates
// panel and hands the pointer straight back to select.
export default defineTool({
  id: 'templates',
  label: 'Templates',
  icon: LayoutTemplate,
  order: 90,
  placement: 'more',
  onActivate(editor) {
    editor.openDock(DOCK_ID);
    queueMicrotask(() => {
      if (editor.getToolId() === 'templates') editor.setTool('select');
    });
  },
});
