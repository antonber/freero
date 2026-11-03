// @vitest-environment jsdom
// Linked views (docs/design/kanban-fields-and-views.md, step 3c): a kanban elsewhere on the board
// drawn as a table, list, calendar or timeline in a box of its own, drawn exactly as the canvas
// draws it (real features, real replicas of one board). Edits made in it are edits of the real
// cards; it holds no copy, so a deleted kanban leaves it saying so and undo brings the cards back.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { KANBAN_LAYOUT, kanbanColumnLeft, timelineLayout as T, type CardElement, type KanbanColumn, type KanbanElement, type KanbanViewElement } from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from './features';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const boards: TestBoard[] = [];
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const b of boards.splice(0)) b.destroy();
  document.body.innerHTML = '';
});
const open = (opts: Parameters<typeof createTestBoard>[0]) => {
  const b = createTestBoard(opts);
  boards.push(b);
  return b;
};

const COLUMNS: KanbanColumn[] = [
  { id: 'c_todo', title: 'To do', status: 'todo', color: '#8A89A3' },
  { id: 'c_doing', title: 'Doing', status: 'doing', color: '#2E9BF0' },
];
const kanban = (ed: Editor) => ed.create({ type: 'kanban', x: 0, y: 0, w: 600, h: 320, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true } as never);
const cardIn = (ed: Editor, kid: string, title: string, dueDate?: string) => {
  const k = ed.getElement<KanbanElement>(kid)!;
  const cx = k.x + kanbanColumnLeft(k, 0) + k.colW / 2;
  return ed.create({ type: 'card', x: cx - 130, y: k.y + KANBAN_LAYOUT.headerH + 60, w: 260, h: 90, title, description: '', color: '#5B3FF0', status: 'todo', ...(dueDate ? { dueDate } : {}) } as never);
};
/** Today ± n days, as the calendar reads today. */
const day = (n: number) => T.isoOf(T.dayOf(T.localDay(Date.now())) + n);
const linkedViews = (ed: Editor) => ed.getElements().filter((el): el is KanbanViewElement => el.type === 'kanbanview');

/** Replica `user`'s drawing of element `id`, as its canvas draws it. */
function draw(board: TestBoard, user: number, id: string): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(board.element(user, id)));
  return host;
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
const key = (el: Element, k: string, mods: { altKey?: boolean } = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })));

