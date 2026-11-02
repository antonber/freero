import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLUMN_FIELD_ID, cardValue, collectionSchema, storedFields, type CardElement, type KanbanElement } from '@freero/shared';
import { createTestBoard, richTextToPlain, type Editor, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import kanbanDef from './element';
import commands from './commands';
import outline from './outline';
import { moveColumnTo, newKanban, removeColumn, setCollapsed, setColorCards, setColumnWidth } from './lib/actions';
import { COL_HEAD_H, GAP, HEADER_H, PAD, colLeft, planDrop } from './lib/layout';
import { addField, addOption, removeField, removeOption, renameField } from './lib/schema';

const bundle: FeatureBundle = { manifest, elements: [kanbanDef], tools: [], formats: [], panels: [], commands, outline };

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
const dropPoint = (k: KanbanElement, i: number) => ({ x: k.x + colLeft(k, i) + k.colW / 2, y: k.y + HEADER_H + COL_HEAD_H + 40 });

/** A pointer drag of `id` so its center lands on `to`: one gesture, like the select tool's. */
function drag(ed: Editor, id: string, to: { x: number; y: number }, during?: () => void) {
  const el = ed.getElement(id)!;
  ed.beginGesture();
  ed.moveBy([{ id, dx: to.x - (el.x + el.w / 2), dy: to.y - (el.y + el.h / 2) }]);
  during?.();
  ed.endGesture();
}

/** Ids top to bottom (cards created on one spot stack in an order of their own). */
const stacked = (ed: Editor, ids: string[]) => [...ids].sort((x, y) => ed.getElement(x)!.y - ed.getElement(y)!.y);

function kanbanWithCards(ed: Editor, statuses: Array<CardElement['status']>) {
  const kid = ed.create(newKanban({ x: 0, y: 0 }));
  const k = () => ed.getElement<KanbanElement>(kid)!;
  // Cards created inside the To do column stack there.
  const ids = statuses.map((s) => ed.create(card(dropPoint(k(), 0).x - 100, dropPoint(k(), 0).y - 40, s)));
  return { kid, k, ids };
}

describe('kanban columns', () => {
  it('a card dropped into Done becomes done, takes Done’s colour and stacks under the column header; one undo takes back all of it', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    const [id] = ids;
    const before = ed.getElement<CardElement>(id)!;
    expect(before.color).toBe(k().columns[0].color); // created in To do: took its colour
    drag(ed, id, dropPoint(k(), 2), () => {
      // Mid-drag nothing snaps under the pointer and the status is untouched.
      expect(ed.getElement<CardElement>(id)!.status).toBe('todo');
    });
    const after = ed.getElement<CardElement>(id)!;
    expect(after).toMatchObject({ status: 'done', color: k().columns[2].color, frameId: k().id });
    expect(after.x).toBeCloseTo(k().x + colLeft(k(), 2) + PAD);
    expect(after.y).toBeCloseTo(k().y + HEADER_H + COL_HEAD_H + PAD);
    ed.undo();
    expect(ed.getElement<CardElement>(id)).toMatchObject({ x: before.x, y: before.y, status: 'todo', color: before.color });
  });

  it('a kanban from before card colouring moves cards without recolouring them, until colouring is turned on (one undo turns it off again)', () => {
    const [ed] = setup();
    const { colorCards: _on, ...old } = newKanban({ x: 0, y: 0 });
    const kid = ed.create(old);
    const k = () => ed.getElement<KanbanElement>(kid)!;
    const id = ed.create(card(dropPoint(k(), 0).x - 100, dropPoint(k(), 0).y - 40));
    drag(ed, id, dropPoint(k(), 1));
    expect(ed.getElement<CardElement>(id)).toMatchObject({ status: 'doing', color: '#5B3FF0' });
    setColorCards(ed, kid, true);
    expect(ed.getElement<CardElement>(id)!.color).toBe(k().columns[1].color);
    ed.undo();
    expect(k().colorCards).toBeFalsy();
    expect(ed.getElement<CardElement>(id)!.color).toBe('#5B3FF0');
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

  it('while a card is dragged within its column, the drop indicator is exactly where the drop puts it, and the card it passes makes room', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo', 'todo', 'todo']);
    const [a, b, c] = stacked(ed, ids);
    const first = ed.getElement<CardElement>(a)!;
    let preview: ReturnType<typeof planDrop> = null;
    // Drag c (the last) up between a and b: its center just below a's.
    drag(ed, c, { x: dropPoint(k(), 0).x, y: first.y + first.h / 2 + 1 }, () => {
      preview = planDrop(k(), ed.getElements(), [ed.getElement(c)!]);
    });
    const p = preview!;
    const landed = ed.getElement<CardElement>(c)!;
    expect(p.slots).toHaveLength(1);
    expect(p.slots[0].x).toBeCloseTo(landed.x);
    expect(p.slots[0].y).toBeCloseTo(landed.y);
    expect(p.slots[0].w).toBeCloseTo(landed.w);
    const madeRoom = p.moves.find((m) => m.id === b)!;
    expect(madeRoom.y).toBeCloseTo(ed.getElement(b)!.y);
    expect(ed.getElement(b)!.y).toBeGreaterThan(landed.y);
    expect(p.moves.some((m) => m.id === a)).toBe(false); // a stays where it is
  });

  it('a card whose status is changed where it stands moves to the column of that status and takes its colour', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    ed.update<CardElement>(ids[0], { status: 'done' });
    const el = ed.getElement<CardElement>(ids[0])!;
    expect(el).toMatchObject({ status: 'done', color: k().columns[2].color });
    expect(el.x).toBeCloseTo(k().x + colLeft(k(), 2) + PAD);
  });

  it('a card dragged off the board keeps its status', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo']);
    drag(ed, ids[0], dropPoint(k(), 1));
    drag(ed, ids[0], { x: k().x + k().w + 400, y: k().y });
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'doing', frameId: null });
  });

  it('moving a column past a collapsed one carries its cards to its new place, keeping their status and colour', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo']);
    const todo = k().columns[0];
    setCollapsed(ed, kid, k().columns[1].id, true);
    moveColumnTo(ed, kid, todo.id, 2);
    expect(k().columns[2].id).toBe(todo.id);
    const el = ed.getElement<CardElement>(ids[0])!;
    expect(el).toMatchObject({ status: 'todo', color: todo.color });
    expect(el.x).toBeCloseTo(k().x + colLeft(k(), 2) + PAD);
  });

  it('collapsing a column folds its cards away without losing them: the outline still lists them, expanding brings them back', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo', 'todo']);
    const wide = k().w;
    const colId = k().columns[0].id;
    setCollapsed(ed, kid, colId, true);
    expect(k().w).toBeLessThan(wide);
    const folded = ed.getElement<CardElement>(ids[0])!;
    expect(ed.hitTest({ x: folded.x + folded.w / 2, y: folded.y + folded.h / 2 }, { types: ['card'] })).toBeNull();
    const kanbanItem = ed.getOutline().items.find((i) => i.id === kid);
    const column = kanbanItem?.children?.find((c) => c.id === `${kid}:${colId}`);
    expect(column?.fields).toMatchObject({ collapsed: true });
    expect(column?.children?.map((c) => c.id)).toEqual(stacked(ed, ids));
    setCollapsed(ed, kid, colId, false);
    expect(k().w).toBeCloseTo(wide);
    const back = ed.getElement<CardElement>(ids[0])!;
    expect(back.x).toBeCloseTo(k().x + colLeft(k(), 0) + PAD);
    expect(ed.hitTest({ x: back.x + back.w / 2, y: back.y + back.h / 2 }, { types: ['card'] })?.id).toBe(ids[0]);
  });

  it('dragging a column edge wider is one undo step, and the cards re-stack at the new width', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo']);
    const before = ed.getElement<CardElement>(ids[0])!;
    ed.beginGesture();
    for (const w of [300, 330, 360]) setColumnWidth(ed, kid, w);
    ed.endGesture();
    expect(k().colW).toBe(360);
    expect(ed.getElement<CardElement>(ids[0])!.w).toBeCloseTo(360 - 2 * PAD);
    ed.undo();
    expect(k().colW).toBe(280);
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ x: before.x, w: before.w });
  });

  it('deleting a column hands its cards to the neighbour column, with that column’s status', () => {
    const [ed] = setup();
    const { kid, k, ids } = kanbanWithCards(ed, ['todo']);
    drag(ed, ids[0], dropPoint(k(), 2)); // done
    removeColumn(ed, kid, k().columns[2].id);
    expect(k().columns).toHaveLength(2);
    expect(k().w).toBeCloseTo(GAP + 2 * (k().colW + GAP));
    expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'doing', x: k().x + colLeft(k(), 1) + PAD });
  });

  it('a collaborator’s edits never make my client rewrite the status or colour of cards it did not touch', () => {
    const [ann, bob] = setup(['ann', 'bob']);
    const { k, ids } = kanbanWithCards(ann, ['todo', 'todo']);
    board!.sync();
    // Bob sets one status in place (his client moves it to Doing) and gives the other his own colour …
    bob.update<CardElement>(ids[0], { status: 'doing' });
    bob.update<CardElement>(ids[1], { color: '#E64DA6' });
    board!.sync();
    // … then Ann edits something unrelated: her client leaves Bob's cards alone.
    ann.update<KanbanElement>(k().id, { title: 'Sprint 12' });
    board!.sync();
    for (const ed of [ann, bob]) {
      expect(ed.getElement<CardElement>(ids[0])).toMatchObject({ status: 'doing', color: k().columns[1].color });
      expect(ed.getElement<CardElement>(ids[1])!.color).toBe('#E64DA6');
    }
    expect(ann.getElement<CardElement>(ids[0])!.x).toBeCloseTo(k().x + colLeft(k(), 1) + PAD);
  });
});

