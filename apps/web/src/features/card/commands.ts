import { ListTodo } from 'lucide-react';
import { defineCommands } from '@engine';
import { convertStickiesToCards, selectedStickies } from './lib/actions';

export default defineCommands([
  {
    id: 'card.fromSticky',
    icon: ListTodo,
    label: 'Convert to card',
    menus: ['context'],
    when: (editor) => selectedStickies(editor).length > 0,
    run: convertStickiesToCards,
  },
]);
