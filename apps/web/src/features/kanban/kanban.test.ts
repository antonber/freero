import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardElement, KanbanElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import kanbanDef from './element';
import { moveColumn, newKanban, removeColumn } from './lib/actions';
import { COL_HEAD_H, GAP, HEADER_H, PAD, colLeft } from './lib/layout';

const bundle: FeatureBundle = { manifest, elements: [kanbanDef], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  vi.useRealTimers();
});

function setup(users = ['ann']): Editor[] {
  board = createTestBoard({ users, features: [bundle] });
  return board.editors('kanban');
}

const card = (x: number, y: number, status: CardElement['status'] = 'todo'): NewElement<'card'> => ({
  type: 'card',
  x,
  y,
  w: 200,
  h: 80,
  title: 'Task',
  description: '',
  color: '#5B3FF0',
  status,
});

/** World center of column `i`'s first slot, i.e. where to drop something into that column. */
const dropPoint = (k: KanbanElement, i: number) => ({ x: k.x + colLeft(k.colW, i) + k.colW / 2, y: k.y + HEADER_H + COL_HEAD_H + 40 });

/** A pointer drag of `id` so its center lands on `to`: one gesture, like the select tool's. */
function drag(ed: Editor, id: string, to: { x: number; y: number }, during?: () => void) {
  const el = ed.getElement(id)!;
  ed.beginGesture();
  ed.moveBy([{ id, dx: to.x - (el.x + el.w / 2), dy: to.y - (el.y + el.h / 2) }]);
  during?.();
  ed.endGesture();
}

function kanbanWithCards(ed: Editor, statuses: Array<CardElement['status']>) {
  const kid = ed.create(newKanban({ x: 0, y: 0 }));
  const k = () => ed.getElement<KanbanElement>(kid)!;
  // Cards created inside the To do column stack there.
  const ids = statuses.map((s) => ed.create(card(dropPoint(k(), 0).x - 100, dropPoint(k(), 0).y - 40, s)));
  return { kid, k, ids };
}

describe('kanban columns', () => {
  it('a card dropped into Done becomes done and stacks under the column header; one undo takes back both', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    const [id] = ids;
    const before = ed.getElement<CardElement>(id)!;
    drag(ed, id, dropPoint(k(), 2), () => {
      // Mid-drag nothing snaps under the pointer and the status is untouched.
      expect(ed.getElement<CardElement>(id)!.status).toBe('todo');
    });
    const after = ed.getElement<CardElement>(id)!;
    expect(after.status).toBe('done');
    expect(after.frameId).toBe(k().id);
    expect(after.x).toBeCloseTo(k().x + colLeft(k().colW, 2) + PAD);
    expect(after.y).toBeCloseTo(k().y + HEADER_H + COL_HEAD_H + PAD);
    ed.undo();
    expect(ed.getElement<CardElement>(id)).toMatchObject({ x: before.x, y: before.y, status: 'todo' });
  });

  it('drops between two cards slot in between them, and the column it left closes the gap', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo', 'todo', 'todo']);
    const [a, b, c] = ids.map((id) => ed.getElement<CardElement>(id)!);
    // Move c into Doing, then a into Doing just below c's top: order Doing = [c, a].
    drag(ed, c.id, dropPoint(k(), 1));
    const cNow = ed.getElement<CardElement>(c.id)!;
    drag(ed, a.id, { x: dropPoint(k(), 1).x, y: cNow.y + cNow.h + 5 });
    expect(ed.getElement<CardElement>(a.id)!.y).toBeGreaterThan(ed.getElement<CardElement>(c.id)!.y);
    // b slid up to the top of To do.
    expect(ed.getElement<CardElement>(b.id)!.y).toBeCloseTo(k().y + HEADER_H + COL_HEAD_H + PAD);
    expect(ed.getElement<CardElement>(a.id)!.status).toBe('doing');
  });

  it('a card whose status is changed where it stands moves to the column of that status', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    ed.update<CardElement>(ids[0], { status: 'done' });
    const el = ed.getElement<CardElement>(ids[0])!;
    expect(el.status).toBe('done');
    expect(el.x).toBeCloseTo(k().x + colLeft(k().colW, 2) + PAD);
  });

  it('a card dragged off the board keeps its status', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    drag(ed, ids[0], dropPoint(k(), 1));
    drag(ed, ids[0], { x: k().x + k().w + 400, y: k().y });
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'doing', frameId: null });
  });

  it('reordering columns carries their cards along without changing anyone’s status', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo']);
    drag(ed, ids[0], dropPoint(k(), 2)); // done
    const doneCol = k().columns[2].id;
    moveColumn(ed, kid, doneCol, -1);
    expect(k().columns[1].id).toBe(doneCol);
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'done', x: k().x + colLeft(k().colW, 1) + PAD });
  });

  it('deleting a column hands its cards to the neighbour column, with that column’s status', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo']);
    drag(ed, ids[0], dropPoint(k(), 2)); // done
    removeColumn(ed, kid, k().columns[2].id);
    expect(k().columns).toHaveLength(2);
    expect(k().w).toBeCloseTo(GAP + 2 * (k().colW + GAP));
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'doing', x: k().x + colLeft(k().colW, 1) + PAD });
  });

  it('a collaborator’s edits never make my client rewrite card statuses it did not touch', () => {
    const [ann, bob] = setup(['ann', 'bob']);
    const { k, ids } = kanbanWithCards(ann, ['todo']);
    board!.sync();
    // Bob sets the status in place (his client moves it to Done) …
    bob.update<CardElement>(ids[0], { status: 'doing' });
    board!.sync();
    // … then Ann edits something unrelated: her client leaves Bob's card alone.
    ann.update<KanbanElement>(k().id, { title: 'Sprint 12' });
    board!.sync();
    for (const ed of [ann, bob]) expect(ed.getElement<CardElement>(ids[0])!.status).toBe('doing');
    expect(ann.getElement<CardElement>(ids[0])!.x).toBeCloseTo(k().x + colLeft(k().colW, 1) + PAD);
  });
});