describe('linked views', () => {
  it('a calendar linked view lands beside its kanban; Alt+→ on a card in it moves that card’s due date for everyone in one undo step; deleting the kanban leaves the view saying so, and undo brings its cards back', async () => {
    const board = open({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = cardIn(ann, kid, 'Book the venue', day(1));
    ann.runCommand('kanban.addLinkedView', { id: kid, layout: 'calendar' });
    const [lv] = linkedViews(ann);
    const k = ann.getElement<KanbanElement>(kid)!;
    expect(lv.sourceId).toBe(kid);
    expect(lv.x).toBeGreaterThanOrEqual(k.x + k.w);
    expect(ann.getSelection()).toEqual([lv.id]);
    const view = draw(board, 0, lv.id);
    await settle();
    const chip = () => view.querySelector<HTMLElement>(`[data-card="${id}"]`);
    expect(chip()!.closest('[data-day]')!.getAttribute('data-day')).toBe(day(1));

    key(chip()!, 'ArrowRight', { altKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(id)!.dueDate).toBe(day(2));
    await settle();
    expect(chip()!.closest('[data-day]')!.getAttribute('data-day')).toBe(day(2));
    ann.undo();
    expect(ann.getElement<CardElement>(id)!.dueDate).toBe(day(1));

    ann.remove([kid]);
    await settle();
    expect(chip()).toBeNull();
    expect(view.querySelector('[role="status"]')!.textContent).toContain('was deleted');
    ann.undo();
    await settle();
    expect(chip()!.closest('[data-day]')!.getAttribute('data-day')).toBe(day(1));
  });

  it('a table linked view of 2,000 cards draws only the rows on screen and tells screen readers how many there are', async () => {
    const board = open({ users: ['ann'], features });
    const [ann] = board.editors('kanban');
    const kid = kanban(ann);
    ann.transact(() => {
      for (let i = 0; i < 2000; i++) cardIn(ann, kid, `Card ${i}`);
    });
    ann.runCommand('kanban.addLinkedView', { id: kid, layout: 'table' });
    const [lv] = linkedViews(ann);
    const view = draw(board, 0, lv.id);
    await settle();
    expect(view.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe(String(2000 + 1));
    const rows = view.querySelectorAll('[role="row"]').length;
    expect(rows).toBeGreaterThan(5);
    expect(rows).toBeLessThan(60);
  }, 30_000);

  it('my own filter on a linked view leaves cards out for me alone; Save for everyone makes it the view’s, for my collaborator too', async () => {
    const board = open({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    cardIn(ann, kid, 'Fix login');
    cardIn(ann, kid, 'Write docs');
    ann.runCommand('kanban.addLinkedView', { id: kid, layout: 'table' });
    board.sync();
    const [lv] = linkedViews(ann);
    const mine = draw(board, 0, lv.id);
    const theirs = draw(board, 1, lv.id);
    const titles = (el: HTMLElement) => [...el.querySelectorAll('[role="rowheader"]')].map((c) => c.textContent);
    await settle();
    expect(titles(theirs).sort()).toEqual(['Fix login', 'Write docs']);

    ann.runCommand('kanban.setMyLinkedView', { id: lv.id, filter: { op: 'and', rules: [{ field: '$title', op: 'contains', value: 'login' }] } });
    board.sync();
    await settle();
    expect(titles(mine)).toEqual(['Fix login']);
    expect(titles(theirs).sort()).toEqual(['Fix login', 'Write docs']);

    ann.runCommand('kanban.saveLinkedView', { id: lv.id });
    board.sync();
    await settle();
    expect(titles(theirs)).toEqual(['Fix login']);
    expect(bob.getElement<KanbanViewElement>(lv.id)!.view.filter).toBeTruthy();
  });

  it('a linked view copied on its board keeps showing the same kanban (or its absence), copied with its kanban shows the copy; pasted onto another board it goes only with its kanban, showing that board’s copy', () => {
    const a = open({ users: ['ann'], features, boardId: 'board-a' });
    const b = open({ users: ['ann'], features, boardId: 'board-b' });
    const [ann] = a.editors('kanban');
    const [there] = b.editors('kanban');
    const kid = kanban(ann);
    cardIn(ann, kid, 'Fix login');
    ann.runCommand('kanban.addLinkedView', { id: kid, layout: 'list' });
    const [lv] = linkedViews(ann);

    const [copy] = ann.duplicate([lv.id]);
    expect(ann.getElement<KanbanViewElement>(copy)!.sourceId).toBe(kid);
    const both = ann.duplicate([kid, lv.id]);
    const kCopy = both.find((id) => ann.getElement(id)!.type === 'kanban')!;
    const lvCopy = both.find((id) => ann.getElement(id)!.type === 'kanbanview')!;
    expect(kCopy).not.toBe(kid);
    expect(ann.getElement<KanbanViewElement>(lvCopy)!.sourceId).toBe(kCopy);

    there.insertElements(ann.exportElements([lv.id])!);
    expect(linkedViews(there)).toEqual([]);
    there.insertElements(ann.exportElements([kid, lv.id])!);
    const pasted = there.getElements().find((el) => el.type === 'kanban')!;
    expect(linkedViews(there).map((v) => v.sourceId)).toEqual([pasted.id]);

    // On its own board a copy stays, even once its kanban is gone (it says so; undo can bring the kanban back).
    ann.remove([kid]);
    const [orphan] = ann.duplicate([lv.id]);
    expect(ann.getElement(orphan)?.type).toBe('kanbanview');
  });
});
