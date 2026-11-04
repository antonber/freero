import { Paintbrush } from 'lucide-react';
import { defineTool } from '@engine';
import { applyStyle, pickUp, storedStyle, TOOL_ID } from './lib/style';

import { t } from './messages';
/**
 * Format painter: armed with a picked-up style, every click on an item paints it (one undo step
 * per click). Click empty canvas or press Esc to put the brush down.
 */
export default defineTool({
  id: TOOL_ID,
  label: t('formatPainter'),
  icon: Paintbrush,
  order: 95,
  placement: 'more',
  cursor: 'copy',
  onActivate(editor) {
    // Picked from the "+" grid with an item selected: pick its style up first.
    if (editor.getSelection().length === 1) pickUp(editor);
    if (!storedStyle(editor)) {
      editor.host.notify(t('selectOneItemThenPick'), 'info');
      editor.setTool('select');
    }
  },
  onPointerDown({ editor, target, button }) {
    if (button !== 0) return;
    if (!target) return editor.setTool('select');
    if (target.locked) return editor.host.notify(t('unlockThisItemToChange'), 'info');
    applyStyle(editor, [target.id]);
    editor.select([target.id]);
  },
});
