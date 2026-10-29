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
    // A timeline (features/timeline) moves a card's dates through this: card fields have one
    // writer. Args { id, startDate?, dueDate? } — ISO dates 'YYYY-MM-DD' or null; keys left out
    // stay as they are. A start after the due date is dropped.
    id: 'card.setDates',
    label: 'Set dates',
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : null;
      const el = id ? editor.getElement(id) : undefined;
      if (!el || el.type !== 'card') return;
      const date = (v: unknown): string | null | undefined =>
        v === null ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined;
      const patch: { startDate?: string | null; dueDate?: string | null } = {};
      const start = date(args?.startDate);
      const due = date(args?.dueDate);
      if (start !== undefined) patch.startDate = start;
      if (due !== undefined) patch.dueDate = due;
      const s = patch.startDate !== undefined ? patch.startDate : el.startDate;
      const d = patch.dueDate !== undefined ? patch.dueDate : el.dueDate;
      if (s && d && s > d) return;
      if (Object.keys(patch).length) editor.update(id!, patch as never);
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
