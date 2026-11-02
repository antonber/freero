import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3 } from 'lucide-react';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { addColumn, canMove, moveSelection, type MoveDir } from './lib/actions';

const selectedKanban = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'kanban' && !el.locked ? el : null;
};

/**
 * Arrow keys on items stacked in a kanban move them between and within columns (the layout
 * would put a nudged item straight back). Only while the move is possible: at the edge the key
 * falls through to the engine's nudge, which the layout undoes, so nothing happens.
 */
const move = (dir: MoveDir, label: string, icon: CommandDefinition['icon'], shortcut: string): CommandDefinition => ({
  id: `kanban.move${dir[0].toUpperCase()}${dir.slice(1)}`,
  label,
  icon,
  shortcut,
  menus: ['context'],
  when: (editor) => canMove(editor, dir),
  run: (editor) => void moveSelection(editor, dir),
});

export default defineCommands([
  {
    id: 'kanban.addColumn',
    label: 'Add column',
    icon: Columns3,
    menus: ['context'],
    when: (editor) => !!selectedKanban(editor),
    run(editor) {
      const k = selectedKanban(editor);
      if (k) addColumn(editor, k.id);
    },
  },
  move('left', 'Move to previous column', ArrowLeft, 'arrowleft'),
  move('right', 'Move to next column', ArrowRight, 'arrowright'),
  move('up', 'Move up in column', ArrowUp, 'arrowup'),
  move('down', 'Move down in column', ArrowDown, 'arrowdown'),
]);

