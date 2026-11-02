// Kanban templates with typed fields (docs/design/kanban-fields-and-views.md, step 2f), as the app
// inserts them: the templates feature builds the kanban and its cards, the kanban and card
// features lay them out and show their fields. Real features, a real board.
import { afterEach, expect, it, vi } from 'vitest';
import { collectionSchema, richTextToPlain, type CardElement, type KanbanElement } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import { features } from './features';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

it('a board made from the bug triage template has working fields: every card shows its Severity and Area and is coloured by its severity', async () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ed] = board.editors();
  ed.runCommand('templates.insert', { id: 'bug-triage' });
  await vi.waitFor(() => expect(ed.getElements().some((e) => e.type === 'kanban')).toBe(true));

  const k = ed.getElements().find((e): e is KanbanElement => e.type === 'kanban')!;
  const severity = collectionSchema(k).find((f) => f.name === 'Severity')!;
  const kanban = ed.getDefinition('kanban')!;
  const shown = (title: string) => {
    const c = ed.getElements().find((e): e is CardElement => e.type === 'card' && richTextToPlain(e.title) === title)!;
    const p = kanban.presentChild!(k, c, { editor: ed, personal: false })!;
    return { chips: p.chips!.flatMap((chip) => (chip.kind === 'options' ? chip.options.map((o) => o.label) : [])), accent: p.accent };
  };
  expect(shown('Login loop for SSO users')).toEqual({ chips: ['S1', 'Sign-in'], accent: severity.options!.find((o) => o.label === 'S1')!.color });
  expect(shown('Comments vanish on refresh').chips).toEqual(['S2', 'Comments']);
  // A card without a severity yet keeps its own colour.
  expect(shown('Export cuts off long boards')).toEqual({ chips: ['Export'], accent: null });
});