describe('kanban with two people at once', () => {
  /** Where each card sits: fewer spots than cards = cards on top of each other. */
  const spots = (ed: Editor, ids: string[]) =>
    new Set(ids.map((id) => {
      const c = ed.getElement<CardElement>(id)!;
      return `${c.x},${c.y}`;
    }));
  const snapshot = (ed: Editor) => JSON.stringify(ed.getElements());

  it('two cards dropped into the same column at the same moment end up stacked, not overlapping, fixed by one client only once', () => {
    vi.useFakeTimers();
    const [ann, bob] = setup(['ann', 'bob']);
    const { k, ids } = kanbanWithCards(ann, ['todo']);
    // A second card alone in Doing, so neither drop re-stacks the card the other person moves.
    ids.push(ann.create(card(dropPoint(k(), 1).x - 100, dropPoint(k(), 1).y - 40, 'doing')));
    board!.sync();
    vi.advanceTimersByTime(60_000); // setting the board up was long ago

    // Both drop into the empty Done column before seeing each other's drop: same free slot.
    drag(ann, ids[0], dropPoint(k(), 2));
    drag(bob, ids[1], dropPoint(bob.getElement<KanbanElement>(k().id)!, 2));
    board!.sync();
    for (const ed of [ann, bob]) expect(spots(ed, ids).size).toBe(1); // merged: on top of each other

    vi.advanceTimersByTime(1000);
    // Exactly one of them re-laid the column out (the other waits for it).
    expect([ann, bob].filter((ed) => spots(ed, ids).size === 2)).toHaveLength(1);
    board!.sync();
    for (const ed of [ann, bob]) {
      const [a, b] = ids.map((id) => ed.getElement<CardElement>(id)!);
      expect(a.x).toBe(b.x);
      expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.y < b.y ? a.h : b.h); // stacked, no overlap
      for (const c of [a, b]) expect(c.status).toBe('done');
    }
    expect(snapshot(ann)).toBe(snapshot(bob));

    // And nobody keeps rewriting it (no ping-pong between the two clients).
    const settled = snapshot(ann);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2000);
      board!.sync();
    }
    expect(snapshot(ann)).toBe(settled);
    expect(snapshot(bob)).toBe(settled);
  });

  it("someone who did not just lay the board out never snaps a collaborator's card mid-drag", () => {
    vi.useFakeTimers();
    const [ann, bob] = setup(['ann', 'bob']);
    const { ids } = kanbanWithCards(ann, ['todo']);
    board!.sync();
    vi.advanceTimersByTime(60_000);
    // Bob is still dragging the card around inside the column (his gesture is open).
    bob.beginGesture();
    bob.moveBy([{ id: ids[0], dx: 37, dy: 55 }]);
    const held = bob.getElement<CardElement>(ids[0])!;
    board!.sync();
    vi.advanceTimersByTime(5000);
    board!.sync();
    expect(bob.getElement<CardElement>(ids[0])).toMatchObject({ x: held.x, y: held.y });
    bob.endGesture();
  });
});
