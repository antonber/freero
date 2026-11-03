// @vitest-environment jsdom
// Focus mode (docs/design/kanban-fields-and-views.md §7, step 3a): a kanban as a page of its own,
// its cards real DOM rows and cells (role="grid"), arranged by each person for themselves. The
// dialog exactly as the app mounts it (the panel the kanban feature defines), on real replicas.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { KANBAN_LAYOUT, kanbanColumnAt, kanbanColumnLeft, type CardElement, type FieldDef, type KanbanColumn, type KanbanElement } from '@freero/shared';
import { createTestBoard, type Editor, type PanelDefinition, type TestBoard } from '@engine';
import { features } from './features';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let board: TestBoard | null = null;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
});

const COLUMNS: KanbanColumn[] = [
  { id: 'c_todo', title: 'To do', status: 'todo', color: '#8A89A3' },
  { id: 'c_doing', title: 'Doing', status: 'doing', color: '#2E9BF0' },
  { id: 'c_done', title: 'Done', status: 'done', color: '#1FA463' },
];
const POINTS: FieldDef = { id: 'f_pts', name: 'Points', type: 'number' };
const PRIORITY: FieldDef = { id: 'f_prio', name: 'Priority', type: 'select', options: [{ id: 'o_p0', label: 'P0', color: '#E5484D' }] };

const kanban = (ed: Editor) =>
  ed.create({ type: 'kanban', x: 0, y: 0, w: 900, h: 320, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true, fields: [POINTS, PRIORITY] } as never);

const cardAt = (ed: Editor, kid: string, i: number, title: string) => {
  const k = ed.getElement<KanbanElement>(kid)!;
  const cx = k.x + kanbanColumnLeft(k, i) + k.colW / 2;
  return { type: 'card', x: cx - 130, y: k.y + KANBAN_LAYOUT.headerH + 60, w: 260, h: 90, title, description: '', color: '#5B3FF0', status: COLUMNS[i].status } as never;
};

const focusPanel = () => features.flatMap((b) => b.panels).find((p): p is PanelDefinition => p.id === 'kanban.focus')!;

/** Opens focus mode on kanban `kid` for `ed`, in its own container; returns that container. */
function openFocus(ed: Editor, kid: string): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const { Component } = focusPanel();
  act(() => root.render(<Component editor={ed} props={{ id: kid }} />));
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs[dialogs.length - 1];
}

const press = (key: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
const groupsIn = (dialog: HTMLElement) => [...dialog.querySelectorAll('.fr-kanban-grid__group-title')].map((n) => n.textContent);

function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('focus mode', () => {
  it('arrow keys walk the grid to a card’s Points; Enter, typing and Enter write it for everyone in one undo step, and picking Done for its Stage moves the real card into Done', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = ann.create(cardAt(ann, kid, 0, 'Fix login'));
    const dialog = openFocus(ann, kid);
    await settle();
    const grid = dialog.querySelector('[role="grid"]')!;
    act(() => grid.querySelector<HTMLElement>('[role="rowheader"][tabindex="0"]')!.focus());
    expect(document.activeElement!.textContent).toBe('Fix login');

    press('ArrowRight'); // Stage
    press('ArrowRight'); // Points
    expect(document.activeElement!.getAttribute('aria-colindex')).toBe('3');
    press('Enter');
    const input = dialog.querySelector<HTMLInputElement>('input[aria-label="Points"]')!;
    type(input, '3');
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    board.sync();
    expect(bob.getElement<CardElement>(id)!.values).toEqual({ f_pts: 3 });
    ann.undo();
    expect(ann.getElement<CardElement>(id)!.values ?? {}).toEqual({});
    ann.redo();

    await settle();
    press('ArrowLeft'); // Stage
    press('Enter');
    act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((o) => o.textContent === 'Done')!.click());
    board.sync();
    const k = bob.getElement<KanbanElement>(kid)!;
    const c = bob.getElement<CardElement>(id)!;
    expect(k.columns[kanbanColumnAt(k, c.x + c.w / 2)].id).toBe('c_done');
    expect(c.status).toBe('done');
  });

  it('grouping by Priority in focus mode is mine: my rows are under P0 and No Priority, my collaborator’s focus mode still groups by Stage, and nobody’s board changes', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = ann.create(cardAt(ann, kid, 1, 'Fix login'));
    ann.create(cardAt(ann, kid, 0, 'Write docs'));
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p0' } });
    board.sync();
    const before = JSON.stringify(ann.getElements());

    const mine = openFocus(ann, kid);
    act(() => mine.querySelector<HTMLElement>('[aria-label="Group cards by"]')!.click());
    act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'Priority')!.click());
    await settle();
    expect(groupsIn(mine)).toEqual(['No Priority', 'P0']);
    const theirs = openFocus(bob, kid);
    expect(groupsIn(theirs)).toEqual(['To do', 'Doing']);
    board.sync();
    for (const ed of [ann, bob]) expect(JSON.stringify(ed.getElements())).toBe(before);
  });

  it('a kanban of 1,000 cards opens with only the rows on screen drawn, and tells screen readers how many rows there are', async () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ann] = board.editors('kanban');
    const kid = kanban(ann);
    ann.transact(() => {
      for (let i = 0; i < 1000; i++) ann.create(cardAt(ann, kid, 0, `Card ${i}`));
    });
    const dialog = openFocus(ann, kid);
    const grid = dialog.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-rowcount')).toBe(String(1000 + 1 + 1)); // the header row and the To do group's
    expect(grid.querySelectorAll('[role="row"]').length).toBeLessThan(50);
  }, 20_000);
});
