// Kanban fields where the features meet (docs/design/kanban-fields-and-views.md): the card
// feature writes values (`card.setValues`, card details), the kanban feature owns the schema and
// lays cards out. Real features, as the app loads them; real replicas of one board.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMN_FIELD_ID,
  KANBAN_LAYOUT,
  NO_GROUP,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanLaneAt,
  kanbanLanesTop,
  renderOutlineMarkdown,
  type CardElement,
  type FieldDef,
  type KanbanColumn,
  type KanbanElement,
  type OutlineItem,
} from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from './features';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  vi.useRealTimers();
});

const COLUMNS: KanbanColumn[] = [
  { id: 'c_todo', title: 'To do', status: 'todo', color: '#8A89A3' },
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

/** A kanban as stored; without `fields` it is one from before fields (what older clients wrote). */
function kanban(ed: Editor, fields?: FieldDef[]): string {
  return ed.create({ type: 'kanban', x: 0, y: 0, w: 900, h: 320, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true, ...(fields ? { fields } : {}) } as never);
}

/** A card created in column `i` (it stacks there). */
function card(ed: Editor, kid: string, i: number, title: string): string {
  const k = ed.getElement<KanbanElement>(kid)!;
  const cx = k.x + kanbanColumnLeft(k, i) + k.colW / 2;
  return ed.create({ type: 'card', x: cx - 130, y: k.y + KANBAN_LAYOUT.headerH + 60, w: 260, h: 90, title, description: '', color: '#5B3FF0', status: COLUMNS[i].status } as never);
}

const columnOf = (ed: Editor, kid: string, id: string) => {
  const k = ed.getElement<KanbanElement>(kid)!;
  const c = ed.getElement<CardElement>(id)!;
  return k.columns[kanbanColumnAt(k, c.x + c.w / 2)].id;
};

/** How the card's kanban shows it (its board view, with this person's own changes). */
function presentation(ed: Editor, id: string) {
  const c = ed.getElement<CardElement>(id)!;
  const k = ed.getElement<KanbanElement>(c.frameId!)!;
  return ed.getDefinition('kanban')!.presentChild!(k, c, { editor: ed, personal: true });
}

function find(items: OutlineItem[], id: string): OutlineItem | undefined {
  for (const i of items) {
    if (i.id === id) return i;
    const hit = find(i.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}

describe('kanban fields', () => {
  it('setting several field values on a card is one undo step and reaches the other client; values a field cannot take are ignored', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [PRIORITY, POINTS]);
    const id = card(ann, kid, 0, 'Fix login');
    board.sync();
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p1', f_pts: '3', $due: '2026-11-04', f_nope: 'x' } });
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_gone', f_pts: 'lots' } }); // not options / numbers: nothing
    board.sync();
    for (const ed of [ann, bob]) expect(ed.getElement<CardElement>(id)).toMatchObject({ values: { f_prio: 'o_p1', f_pts: 3 }, dueDate: '2026-11-04' });
    ann.undo();
    board.sync();
    for (const ed of [ann, bob]) {
      const c = ed.getElement<CardElement>(id)!;
      expect(c.values ?? {}).toEqual({});
      expect(c.dueDate ?? null).toBeNull();
    }
  });

  it("choosing another Stage for a card moves it into that column, where it takes the column's status and is shown in its colour, in one undo step", () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed);
    const id = card(ed, kid, 0, 'Fix login');
    const before = ed.getElement<CardElement>(id)!;
    ed.runCommand('card.setValues', { id, values: { [COLUMN_FIELD_ID]: 'c_done' } });
    expect(columnOf(ed, kid, id)).toBe('c_done');
    expect(ed.getElement<CardElement>(id)).toMatchObject({ status: 'done', color: '#5B3FF0' });
    expect(presentation(ed, id)?.accent).toBe('#1FA463');
    // It is stacked under the column header, not left where the move put its center.
    expect(ed.getElement<CardElement>(id)!.y).toBeCloseTo(KANBAN_LAYOUT.headerH + KANBAN_LAYOUT.colHeadH + KANBAN_LAYOUT.pad);
    ed.undo();
    expect(ed.getElement<CardElement>(id)).toMatchObject({ x: before.x, y: before.y, status: 'todo' });
  });

  it('compact cards: every card the kanban holds gets shorter in the same undo step and the column re-stacks; a card elsewhere keeps its size; undo brings the descriptions back', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed);
    const [a, b] = [card(ed, kid, 0, 'Fix login'), card(ed, kid, 0, 'Ship it')];
    const loose = ed.create({ type: 'card', x: 2000, y: 0, w: 260, h: 90, title: 'Elsewhere', description: '<p>Notes</p>', color: '#5B3FF0', status: 'todo' } as never);
    for (const id of [a, b]) ed.update<CardElement>(id, { description: '<p>Two lines of notes about what to do next and why it matters</p>' });
    const tall = (id: string) => ed.getElement<CardElement>(id)!.h;
    const before = { a: tall(a), b: tall(b), loose: tall(loose), bY: ed.getElement(b)!.y };
    ed.runCommand('kanban.setCardDisplay', { id: kid, density: 'compact' });
    expect(tall(a)).toBeLessThan(before.a);
    expect(tall(b)).toBeLessThan(before.b);
    expect(tall(loose)).toBe(before.loose);
    // Stacked again at their new height: no gap where the descriptions were.
    const [top, next] = [a, b].map((id) => ed.getElement<CardElement>(id)!).sort((x, y) => x.y - y.y);
    expect(next.y).toBeCloseTo(top.y + top.h + KANBAN_LAYOUT.itemGap);
    expect(presentation(ed, a)?.density).toBe('compact');
    ed.undo();
    expect([tall(a), tall(b), ed.getElement(b)!.y]).toEqual([before.a, before.b, before.bY]);
  });

  it('which fields cards show is my own until I save it for everyone: a collaborator still sees the saved fields and the board is unchanged; it follows me to my other session; once saved, everyone sees it', async () => {
    board = createTestBoard({ users: ['ann', 'bob', 'ann'], features });
    const [ann, bob, annElsewhere] = board.editors('card');
    const kid = kanban(ann, [PRIORITY, POINTS]);
    const id = card(ann, kid, 0, 'Fix login');
    const empty = card(ann, kid, 1, 'Nothing set');
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p1', f_pts: 3 } });
    board.sync();
    const chips = (ed: Editor, cid: string) => presentation(ed, cid)?.chips?.map((c) => `${c.name}: ${c.kind === 'options' ? c.options.map((o) => o.label).join() : c.kind === 'text' ? c.text : c.kind}`);
    const savedChips = chips(bob, id);

    ann.runCommand('kanban.setCardDisplay', { id: kid, show: ['f_pts', 'f_prio'], color: 'f_prio' });
    board.sync();
    expect(chips(ann, id)).toEqual(['Points: 3', 'Priority: P1']);
    expect(chips(ann, empty)).toEqual([]);
    expect(presentation(ann, id)?.accent).toBe('#F5A524');
    expect(chips(bob, id)).toEqual(savedChips);
    expect(presentation(bob, id)?.accent).toBe(COLUMNS[0].color);
    for (const ed of [ann, bob]) expect(ed.getElement<KanbanElement>(kid)!.views).toBeUndefined();

    annElsewhere.getPersonalView(kid, 'board'); // opening the board there loads my settings
    await new Promise((r) => setTimeout(r, 0));
    expect(chips(annElsewhere, id)).toEqual(['Points: 3', 'Priority: P1']);

    ann.runCommand('kanban.saveViewForEveryone', { id: kid });
    board.sync();
    expect(chips(bob, id)).toEqual(['Points: 3', 'Priority: P1']);
    expect(presentation(bob, id)?.accent).toBe('#F5A524');
    expect(ann.getPersonalView(kid, 'board')).toBeNull();
  });

  it("an old client's kanban loads as a Stage field made of its columns: the outline lists it, and each card's Stage is the column it is in", () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed); // no fields, no values: as stored before
    const id = card(ed, kid, 1, 'Fix login');
    const o = ed.getOutline();
    expect(find(o.items, kid)!.schema).toEqual([
      { id: COLUMN_FIELD_ID, name: 'Stage', type: 'select', options: COLUMNS.map((c) => ({ id: c.id, label: c.title, status: c.status })) },
    ]);
    expect(find(o.items, id)!.fields).toMatchObject({ status: 'doing', Stage: 'Doing' });
    expect(renderOutlineMarkdown(o)).toContain('fields: Stage (select: To do | Doing | Done)');
    // Nothing was written to migrate it.
    expect(ed.getElement<KanbanElement>(kid)!.fields).toBeUndefined();
    expect(ed.getElement<CardElement>(id)!.values).toBeUndefined();
  });
});

