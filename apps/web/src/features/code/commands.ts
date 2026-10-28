import { Copy } from 'lucide-react';
import { defineCommands } from '@engine';
import { copyCode, selectedCode } from './lib/actions';

export default defineCommands([
  {
    id: 'code.copy',
    icon: Copy,
    label: 'Copy code',
    menus: ['context'],
    // Reading the code is fine for anyone who can see the board.
    minRole: 'viewer',
    when: (editor) => selectedCode(editor).length === 1,
    disabledReason: 'Select one code block',
    run(editor) {
      const [block] = selectedCode(editor);
      if (block) void copyCode(editor, block.code);
    },
  },
]);