describe('kanban fields', () => {
  const schemaOf = (ed: Editor, kid: string) => collectionSchema(ed.getElement<KanbanElement>(kid)!);

  it('two clients migrating the same old kanban at once never make a second Stage field: both read the columns as one select keyed by column id, and still agree after editing fields concurrently', () => {
    const [ann, bob] = setup(['ann', 'bob']);
    const kid = ann.create(newKanban({ x: 0, y: 0 }));
    board!.sync();
    const columns = ann.getElement<KanbanElement>(kid)!.columns;
    expect(schemaOf(ann, kid)).toEqual(schemaOf(bob, kid));
    expect(schemaOf(ann, kid)).toEqual([
      { id: COLUMN_FIELD_ID, name: 'Stage', type: 'select', options: columns.map((c) => ({ id: c.id, label: richTextToPlain(c.title), color: c.color, status: c.status })) },
    ]);
    // Both persist the migrated schema at the same moment, each with an edit of their own.
    addField(ann, kid, 'select');
    renameField(bob, kid, COLUMN_FIELD_ID, 'Phase');
    board!.sync();
    const [a, b] = [schemaOf(ann, kid), schemaOf(bob, kid)];
    expect(a).toEqual(b);
    expect(a.filter((f) => f.id === COLUMN_FIELD_ID)).toHaveLength(1);
    expect(a.find((f) => f.id === COLUMN_FIELD_ID)!.options!.map((o) => o.id)).toEqual(columns.map((c) => c.id));
    // Reading what was stored gives the same schema back (nothing to migrate twice).
    const k = ann.getElement<KanbanElement>(kid)!;
    expect(collectionSchema({ ...k, fields: storedFields(a) })).toEqual(a);
  });

  it('a column added or renamed by a client that knows nothing of fields becomes a Stage option everywhere, and the kanban keeps its other fields', () => {
    const [ann, old] = setup(['ann', 'old']);
    const kid = ann.create(newKanban({ x: 0, y: 0 }));
    const prio = addField(ann, kid, 'select')!;
    board!.sync();
    // An older tab (or server code) edits columns only, as kanbans always did.
    const k = old.getElement<KanbanElement>(kid)!;
    old.update<KanbanElement>(kid, { columns: [{ ...k.columns[0], title: 'Backlog' }, ...k.columns.slice(1), { id: 'review', title: 'Review', status: null, color: '#E64DA6' }] });
    board!.sync();
    const schema = schemaOf(ann, kid);
    expect(schema.map((f) => f.id)).toEqual([COLUMN_FIELD_ID, prio]);
    expect(schema[0].options!.map((o) => [o.id, o.label])).toEqual([
      [k.columns[0].id, 'Backlog'],
      [k.columns[1].id, 'In progress'],
      [k.columns[2].id, 'Done'],
      ['review', 'Review'],
    ]);
  });

  it('deleting a field leaves its values on the cards, dormant and reading as nothing; undo brings the field and every value back (and a deleted option reads as empty)', () => {
    const [ed] = setup();
    const { kid, ids } = kanbanWithCards(ed, ['todo', 'todo']);
    const prio = addField(ed, kid, 'select')!;
    const p1 = addOption(ed, kid, prio)!;
    const points = addField(ed, kid, 'number')!;
    // Values as the card feature stores them (card.setValues).
    for (const id of ids) ed.update<CardElement>(id, { values: { [prio]: p1, [points]: 3 } });
    const read = (id: string) => {
      const k = ed.getElement<KanbanElement>(kid)!;
      return Object.fromEntries(collectionSchema(k).filter((f) => f.id !== COLUMN_FIELD_ID).map((f) => [f.id, cardValue(k, ed.getElement<CardElement>(id)!, f)]));
    };
    expect(read(ids[0])).toEqual({ [prio]: p1, [points]: 3 });

    removeField(ed, kid, points);
    expect(read(ids[0])).toEqual({ [prio]: p1 });
    expect(ed.getElement<CardElement>(ids[0])!.values).toEqual({ [prio]: p1, [points]: 3 }); // no mass write
    removeOption(ed, kid, prio, p1);
    expect(read(ids[1])).toEqual({ [prio]: null });

    ed.undo();
    ed.undo();
    for (const id of ids) expect(read(id)).toEqual({ [prio]: p1, [points]: 3 });
    // The column field makes the columns: it can't be deleted.
    removeField(ed, kid, COLUMN_FIELD_ID);
    expect(schemaOf(ed, kid).some((f) => f.id === COLUMN_FIELD_ID)).toBe(true);
  });
});

