// A kanban's view tabs (docs/design/kanban-fields-and-views.md, step 3a): the Board, where the real
// cards stand, and tables of the same cards. Which tab a person looks at is theirs until an editor
// saves it for everyone. Real features, as the app loads them; real replicas of one board.
import { afterEach, describe, expect, it } from 'vitest';
import { KANBAN_LAYOUT, groupFieldId, kanbanColumnAt, kanbanColumnLeft, type CardElement, type FieldDef, type KanbanColumn, type KanbanElement, type OutlineItem } from '@freero/shared';
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
const POINTS: FieldDef = { id: 'f_pts', name: 'Points', type: 'number' };
const PRIORITY: FieldDef = { id: 'f_prio', name: 'Priority', type: 'select', options: [{ id: 'o_p0', label: 'P0', color: '#E5484D' }] };

const kanban = (ed: Editor) =>
  ed.create({ type: 'kanban', x: 0, y: 0, w: 900, h: 320, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true, fields: [POINTS, PRIORITY] } as never);

function card(ed: Editor, kid: string, i: number, title: string): string {
  const k = ed.getElement<KanbanElement>(kid)!;
  const cx = k.x + kanbanColumnLeft(k, i) + k.colW / 2;
  return ed.create({ type: 'card', x: cx - 130, y: k.y + KANBAN_LAYOUT.headerH + 60, w: 260, h: 90, title, description: '', color: '#5B3FF0', status: COLUMNS[i].status } as never);
}

/** Drawn and hit on this person's board (not folded away for them). */
const onBoard = (ed: Editor, id: string) => {
  const c = ed.getElement<CardElement>(id)!;
  return ed.hitTest({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, { types: ['card'] })?.id === id;
};
const tabOf = (ed: Editor, kid: string, name: string) => (ed.getElement<KanbanElement>(kid)!.views ?? []).find((v) => v.name === name)!.id;

function inOutline(items: OutlineItem[], id: string): boolean {
  return items.some((i) => i.id === id || inOutline(i.children ?? [], id));
}

describe('view tabs', () => {
  it('looking at a table tab folds the kanban’s cards away for me alone — they leave my selection, my collaborator keeps them and nobody’s doc changes; when the tab is deleted they are back', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann);
    const id = card(ann, kid, 0, 'Fix login');
    ann.runCommand('kanban.addTableTab', { id: kid, name: 'Sheet' });
    ann.runCommand('kanban.showTab', { id: kid, tab: 'board' });
    board.sync();
    const tab = tabOf(bob, kid, 'Sheet');
    const before = JSON.stringify(ann.getElements());
    bob.select([id]);

    bob.runCommand('kanban.showTab', { id: kid, tab });
    board.sync();
    expect(onBoard(bob, id)).toBe(false);
    expect(bob.getSelection()).toEqual([]);
    expect(inOutline(bob.getOutline().items, id)).toBe(true);
    expect(onBoard(ann, id)).toBe(true);
    for (const ed of [ann, bob]) expect(JSON.stringify(ed.getElements())).toBe(before);

    ann.runCommand('kanban.deleteTab', { id: kid, tab });
    board.sync();
    expect(onBoard(bob, id)).toBe(true);
  });

  it('Save for everyone on a table tab makes it the tab everyone starts on, with my sort and my own changes cleared: a collaborator looking at the saved Board moves to it, the cards folded off his board', () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors('card');
    const kid = kanban(ann);
    const ids = ['A', 'B'].map((t) => card(ann, kid, 0, t));
    ann.runCommand('card.setValues', { id: ids[0], values: { f_pts: 1 } });
    ann.runCommand('card.setValues', { id: ids[1], values: { f_pts: 8 } });
    ann.runCommand('kanban.addTableTab', { id: kid, name: 'By points' });
    board.sync();
    const tab = tabOf(ann, kid, 'By points');
    ann.runCommand('kanban.setMyTable', { id: kid, tab, sort: [{ field: 'f_pts', dir: 'desc' }] });
    board.sync();
    expect(onBoard(bob, ids[0])).toBe(true);

    ann.runCommand('kanban.saveViewForEveryone', { id: kid });
    board.sync();
    const k = bob.getElement<KanbanElement>(kid)!;
    expect(k.activeView).toBe(tab);
    expect((k.views ?? []).find((v) => v.id === tab)).toMatchObject({ sort: [{ field: 'f_pts', dir: 'desc' }] });
    expect(onBoard(bob, ids[0])).toBe(false);
    expect(ann.getPersonalView(kid, tab)).toBeNull();
  });

  it('while everyone starts on a table tab, regrouping the board by Priority (what older clients write too) keeps the tab and keeps everyone on it, and the board lays its cards out by Priority', () => {
    board = createTestBoard({ users: ['ann'], features });
    const [ann] = board.editors('card');
    const kid = kanban(ann);
    const id = card(ann, kid, 1, 'Fix login');
    ann.runCommand('card.setValues', { id, values: { f_prio: 'o_p0' } });
    ann.runCommand('kanban.addTableTab', { id: kid, name: 'Sheet' });
    ann.runCommand('kanban.saveViewForEveryone', { id: kid });
    const tab = tabOf(ann, kid, 'Sheet');

    ann.runCommand('kanban.groupBy', { id: kid, field: 'f_prio' });
    const k = ann.getElement<KanbanElement>(kid)!;
    expect(k.activeView).toBe(tab);
    expect((k.views ?? []).map((v) => v.layout)).toEqual(['board', 'table']);
    expect(groupFieldId(k)).toBe('f_prio');
    const c = ann.getElement<CardElement>(id)!;
    expect(k.columns[kanbanColumnAt(k, c.x + c.w / 2)].id).toBe('o_p0');
  });
});
