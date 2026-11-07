// A card's group value is "the column it stands in", and an element is one whole value: a regroup
// and someone's concurrent drag of a card can't both win the card (#197).
import { afterEach, expect, it, vi } from 'vitest';
import { COLUMN_FIELD_ID, cardValue, collectionSchema, stalePlacement, type CardElement, type KanbanElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import elementDefs from './element';
import commands from './commands';
import { newKanban } from './lib/actions';
import { setGroupBy } from './lib/group';
import { COL_HEAD_H, HEADER_H, colLeft } from './lib/layout';
import { addField, addOption } from './lib/schema';

const bundle: FeatureBundle = { manifest, elements: elementDefs, tools: [], formats: [], panels: [], commands };
let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  vi.useRealTimers();
});

const card = (x: number, y: number): NewElement<'card'> => ({ type: 'card', x, y, w: 200, h: 80, title: 'Task', description: '', color: '#5B3FF0', status: 'todo' });
const dropPoint = (k: KanbanElement, i: number) => ({ x: k.x + colLeft(k, i) + k.colW / 2, y: k.y + HEADER_H + COL_HEAD_H + 40 });
function drag(ed: Editor, id: string, to: { x: number; y: number }) {
  const el = ed.getElement(id)!;
  ed.beginGesture();
  ed.moveBy([{ id, dx: to.x - (el.x + el.w / 2), dy: to.y - (el.y + el.h / 2) }]);
  ed.endGesture();
}

it("regrouping a board by Priority while someone drags cards to Done never rewrites a card's priority (set or not) nor loses its Stage, and the board settles with every card in its value's column (whichever writes win)", () => {
  vi.useFakeTimers();
  // Which of two concurrent writes of one element wins depends on the replicas' random client ids
  // (the kanban's own write too: Bob's drop re-sizes it): a few boards make sure all orders are met.
  const wrong: string[] = [];
  for (let run = 0; run < 12; run++) {
    board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
    const [ann, bob] = board.editors('kanban');
    const kid = ann.create(newKanban({ x: 0, y: 0 }));
    const k = (ed: Editor) => ed.getElement<KanbanElement>(kid)!;
    // Dropped into To do one after the other (the layout stacks them).
    const [high, none, low] = [0, 1, 2].map(() => ann.create(card(dropPoint(k(ann), 0).x - 100, dropPoint(k(ann), 0).y - 40)));
    const prio = addField(ann, kid, 'select')!;
    const [highOpt, lowOpt] = [addOption(ann, kid, prio)!, addOption(ann, kid, prio)!];
    ann.update<CardElement>(high, { values: { [prio]: highOpt } } as never);
    ann.update<CardElement>(low, { values: { [prio]: lowOpt } } as never);
    const [todo, , done] = k(ann).columns.map((c) => c.id);
    board.sync();
    vi.advanceTimersByTime(60_000); // setting the board up was long ago

    setGroupBy(ann, kid, prio); // Ann: "Group by Priority"
    drag(bob, high, dropPoint(k(bob), 2)); // Bob, at the same moment: drags two of the cards into Done
    drag(bob, none, dropPoint(k(bob), 2));
    board.sync();

    const check = (when: string) => {
      for (const ed of [ann, bob]) {
        const schema = collectionSchema(k(ed));
        const field = (id: string) => schema.find((f) => f.id === id)!;
        const expected = [[high, highOpt, [todo, done]], [none, null, [todo, done]], [low, lowOpt, [todo]]] as const;
        for (const [id, priority, stages] of expected) {
          const c = ed.getElement<CardElement>(id)!;
          const got = cardValue(k(ed), c, field(prio));
          const stage = cardValue(k(ed), c, field(COLUMN_FIELD_ID));
          if (got !== priority) wrong.push(`run ${run} ${when}: priority ${String(priority)} -> ${String(got)}`);
          if (!(stages as readonly unknown[]).includes(stage)) wrong.push(`run ${run} ${when}: Stage ${String(stage)}`);
        }
      }
    };
    check('merged');
    vi.advanceTimersByTime(2000); // the clients that took part re-lay the board out (KAI-75)
    board.sync();
    check('settled');
    // Settled: every card stands in the column of its value for the field the board is grouped by.
    for (const id of [high, none, low]) if (stalePlacement(k(ann), ann.getElement<CardElement>(id)!)) wrong.push(`run ${run}: a card still stands where an earlier grouping put it`);
    expect(JSON.stringify(ann.getElements())).toBe(JSON.stringify(bob.getElements()));
    board.destroy();
    board = null;
  }
  expect(wrong).toEqual([]);
});

it('a card still standing where an earlier grouping put it goes where someone drops it now, keeping the value it stood for', () => {
  board = createTestBoard({ users: ['ann'], features: [bundle] });
  const [ann] = board.editors('kanban');
  const kid = ann.create(newKanban({ x: 0, y: 0 }));
  const k = () => ann.getElement<KanbanElement>(kid)!;
  const id = ann.create(card(dropPoint(k(), 0).x - 100, dropPoint(k(), 0).y - 40));
  const prio = addField(ann, kid, 'select')!;
  const [high, low] = [addOption(ann, kid, prio)!, addOption(ann, kid, prio)!];
  ann.update<CardElement>(id, { values: { [prio]: high } } as never);
  const done = k().columns[2].id;
  setGroupBy(ann, kid, prio);
  // Dropped into Low while it still is as a drag into Done that hadn't seen the regroup left it
  // (before anyone's layout settled it).
  ann.beginGesture();
  ann.update<CardElement>(id, { placed: { kanban: kid, rev: '', field: COLUMN_FIELD_ID, key: done } });
  drag(ann, id, dropPoint(k(), k().columns.findIndex((c) => c.id === low)));
  ann.endGesture();
  const schema = collectionSchema(k());
  const value = (f: string) => cardValue(k(), ann.getElement<CardElement>(id)!, schema.find((x) => x.id === f)!);
  expect([value(prio), value(COLUMN_FIELD_ID)]).toEqual([low, done]);
});