describe('moving cards with the keyboard', () => {
  it('→ moves the selected card into the next column (its status and colour follow) and ↑ / ↓ swap it with its neighbour; one undo per press', () => {
    const [ed] = setup();
    const { k, ids } = kanbanWithCards(ed, ['todo', 'todo']);
    const [a, b] = ids;
    ed.select([b]);
    ed.runCommand('kanban.moveRight');
    const moved = ed.getElement<CardElement>(b)!;
    expect(moved).toMatchObject({ status: 'doing', color: k().columns[1].color });
    expect(moved.x).toBeCloseTo(k().x + colLeft(k(), 1) + PAD);
    expect(moved.y).toBeCloseTo(k().y + HEADER_H + COL_HEAD_H + PAD);
    ed.undo();
    expect(ed.getElement<CardElement>(b)).toMatchObject({ status: 'todo', color: k().columns[0].color });
    // Back in To do below a: ↑ puts it on top, ↓ back under a.
    const order = () => [a, b].sort((x, y) => ed.getElement(x)!.y - ed.getElement(y)!.y);
    ed.runCommand('kanban.moveUp');
    expect(order()).toEqual([b, a]);
    ed.runCommand('kanban.moveDown');
    expect(order()).toEqual([a, b]);
    ed.undo();
    expect(order()).toEqual([b, a]);
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