describe('grouping and swimlanes', () => {
  const TEAM: FieldDef = {
    id: 'f_team',
    name: 'Team',
    type: 'select',
    options: [
      { id: 't_web', label: 'Web', color: '#2E9BF0' },
      { id: 't_api', label: 'API', color: '#1FA463' },
    ],
  };
  const OWNER: FieldDef = { id: 'f_owner', name: 'Owner', type: 'person' };
  const k = (ed: Editor, kid: string) => ed.getElement<KanbanElement>(kid)!;
  const values = (ed: Editor, id: string) => ed.getElement<CardElement>(id)!.values ?? {};
  const laneOf = (ed: Editor, kid: string, id: string) => {
    const c = ed.getElement<CardElement>(id)!;
    return k(ed, kid).lanes![kanbanLaneAt(k(ed, kid), c.y + c.h / 2)].id;
  };
  /** A pointer drag of `id` so its center lands on `to`: one gesture, like the select tool's. */
  function drag(ed: Editor, id: string, to: { x: number; y: number }) {
    const el = ed.getElement(id)!;
    ed.beginGesture();
    ed.moveBy([{ id, dx: to.x - (el.x + el.w / 2), dy: to.y - (el.y + el.h / 2) }]);
    ed.endGesture();
  }

  it('grouping by Priority moves each card to its priority’s column ("No Priority" without one) and writes its Stage from where it stood, in one undo step; grouping back by Stage brings the Stage columns, their WIP limit and every card back', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed, [PRIORITY, POINTS]);
    ed.update<KanbanElement>(kid, { columns: COLUMNS.map((c) => (c.id === 'c_doing' ? { ...c, wip: 3 } : c)) });
    const [a, b, c] = [card(ed, kid, 0, 'A'), card(ed, kid, 1, 'B'), card(ed, kid, 2, 'C')];
    ed.runCommand('card.setValues', { id: a, values: { f_prio: 'o_p0' } });
    ed.runCommand('card.setValues', { id: b, values: { f_prio: 'o_p1' } });

    ed.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    expect(k(ed, kid).columns.map((col) => col.id)).toEqual([NO_GROUP, 'o_p0', 'o_p1']);
    expect([a, b, c].map((id) => columnOf(ed, kid, id))).toEqual(['o_p0', 'o_p1', NO_GROUP]);
    expect([a, b, c].map((id) => values(ed, id))).toEqual([{ stage: 'c_todo' }, { stage: 'c_doing' }, { stage: 'c_done' }]);
    // Regrouping is no drop: nobody's status changes.
    expect([a, b, c].map((id) => ed.getElement<CardElement>(id)!.status)).toEqual(['todo', 'doing', 'done']);
    expect(find(ed.getOutline().items, kid)!.fields).toMatchObject({ 'grouped by': 'Priority' });
    expect(find(ed.getOutline().items, a)!.fields).toMatchObject({ Stage: 'To do', Priority: 'P0' });

    ed.undo();
    expect(k(ed, kid).columns.map((col) => col.id)).toEqual(COLUMNS.map((col) => col.id));
    expect([a, b, c].map((id) => columnOf(ed, kid, id))).toEqual(['c_todo', 'c_doing', 'c_done']);
    expect(values(ed, a)).toEqual({ f_prio: 'o_p0' });

    // Grouped by Priority, C gets one by being dragged into P1; back by Stage, it is in Done again.
    ed.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    const p1 = k(ed, kid).columns.findIndex((col) => col.id === 'o_p1');
    drag(ed, c, { x: k(ed, kid).x + kanbanColumnLeft(k(ed, kid), p1) + 140, y: k(ed, kid).y + 140 });
    ed.runCommand('card.setValues', { id: c, values: { $status: 'todo' } }); // reopened meanwhile
    ed.runCommand('kanban.groupBy', { id: kid, field: COLUMN_FIELD_ID });
    expect(k(ed, kid).columns.map((col) => [col.id, col.wip ?? 0])).toEqual([['c_todo', 0], ['c_doing', 3], ['c_done', 0]]);
    expect([a, b, c].map((id) => columnOf(ed, kid, id))).toEqual(['c_todo', 'c_doing', 'c_done']);
    expect([a, b, c].map((id) => values(ed, id).f_prio)).toEqual(['o_p0', 'o_p1', 'o_p1']);
    expect(ed.getElement<CardElement>(c)!.status).toBe('todo'); // back in Done by its Stage, its status left alone
  });

  it('on a board grouped by Priority, setting a card’s Priority in its details moves it to that column, and clearing it to "No Priority"', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed, [PRIORITY]);
    const id = card(ed, kid, 0, 'A');
    ed.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    expect(columnOf(ed, kid, id)).toBe(NO_GROUP);
    ed.runCommand('card.setValues', { id, values: { f_prio: 'o_p1' } });
    expect(columnOf(ed, kid, id)).toBe('o_p1');
    expect(values(ed, id).f_prio).toBeUndefined(); // the column is the value: nothing stored
    ed.runCommand('card.setValues', { id, values: { f_prio: null } });
    expect(columnOf(ed, kid, id)).toBe(NO_GROUP);
  });

  it('grouped by a person field, every owner with cards has a column; giving a card to someone without one adds theirs', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed, [OWNER]);
    const [a, b] = [card(ed, kid, 0, 'A'), card(ed, kid, 1, 'B')];
    ed.runCommand('card.setValues', { id: a, values: { f_owner: 'u_ann' } });
    ed.runCommand('kanban.groupBy', { id: kid, field: 'f_owner' });
    expect(k(ed, kid).columns.map((col) => col.id)).toEqual([NO_GROUP, 'u_ann']);
    expect([a, b].map((id) => columnOf(ed, kid, id))).toEqual(['u_ann', NO_GROUP]);
    ed.runCommand('card.setValues', { id: b, values: { f_owner: 'u_bob' } });
    expect(k(ed, kid).columns.map((col) => col.id)).toEqual([NO_GROUP, 'u_ann', 'u_bob']);
    expect(columnOf(ed, kid, b)).toBe('u_bob');
    ed.undo(); // one step: the column and the move
    expect(k(ed, kid).columns.map((col) => col.id)).toEqual([NO_GROUP, 'u_ann']);
    expect(columnOf(ed, kid, b)).toBe(NO_GROUP);
  });

  it('with swimlanes by Team, a card dropped into the Doing × API cell takes both (Stage by its column, Team written, its status too) in one undo step; a Team changed in its details moves it to that row', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed, [PRIORITY, TEAM]);
    const [a, b] = [card(ed, kid, 0, 'A'), card(ed, kid, 0, 'B')];
    ed.runCommand('card.setValues', { id: a, values: { f_team: 't_web' } });
    ed.runCommand('kanban.setSwimlanes', { id: kid, field: 'f_team' });
    expect(k(ed, kid).lanes!.map((l) => l.id)).toEqual([NO_GROUP, 't_web', 't_api']);
    expect([a, b].map((id) => laneOf(ed, kid, id))).toEqual(['t_web', NO_GROUP]);
    expect(find(ed.getOutline().items, kid)!.fields).toMatchObject({ rows: 'Team' });

    const lanes = k(ed, kid).lanes!;
    const apiTop = kanbanLanesTop(k(ed, kid)) + lanes[0].h + lanes[1].h;
    drag(ed, b, { x: k(ed, kid).x + kanbanColumnLeft(k(ed, kid), 1) + 140, y: apiTop + KANBAN_LAYOUT.laneHeadH + 40 });
    expect(columnOf(ed, kid, b)).toBe('c_doing');
    expect(laneOf(ed, kid, b)).toBe('t_api');
    expect(ed.getElement<CardElement>(b)).toMatchObject({ status: 'doing', values: { f_team: 't_api' } });
    ed.undo();
    expect(columnOf(ed, kid, b)).toBe('c_todo');
    expect(laneOf(ed, kid, b)).toBe(NO_GROUP);
    expect(ed.getElement<CardElement>(b)!.status).toBe('todo');
    expect(values(ed, b).f_team).toBeUndefined();

    ed.runCommand('card.setValues', { id: a, values: { f_team: 't_api' } });
    expect(laneOf(ed, kid, a)).toBe('t_api');
    expect(columnOf(ed, kid, a)).toBe('c_todo');
  });

  it('one person regrouping by Priority while another drops a card into Done: both boards end up the same, every card in one column, none on top of another', () => {
    vi.useFakeTimers();
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [PRIORITY]);
    const ids = [card(ann, kid, 0, 'A'), card(ann, kid, 0, 'B'), card(ann, kid, 1, 'C')];
    ann.runCommand('card.setValues', { id: ids[0], values: { f_prio: 'o_p0' } });
    board.sync();
    vi.advanceTimersByTime(60_000);

    ann.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    drag(bob, ids[1], { x: k(bob, kid).x + kanbanColumnLeft(k(bob, kid), 2) + 140, y: k(bob, kid).y + 140 });
    board.sync();
    vi.advanceTimersByTime(2000);
    board.sync();
    vi.advanceTimersByTime(2000);
    board.sync();
    expect(JSON.stringify(ann.getElements())).toBe(JSON.stringify(bob.getElements()));
    const cards = ids.map((id) => ann.getElement<CardElement>(id)!);
    for (const c of cards) expect(k(ann, kid).columns.map((col) => col.id)).toContain(columnOf(ann, kid, c.id));
    for (const a of cards)
      for (const b of cards)
        if (a.id < b.id && columnOf(ann, kid, a.id) === columnOf(ann, kid, b.id)) expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  });

  it('a column showing its first 2 cards folds the others away below the board: not drawn or hit, still in the column for the outline and the WIP count', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('card');
    const kid = kanban(ed);
    const ids = ['A', 'B', 'C', 'D'].map((t) => card(ed, kid, 0, t));
    const tall = k(ed, kid).h;
    ed.update<KanbanElement>(kid, { columns: COLUMNS.map((c) => (c.id === 'c_todo' ? { ...c, limit: 2 } : c)) });
    expect(k(ed, kid).h).toBeLessThan(tall);
    const onBoard = (id: string) => {
      const c = ed.getElement<CardElement>(id)!;
      return ed.hitTest({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, { types: ['card'] })?.id === id;
    };
    expect(ids.filter(onBoard)).toHaveLength(2);
    for (const id of ids.filter((x) => !onBoard(x))) {
      expect(ed.getElement<CardElement>(id)!.y).toBeGreaterThan(k(ed, kid).y + k(ed, kid).h);
      expect(columnOf(ed, kid, id)).toBe('c_todo');
    }
    const column = find(ed.getOutline().items, `${kid}:c_todo`)!;
    expect(column.children!.map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(column.fields).toMatchObject({ shows: 2 });
  });
});

