// Table ↔ kanban (docs/design/kanban-fields-and-views.md, step 3e) where the features meet: the
// table's "Convert to kanban" hands its rows to the kanban feature (`kanban.createFromRows`), and
// "Copy as table" reads a kanban into a table of the table feature's own. Real features, as the
// app loads them.
import { afterEach, expect, it, vi } from 'vitest';
import {
  cardValue,
  collectionSchema,
  plainToRichText,
  richTextToPlain,
  tableCellKey,
  valueText,
  type CardElement,
  type FieldDef,
  type KanbanElement,
  type TableColumn,
  type TableElement,
} from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from './features';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

const ANN = { id: 'u-ann', name: 'Ann Lee', color: '#5b3ff0', avatarUrl: null };
const BOB = { id: 'u-bob', name: 'Bob Park', color: '#2E9BF0', avatarUrl: null };

function setup(): { ed: Editor; table: Editor } {
  board = createTestBoard({ users: [ANN], members: [ANN, BOB], features });
  const [ed] = board.editors();
  const [table] = board.editors('table');
  return { ed, table };
}

/** A table as people make it: a header row, then rows; `cells[r][c]` as the table stores them. */
function makeTable(ed: Editor, cols: Array<Omit<TableColumn, 'w'>>, cells: string[][]): TableElement {
  const rows = cells.map((_, i) => ({ id: `r${i}`, h: 44 }));
  const id = ed.create({ type: 'table', x: 400, y: 300, w: cols.length * 160, h: rows.length * 44, rows, cols: cols.map((c) => ({ ...c, w: 160 })), header: true, fontSize: 14 } as never);
  ed.transact(() => cells.forEach((row, r) => row.forEach((t, c) => t && ed.collection<string>('tableCells').set(tableCellKey('t', id, `r${r}`, cols[c].id), t))));
  return ed.getElement<TableElement>(id)!;
}

it('a table converts to a kanban where it stood — columns from the chosen column, a card per row with its values in typed fields — and one undo brings the table back with every cell', async () => {
  const { ed, table } = setup();
  const t = plainToRichText;
  const t0 = makeTable(
    table,
    [
      { id: 'c_task' },
      { id: 'c_stage', type: 'select', options: [{ id: 'o1', label: 'Backlog', color: '#E6E6EA' }, { id: 'o2', label: 'Doing', color: '#DDF0FF' }, { id: 'o3', label: 'Done', color: '#DDF6EA' }] },
      { id: 'c_pts', type: 'number' },
      { id: 'c_owner', type: 'person' },
      { id: 'c_ok', type: 'checkbox' },
      { id: 'c_due', type: 'date' },
      { id: 'c_prio' },
      { id: 'c_status' },
      { id: 'c_notes' },
    ],
    [
      [t('Task'), t('Stage'), t('Points'), t('Owner'), t('Signed off'), t('Due date'), t('Priority'), t('Status'), t('Notes')],
      [t('Invite dialog'), t('Doing'), '3', 'u-bob', 'true', '2026-11-20', t('High'), t('blocked'), t('Needs copy from design')],
      [t('Guest role'), t('Backlog'), '5', '', '', '', t('Low'), t('waiting'), t('Ask legal first')],
      [t('Access page'), t('Done'), '2', 'u-ann', 'true', '2026-11-04', t('High'), t('shipped'), t('Went out Monday')],
      [t('Audit log'), '', '1.5', '', '', '', t('Low'), '', ''],
      ['', '', '', '', '', '', '', '', ''],
    ],
  );
  const cellsBefore = [...ed.collection<string>('tableCells').entries()].filter(([k]) => k.includes(t0.id)).sort();

  ed.select([t0.id]);
  ed.runCommand('table.convertToKanban', { columnsFrom: 'c_stage', titleFrom: 'c_task' });
  await vi.waitFor(() => expect(ed.getElements().some((e) => e.type === 'kanban')).toBe(true));

  expect(ed.getElement(t0.id)).toBeUndefined();
  const k = ed.getElements().find((e): e is KanbanElement => e.type === 'kanban')!;
  expect([k.x, k.y]).toEqual([t0.x, t0.y]);
  // A column per option in its order, and one for the row without a stage; "Done" sets done.
  expect(k.columns.map((c) => [richTextToPlain(c.title), c.status])).toEqual([
    ['No Stage', null],
    ['Backlog', 'todo'],
    ['Doing', 'doing'],
    ['Done', 'done'],
  ]);
  const schema = collectionSchema(k);
  // Typed columns keep their type; a text column of repeating labels reads as a select; a column
  // named like a card's own field ("Status") stays a field, renamed.
  expect(schema.map((f) => [f.name, f.type])).toEqual([
    ['Stage', 'select'],
    ['Points', 'number'],
    ['Owner', 'person'],
    ['Signed off', 'checkbox'],
    ['Priority', 'select'],
    ['Status (field)', 'text'],
    ['Notes', 'text'],
  ]);
  const cards = ed.getElements().filter((e): e is CardElement => e.type === 'card' && e.frameId === k.id);
  expect(cards).toHaveLength(4); // the empty row is no card
  const read = (title: string) => {
    const c = cards.find((x) => richTextToPlain(x.title) === title)!;
    return [...schema.map((f: FieldDef) => valueText(f, cardValue(k, c, f), (id) => ({ 'u-ann': 'Ann', 'u-bob': 'Bob' })[id])), c.dueDate, c.status];
  };
  expect(read('Invite dialog')).toEqual(['Doing', '3', 'Bob', 'Yes', 'High', 'blocked', 'Needs copy from design', '2026-11-20', 'doing']);
  expect(read('Guest role')).toEqual(['Backlog', '5', '', '', 'Low', 'waiting', 'Ask legal first', null, 'todo']);
  expect(read('Access page')).toEqual(['Done', '2', 'Ann', 'Yes', 'High', 'shipped', 'Went out Monday', '2026-11-04', 'done']);
  expect(read('Audit log')).toEqual(['No Stage', '1.5', '', '', 'Low', '', '', null, null]);

  ed.undo();
  expect(ed.getElements().map((e) => e.type)).toEqual(['table']);
  expect(ed.getElement<TableElement>(t0.id)).toEqual(t0);
  expect([...ed.collection<string>('tableCells').entries()].filter(([k]) => k.includes(t0.id)).sort()).toEqual(cellsBefore);
});

