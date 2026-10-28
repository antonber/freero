import { ListTodo } from 'lucide-react';
import { defineCommands } from '@engine';
import { convertStickiesToCards, selectedStickies } from './lib/actions';

export default defineCommands([
  {
    // Planning poker (features/estimation) writes the agreed value through this: card fields have
    // one writer. Args { id, value } (value null clears it). One undo step.
    id: 'card.setEstimate',
    label: 'Set estimate',
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : null;
      const value = typeof args?.value === 'string' ? args.value.trim().slice(0, 12) : null;
      const el = id ? editor.getElement(id) : undefined;
      if (!el || el.type !== 'card') return;
      editor.update(id!, { estimate: value || null } as never);
    },
  },
  {
    id: 'card.fromSticky',
    icon: ListTodo,
    label: 'Convert to card',
    menus: ['context'],
    when: (editor) => selectedStickies(editor).length > 0,
    run: convertStickiesToCards,
  },
]);