describe('filter, sort and a locked view', () => {
  const k = (ed: Editor, kid: string) => ed.getElement<KanbanElement>(kid)!;
  const at = (ed: Editor, id: string) => ed.getElement<CardElement>(id)!;
  const onBoard = (ed: Editor, id: string) => {
    const c = at(ed, id);
    return ed.hitTest({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, { types: ['card'] })?.id === id;
  };
  /** The column's cards top to bottom. */
  const stack = (ed: Editor, ids: string[]) => [...ids].sort((p, q) => at(ed, p).y - at(ed, q).y);
  const P0_ONLY = { op: 'and', rules: [{ field: 'f_prio', op: 'is', value: 'o_p0' }] };

  it('a card the saved filter leaves out folds away below the board: its column closes up and it is neither drawn nor hit, on every client, but it stays in its column for the WIP count and the outline lists it, marked filtered', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [PRIORITY, POINTS]);
    const ids = ['A', 'B', 'C'].map((t) => card(ann, kid, 0, t));
    const [top, middle, bottom] = stack(ann, ids);
    for (const id of [top, bottom]) ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p0' } });
    const middleY = at(ann, middle).y;
    board.sync();

    ann.runCommand('kanban.setMyFilter', { id: kid, filter: P0_ONLY });
    ann.runCommand('kanban.saveViewForEveryone', { id: kid });
    board.sync();
    expect(JSON.stringify(bob.getElements())).toBe(JSON.stringify(ann.getElements()));
    for (const ed of [ann, bob]) {
      expect([top, middle, bottom].map((id) => onBoard(ed, id))).toEqual([true, false, true]);
      expect(at(ed, middle).y).toBeGreaterThan(k(ed, kid).y + k(ed, kid).h);
      expect(columnOf(ed, kid, middle)).toBe('c_todo');
      expect(at(ed, bottom).y).toBeCloseTo(middleY);
    }
    const kanbanLine = find(bob.getOutline().items, kid)!;
    expect(kanbanLine.fields).toMatchObject({ filter: 'Priority is P0' });
    const column = find(bob.getOutline().items, `${kid}:c_todo`)!;
    expect(column.children!.map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(column.children!.find((c) => c.id === middle)!.fields).toMatchObject({ filtered: true });
  });

  it('a filter I set for myself only fades the cards it leaves out, for me: nothing moves on anyone’s board and my collaborator sees nothing faded', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [PRIORITY]);
    const [kept, left] = [card(ann, kid, 0, 'Kept'), card(ann, kid, 0, 'Left out')];
    ann.runCommand('card.setValues', { id: kept, values: { f_prio: 'o_p0' } });
    board.sync();
    const before = JSON.stringify(ann.getElements());

    bob.runCommand('kanban.setMyFilter', { id: kid, filter: P0_ONLY });
    board.sync();
    expect(presentation(bob, left)?.muted).toBe(true);
    expect(presentation(bob, kept)?.muted).toBeFalsy();
    expect(presentation(ann, left)?.muted).toBeFalsy();
    for (const ed of [ann, bob]) {
      expect(JSON.stringify(ed.getElements())).toBe(before);
      expect(onBoard(ed, left)).toBe(true);
    }
  });

  it('sorting by Points orders the column by it for everyone; back to manual order puts every card where people had stacked it', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [POINTS]);
    const ids = ['A', 'B', 'C'].map((t) => card(ann, kid, 0, t));
    const manual = stack(ann, ids);
    // Points against the manual order: 3, 1, 2.
    manual.forEach((id, i) => ann.runCommand('card.setValues', { id, values: { f_pts: [3, 1, 2][i] } }));
    const manualYs = manual.map((id) => at(ann, id).y);
    board.sync();

    ann.runCommand('kanban.setSort', { id: kid, sort: [{ field: 'f_pts', dir: 'asc' }] });
    board.sync();
    for (const ed of [ann, bob]) expect(stack(ed, ids)).toEqual([manual[1], manual[2], manual[0]]);

    ann.runCommand('kanban.setSort', { id: kid, sort: [] });
    board.sync();
    for (const ed of [ann, bob]) {
      expect(stack(ed, ids)).toEqual(manual);
      expect(manual.map((id) => at(ed, id).y)).toEqual(manualYs);
    }
  });

  it('a view one editor locked can’t be changed as saved by another — not its grouping, its sort or by saving their own view for everyone — while their own view settings still work', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features, role: 'editor' });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann, [PRIORITY, POINTS]);
    const id = card(ann, kid, 0, 'Fix login');
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p1', f_pts: 2 } });
    ann.runCommand('kanban.lockView', { id: kid, locked: true });
    board.sync();
    const saved = JSON.stringify(k(bob, kid));

    bob.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    bob.runCommand('kanban.setSort', { id: kid, sort: [{ field: 'f_pts', dir: 'desc' }] });
    bob.runCommand('kanban.setCardDisplay', { id: kid, show: ['f_pts'] });
    bob.runCommand('kanban.saveViewForEveryone', { id: kid });
    board.sync();
    expect(JSON.stringify(k(ann, kid))).toBe(saved);
    expect(presentation(bob, id)?.chips?.map((c) => c.name)).toEqual(['Points']);

    ann.runCommand('kanban.lockView', { id: kid, locked: false });
    board.sync();
    bob.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    expect(columnOf(bob, kid, id)).toBe('o_p1');
  });
});
