import { ListTodo, NotebookText } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { convertStickiesToCards, selectedStickies } from './lib/actions';
import { setValues } from './lib/values';
import { DETAILS_PANEL, DETAILS_SHORTCUT } from './lib/constants';

import { t } from './messages';
/** The one card selected, if the selection is exactly that. */
const selectedCard = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'card' ? el : undefined;
};

export default defineCommands([
  {
    // The selected card's details, for everyone who can see the board (viewers read them).
    // Enter stays "edit the title"; Shift+Enter is free on a selected item.
    id: 'card.openDetails',
    icon: NotebookText,
    label: t('openDetails'),
    shortcut: DETAILS_SHORTCUT,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!selectedCard(editor),
    disabledReason: t('selectOneCard'),
    run(editor) {
      const card = selectedCard(editor);
      if (card) editor.openPanel(DETAILS_PANEL, { id: card.id });
    },
  },
  {
    // Other features open a card's details (a kanban table's description line). Args { id }.
    id: 'card.showDetails',
    label: t('openDetails'),
    minRole: 'viewer',
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : null;
      if (id && editor.getElement(id)?.type === 'card') editor.openPanel(DETAILS_PANEL, { id });
    },
  },
  {
    // Planning poker (features/estimation) writes the agreed value through this: card fields have
    // one writer. Args { id, value } (value null clears it). One undo step.
    id: 'card.setEstimate',
    label: t('setEstimate'),
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
    label: t('setDates'),
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
    // Field values (docs/design/kanban-fields-and-views.md): card details, and later table cells
    // and other views, write a card's fields through this. Args { id, values: { [fieldId]: value } }
    // — the kanban's own field ids, or built-in ids ($status, $assignee, $due, …); null clears.
    // Values that don't fit their field are ignored. One undo step.
    id: 'card.setValues',
    label: t('setFieldValues'),
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : null;
      const values = args?.values && typeof args.values === 'object' ? (args.values as Record<string, unknown>) : null;
      if (id && values) setValues(editor, id, values);
    },
  },
  {
    id: 'card.fromSticky',
    icon: ListTodo,
    label: t('convertToCard'),
    menus: ['context'],
    when: (editor) => selectedStickies(editor).length > 0,
    run: convertStickiesToCards,
  },
]);