it('“Copy as table” makes a separate table beside the kanban, a row per card in board order with typed columns, and leaves the kanban as it was', async () => {
  const { ed } = setup();
  const prio: FieldDef = { id: 'f_p', name: 'Priority', type: 'select', options: [{ id: 'hi', label: 'High', color: '#E5484D' }, { id: 'lo', label: 'Low', color: '#8A89A3' }] };
  const fields: FieldDef[] = [{ id: 'stage', name: 'Stage', type: 'select' }, prio, { id: 'f_pts', name: 'Points', type: 'number' }, { id: 'f_ok', name: 'Signed off', type: 'checkbox' }, { id: 'f_who', name: 'Reviewer', type: 'person' }];
  const columns = [
    { id: 'c1', title: 'Backlog', status: 'todo' as const, color: '#8A89A3' },
    { id: 'c2', title: 'In review', status: 'doing' as const, color: '#2E9BF0' },
  ];
  const kid = ed.create({ type: 'kanban', x: 0, y: 0, w: 600, h: 400, title: 'Sprint', colW: 280, columns, fields } as never);
  const card = (col: number, title: string, y: number, extra: Record<string, unknown>) =>
    ed.create({ type: 'card', x: 22 + col * 292, y, w: 260, h: 90, frameId: kid, title: plainToRichText(title), description: '', color: '#5B3FF0', status: columns[col].status, ...extra } as never);
  card(0, 'Invite dialog', 120, { values: { f_p: 'hi', f_pts: 3, f_who: 'u-bob' }, dueDate: '2026-11-20' });
  const guest = card(0, 'Guest role', 220, { values: { f_p: 'lo', f_pts: 5 } });
  card(1, 'Access page', 120, { values: { f_p: 'hi', f_ok: true } });
  // Moved above Invite dialog by hand: the board's order is no longer the order they were made in.
  ed.select([guest]);
  ed.runCommand('kanban.moveUp');
  const kanbanBefore = ed.getElements().filter((e) => e.type !== 'table');

  ed.select([kid]);
  ed.runCommand('table.copyKanbanAsTable');
  await vi.waitFor(() => expect(ed.getElements().some((e) => e.type === 'table')).toBe(true));

  expect(ed.getElements().filter((e) => e.type !== 'table')).toEqual(kanbanBefore);
  const tbl = ed.getElements().find((e): e is TableElement => e.type === 'table')!;
  const cells = ed.collection<string>('tableCells');
  const grid = tbl.rows.map((r) => tbl.cols.map((c) => richTextToPlain(cells.get(tableCellKey('t', tbl.id, r.id, c.id)) ?? '')));
  expect(grid).toEqual([
    ['Title', 'Stage', 'Priority', 'Points', 'Signed off', 'Reviewer', 'Due date'],
    ['Guest role', 'Backlog', 'Low', '5', '', '', ''],
    ['Invite dialog', 'Backlog', 'High', '3', '', 'u-bob', '2026-11-20'],
    ['Access page', 'In review', 'High', '', 'true', '', ''],
  ]);
  expect(tbl.cols.map((c) => c.type ?? 'text')).toEqual(['text', 'select', 'select', 'number', 'checkbox', 'person', 'date']);
  expect(tbl.cols[1].options!.map((o) => o.label)).toEqual(['Backlog', 'In review']);
  // It sits beside the kanban, not on it (nor in it).
  expect(tbl.x).toBeGreaterThanOrEqual(600);
  expect(tbl.frameId ?? null).toBeNull();
});
