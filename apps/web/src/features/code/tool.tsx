import { SquareCode } from 'lucide-react';
import { defineTool } from '@engine';
import { codeAt } from './lib/actions';
import { setEditingCode } from './lib/editing';
import { loadHighlighter } from './lib/tokens';

import { t } from './messages';
export default defineTool({
  id: 'code',
  label: t('codeBlock'),
  icon: SquareCode,
  order: 46,
  placement: 'more',
  cursor: 'crosshair',
  onActivate() {
    void loadHighlighter();
  },
  // Click places an empty block centered on the pointer, ready to type into.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const id = editor.create(codeAt(point), { select: true });
    editor.setTool('select');
    if (id) setEditingCode(id);
  },
});
