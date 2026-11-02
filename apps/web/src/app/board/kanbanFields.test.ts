// Kanban fields where the features meet (docs/design/kanban-fields-and-views.md): the card
// feature writes values (`card.setValues`, card details), the kanban feature owns the schema and
// lays cards out. Real features, as the app loads them; real replicas of one board.
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLUMN_FIELD_ID,
  KANBAN_LAYOUT,
  kanbanColumnAt,
  kanbanColumnLeft,
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
