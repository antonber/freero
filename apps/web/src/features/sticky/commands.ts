import { SquareArrowRight, SquareStack } from 'lucide-react';
import { defineCommands } from '@engine';
import { createNextSticky, selectedSticky } from './lib/actions';

export default defineCommands([
  {
    // Tab while typing in a sticky (or with one selected) chains a fresh sticky to the right.
    id: 'sticky.nextRight',
    icon: SquareArrowRight,
    label: 'Add sticky to the right',
    shortcut: 'tab',
    menus: ['context'],
    when: (editor) => !!selectedSticky(editor),
    run(editor) {
      const s = selectedSticky(editor);
      if (s) createNextSticky(editor, s, 'right');
    },
  },
  {
    id: 'sticky.nextBelow',
    label: 'Add sticky below',
    shortcut: 'mod+enter',
    when: (editor) => !!selectedSticky(editor),
    run(editor) {
      const s = selectedSticky(editor);
      if (s) createNextSticky(editor, s, 'below');
    },
  },
  {
    id: 'sticky.duplicateRight',
    icon: SquareStack,
    label: 'Duplicate sticky to the right',
    shortcut: 'mod+shift+d',
    menus: ['context'],
    when: (editor) => !!selectedSticky(editor),
    run(editor) {
      const s = selectedSticky(editor);
      if (s) createNextSticky(editor, s, 'right', true);
    },
  },
]);
