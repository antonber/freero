// Many cards created in one step on a kanban (a paste, a drop, an import's chunk): every card
// joins the container under it and the kanban is laid out once, at the end of the step, exactly as
// it lays out cards created inside it (docs/design/kanban-fields-and-views.md §18; the benchmark,
// scripts/bench-kanban.mjs, measures how long it takes). Real features, real replicas.
import { afterEach, describe, expect, it } from 'vitest';
import { KANBAN_LAYOUT, kanbanColumnLeft, type CardElement, type FieldDef, type KanbanColumn, type KanbanElement } from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from './features';

const boards: TestBoard[] = [];
afterEach(() => {
  for (const b of boards.splice(0)) b.destroy();
});
const open = (users: string[]) => {
  const b = createTestBoard({ users, features });
  boards.push(b);
  return b.editors('card');
};

const COLUMNS: KanbanColumn[] = [
  // Only the first five cards (in each swimlane) show in To do; the others fold away below the board.
  { id: 'c_todo', title: 'To do', status: 'todo', color: '#8A89A3', limit: 5 },
  { id: 'c_doing', title: 'Doing', status: 'doing', color: '#2E9BF0' },
  { id: 'c_done', title: 'Done', status: 'done', color: '#1FA463' },
];
const PRIORITY: FieldDef = {
  id: 'f_prio',
  name: 'Priority',
  type: 'select',
  options: [
    { id: 'o_p0', label: 'P0', color: '#E5484D' },
    { id: 'o_p1', label: 'P1', color: '#F5A524' },
  ],
};
const POINTS: FieldDef = { id: 'f_pts', name: 'Points', type: 'number' };

/** A kanban in a frame, in swimlanes by Priority, its saved filter leaving out cards without Points. */
function sprint(ed: Editor): string {
  ed.create({ id: 'frame', type: 'frame', x: -100, y: -100, w: 1200, h: 3000, title: 'Q4' } as never);
  return ed.create({
    id: 'kb',
    type: 'kanban',
    x: 0,
    y: 0,
    w: 900,
    h: 320,
    title: 'Sprint',
    colW: 280,
    columns: COLUMNS,
    fields: [PRIORITY, POINTS],
    views: [{ id: 'board', name: 'Board', layout: 'board', subGroupBy: 'f_prio', filter: { op: 'and', rules: [{ field: 'f_pts', op: 'gt', value: 0 }] } }],
    activeView: 'board',
    frameId: 'frame',
  } as never);
}

/** 60 cards over the kanban's columns (a third each), half P0, every fifth without Points; `inside`: created as its members. */
function cards(ed: Editor, inside: boolean) {
  const k = ed.getElement<KanbanElement>('kb')!;
  return Array.from({ length: 60 }, (_, i) => ({
    id: `card${String(i).padStart(2, '0')}`,
    type: 'card',
    x: k.x + kanbanColumnLeft(k, i % 3) + 10,
    y: k.y + KANBAN_LAYOUT.headerH + 60 + (i % 20) * 7,
    w: 260,
    h: 90,
    title: `Card ${i}`,
    description: i % 2 ? '<p>Notes</p>' : '',
    color: '#5B3FF0',
    status: null,
    values: { f_prio: i % 2 ? 'o_p1' : 'o_p0', ...(i % 5 ? { f_pts: i % 8 } : {}) },
    ...(inside ? { frameId: 'kb' } : {}),
  })) as never[];
}

/** Where every card stands and what it took from its column and row. */
const placed = (ed: Editor) => {
  const shown = new Set(ed.elementsInRect({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }).map((el) => el.id));
  return ed
    .getElements()
    .filter((el): el is CardElement => el.type === 'card')
    .map((c) => ({ id: c.id, frameId: c.frameId, x: c.x, y: c.y, w: c.w, h: c.h, status: c.status, values: c.values, folded: !shown.has(c.id) }));
};

/** Nothing left for the kanban's layout to do: the step laid it out. */
const laidOut = (ed: Editor) => !ed.getDefinition('kanban')!.arrange!(ed.getElement('kb') as never, { editor: ed, touched: new Set(), previous: new Map() } as never)?.length;

/** The reference: the same cards created as the kanban's members (no container to look up), after it or in the same step. */
function asMembers(sameStep = false) {
  const [ed] = open(['ann']);
  if (sameStep)
    ed.transact(() => {
      sprint(ed);
      ed.createMany(cards(ed, true));
    });
  else {
    sprint(ed);
    ed.transact(() => ed.createMany(cards(ed, true)));
  }
  return placed(ed);
}

describe('many cards in one step', () => {
  it('cards dropped in one step onto a kanban a collaborator just made all join it (not the frame around it) and stand exactly where cards made inside it stand, swimlanes, filter and card limit included', () => {
    const [ann, bob] = open(['ann', 'bob']);
    ann.create({ type: 'sticky', x: 3000, y: 0, w: 200, h: 200, text: 'Already here', color: '#FFD84D' } as never);
    sprint(bob);
    boards[0].sync();

    ann.transact(() => ann.createMany(cards(ann, false)));

    expect(placed(ann)).toEqual(asMembers());
    expect(placed(ann).filter((c) => c.folded).length).toBeGreaterThan(10); // beyond the limit, left out by the filter
    expect(laidOut(ann)).toBe(true);
  });

  it('a kanban made in the same step as the cards dropped on it takes them', () => {
    const [ed] = open(['ann']);
    ed.transact(() => {
      ed.create({ type: 'sticky', x: 3000, y: 0, w: 200, h: 200, text: 'First', color: '#FFD84D' } as never);
      sprint(ed);
      ed.createMany(cards(ed, false));
    });

    expect(placed(ed).filter((c) => c.frameId === 'kb').length).toBe(60);
    expect(placed(ed)).toEqual(asMembers(true));
    expect(laidOut(ed)).toBe(true);
  });
});
