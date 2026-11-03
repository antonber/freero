// @vitest-environment jsdom
// A kanban's list, calendar and timeline (docs/design/kanban-fields-and-views.md, step 3b), through
// focus mode exactly as the app mounts it, on real replicas: moving a card by keys writes its
// dates (or its group) for everyone in one undo step, and big kanbans draw only what is on screen.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { KANBAN_LAYOUT, kanbanColumnAt, kanbanColumnLeft, timelineLayout as T, type CardElement, type KanbanColumn, type KanbanElement } from '@freero/shared';
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
const kanban = (ed: Editor) => ed.create({ type: 'kanban', x: 0, y: 0, w: 900, h: 320, title: 'Launch', colW: 280, columns: COLUMNS, colorCards: true } as never);
const cardAt = (ed: Editor, kid: string, i: number, title: string, dates: { startDate?: string; dueDate?: string } = {}) => {
  const k = ed.getElement<KanbanElement>(kid)!;
  const cx = k.x + kanbanColumnLeft(k, i) + k.colW / 2;
  return { type: 'card', x: cx - 130, y: k.y + KANBAN_LAYOUT.headerH + 60, w: 260, h: 90, title, description: '', color: '#5B3FF0', status: COLUMNS[i].status, ...dates } as never;
};
/** Today ± n days, as the calendar and timeline read today (this device's date). */
const day = (n: number) => T.isoOf(T.dayOf(T.localDay(Date.now())) + n);

const focusPanel = () => features.flatMap((b) => b.panels).find((p): p is PanelDefinition => p.id === 'kanban.focus')!;
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
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
/** A key on element `el` (React hears it through the root, as a real key press). */
const key = (el: Element, k: string, mods: { altKey?: boolean; shiftKey?: boolean } = {}) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })));

describe('calendar, timeline and list', () => {
  it('in the calendar, Alt+→ moves a card’s due date a day later for everyone in one undo step, and moving it a week before its start date carries the start along instead of being refused', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = ann.create(cardAt(ann, kid, 0, 'Book the venue', { startDate: day(0), dueDate: day(1) }));
    ann.runCommand('kanban.setFocus', { id: kid, layout: 'calendar' });
    const dialog = openFocus(ann, kid);
    await settle();
    const chip = () => dialog.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
    expect(chip().closest('[data-day]')!.getAttribute('data-day')).toBe(day(1));

    key(chip(), 'ArrowRight', { altKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(id)!).toMatchObject({ dueDate: day(2), startDate: day(0) });
    await settle();
    expect(chip().closest('[data-day]')!.getAttribute('data-day')).toBe(day(2));
    ann.undo();
    expect(ann.getElement<CardElement>(id)!.dueDate).toBe(day(1));

    await settle();
    key(chip(), 'ArrowUp', { altKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(id)!).toMatchObject({ dueDate: day(-6), startDate: day(-7) });
  });

  it('on the timeline, Alt+Shift+→ moves only a bar’s end and Alt+→ moves both of its dates, each one undo step; a card with only a due date gains the start its bar showed', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = ann.create(cardAt(ann, kid, 0, 'Design the page', { startDate: day(0), dueDate: day(2) }));
    const due = ann.create(cardAt(ann, kid, 1, 'Fix login', { dueDate: day(3) }));
    ann.runCommand('kanban.setFocus', { id: kid, layout: 'timeline' });
    const dialog = openFocus(ann, kid);
    await settle();
    const bar = (c: string) => dialog.querySelector<HTMLElement>(`[data-bar="${c}"]`)!;

    key(bar(id), 'ArrowRight', { altKey: true, shiftKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(id)!).toMatchObject({ startDate: day(0), dueDate: day(3) });
    await settle();
    key(bar(id), 'ArrowRight', { altKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(id)!).toMatchObject({ startDate: day(1), dueDate: day(4) });
    ann.undo();
    expect(ann.getElement<CardElement>(id)!).toMatchObject({ startDate: day(0), dueDate: day(3) });

    await settle();
    key(bar(due), 'ArrowRight', { altKey: true, shiftKey: true });
    board.sync();
    expect(bob.getElement<CardElement>(due)!).toMatchObject({ startDate: day(3), dueDate: day(4) });
  });

  it('in a list grouped by Stage, Alt+↓ on a To do card moves the real card into Doing for everyone, in one undo step', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('kanban');
    const kid = kanban(ann);
    const id = ann.create(cardAt(ann, kid, 0, 'Write release notes'));
    ann.runCommand('kanban.setFocus', { id: kid, layout: 'list' });
    const dialog = openFocus(ann, kid);
    await settle();
    const row = dialog.querySelector<HTMLElement>('[role="rowheader"][tabindex="0"]')!;
    expect(row.textContent).toBe('Write release notes');
    act(() => row.focus());

    key(row, 'ArrowDown', { altKey: true });
    board.sync();
    const at = (ed: Editor) => {
      const k = ed.getElement<KanbanElement>(kid)!;
      const c = ed.getElement<CardElement>(id)!;
      return { column: k.columns[kanbanColumnAt(k, c.x + c.w / 2)].id, status: c.status };
    };
    expect(at(bob)).toEqual({ column: 'c_doing', status: 'doing' });
    ann.undo();
    expect(at(ann)).toEqual({ column: 'c_todo', status: 'todo' });
  });

  it('1,000 dated cards open on the timeline drawing only the bars on screen, and in the calendar a day full of them shows a few and “+N more”', async () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ann] = board.editors('kanban');
    const kid = kanban(ann);
    ann.transact(() => {
      for (let i = 0; i < 1000; i++) ann.create(cardAt(ann, kid, 0, `Card ${i}`, { dueDate: day(2) }));
    });
    ann.runCommand('kanban.setFocus', { id: kid, layout: 'timeline' });
    const dialog = openFocus(ann, kid);
    await settle();
    expect(dialog.querySelectorAll('[data-bar]').length).toBeGreaterThan(5);
    expect(dialog.querySelectorAll('[data-bar]').length).toBeLessThan(60);
    expect(dialog.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe(String(1000 + 1));

    ann.runCommand('kanban.setFocus', { id: kid, layout: 'calendar' });
    await settle();
    const cell = dialog.querySelector(`[data-day="${day(2)}"][role="gridcell"]`)!;
    expect(cell.querySelectorAll('[data-card]').length).toBeLessThan(10);
    expect(cell.querySelector('.fr-kanban-cal__more')!.textContent).toBe(`+${1000 - cell.querySelectorAll('[data-card]').length} more`);
  }, 30_000);
});
