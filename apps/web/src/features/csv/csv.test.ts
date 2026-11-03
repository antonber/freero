import { afterEach, expect, it } from 'vitest';
import { cardValue, collectionSchema, valueText, type CardElement, type FieldDef, type KanbanElement, type StickyElement, type Tag } from '@freero/shared';
import { createTestBoard, plainToRichText, richTextToPlain, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import { placeRows, placeRowsOnKanban, toRows, itemsToExport } from './lib/board';
import { csvCell, exportRows, fieldColumns, guessColumnsFrom, guessMapping, parseDelimited, rowsToItems, toCsv } from './lib/csv';

// The board's `tags` collection belongs to the tags feature: a manifest claiming it is all a test needs.
const features: FeatureBundle['manifest'][] = [manifest, { name: 'tags', description: 'tags', owns: ['tags'] }];

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

const sticky = (x: number, text: string, tags: string[] = []): NewElement<'sticky'> => ({
  type: 'sticky',
  x,
  y: 0,
  w: 200,
  h: 200,
  color: 'yellow',
  text: plainToRichText(text),
  fontFamily: 'sans',
  fontSize: 'auto',
  textColor: '#17162B',
  align: 'center',
  vAlign: 'middle',
  tags,
});

/** Parses a CSV the way the import dialog does (header row, columns guessed). */
function importRows(csv: string, as: 'sticky' | 'card', people = new Map<string, string>()) {
  const rows = parseDelimited(csv, ',');
  return rowsToItems(rows.slice(1), { as, mapping: guessMapping(rows[0]), people });
}

it('stickies exported to CSV — text with a comma and a line break, a tag — read back with the same texts and tag names', () => {
  const source = createTestBoard({ users: ['ann'], features });
  const [ed] = source.editors('tags');
  ed.collection<Tag>('tags').set('t1', { id: 't1', name: 'Urgent', color: '#E5484D' });
  ed.createMany([sticky(0, 'Plain idea'), sticky(240, 'Milk, eggs\nand "bread"'), sticky(480, 'Tagged one', ['t1'])]);
  const csv = toCsv(exportRows(toRows(ed, itemsToExport(ed), new Map())));
  source.destroy();

  // Imported as cards by default, but the file says these are stickies.
  const rows = importRows(csv, 'card');
  expect(rows.map((r) => [r.item.type, r.item.text, r.tagNames])).toEqual([
    ['sticky', 'Plain idea', []],
    ['sticky', 'Milk, eggs\nand "bread"', []],
    ['sticky', 'Tagged one', ['Urgent']],
  ]);
  const [into] = (board = createTestBoard({ users: ['bob'], features })).editors('csv');
  const ids = placeRows(into, rows, 'grid', 'Imported');
  expect(ids.map((id) => richTextToPlain(into.getElement<StickyElement>(id)!.text))).toEqual(['Plain idea', 'Milk, eggs\nand "bread"', 'Tagged one']);
});

it('a flip card loses neither side in the CSV: the back has its own column, and re-importing keeps the front as the text', () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ed] = board.editors('csv');
  const card: NewElement<'card'> = {
    type: 'card',
    x: 0,
    y: 0,
    w: 240,
    h: 100,
    title: plainToRichText('Capital of Peru?'),
    description: '',
    color: '#5B3FF0',
    back: { title: plainToRichText('Lima'), color: '#FFF1B8' },
    flipped: true,
  };
  ed.createMany([card, sticky(400, 'One-sided')]);
  const table = exportRows(toRows(ed, itemsToExport(ed), new Map()));
  const back = table[0].indexOf('Back');
  expect(back).toBeGreaterThan(0);
  expect(table.slice(1).map((r) => [r[1], r[back]])).toEqual([
    ['Capital of Peru?', 'Lima'],
    ['One-sided', ''],
  ]);
  expect(importRows(toCsv(table), 'card').map((r) => r.item.text)).toEqual(['Capital of Peru?', 'One-sided']);
});

it('a cell a spreadsheet would run as a formula is exported as text, and reads back unchanged', () => {
  for (const evil of ['=HYPERLINK("http://x","y")', '+1+1', '-2', '@SUM(A1)']) {
    const cell = csvCell(evil);
    expect(cell.replace(/^"/, '')).toMatch(/^'/);
    expect(importRows(`Text\n${cell}\n`, 'sticky')[0].item.text).toBe(evil);
  }
});

it('200 rows become 200 cards on a kanban by status, assignees matched by name, and one undo takes them all back', () => {
  board = createTestBoard({ users: ['ann'], features });
  const [ed] = board.editors('csv');
  const statuses = ['To do', 'in progress', 'Done', ''];
  const lines = ['Title,Status,Assignee,Due date', ...Array.from({ length: 200 }, (_, i) => `Task ${i},${statuses[i % 4]},${i % 2 ? 'ann lee' : 'Nobody'},2026-11-0${(i % 9) + 1}`)];
  const ids = placeRows(ed, importRows(lines.join('\n'), 'card', new Map([['ann lee', 'u-ann']])), 'kanban', 'Backlog');

  const cards = ed.getElements().filter((e): e is CardElement => e.type === 'card');
  const kanban = ed.getElements().find((e) => e.type === 'kanban')!;
  expect(cards).toHaveLength(200);
  expect(cards.every((c) => c.frameId === kanban.id)).toBe(true);
  const task = (i: number) => cards.find((c) => richTextToPlain(c.title) === `Task ${i}`)!;
  expect([0, 1, 2, 3].map((i) => task(i).status)).toEqual(['todo', 'doing', 'done', 'todo']);
  expect([task(1).assigneeId, task(2).assigneeId, task(8).dueDate]).toEqual(['u-ann', null, '2026-11-09']);
  expect(ids).toHaveLength(201);

  ed.undo();
  expect(ed.getElements()).toHaveLength(0);
});

it('a kanban exported to CSV and imported back as a kanban has the same columns, its fields with their types (free text stays text), and every card’s values', () => {
  const source = createTestBoard({ users: ['ann'], features });
  const [ed] = source.editors('csv');
  const prio: FieldDef = { id: 'f_p', name: 'Priority', type: 'select', options: [{ id: 'hi', label: 'High', color: '#E5484D' }, { id: 'lo', label: 'Low', color: '#8A89A3' }] };
  const fields: FieldDef[] = [{ id: 'stage', name: 'Stage', type: 'select' }, prio, { id: 'f_pts', name: 'Points', type: 'number' }, { id: 'f_ok', name: 'Signed off', type: 'checkbox' }, { id: 'f_n', name: 'Notes', type: 'text' }];
  const columns = [
    { id: 'c1', title: 'Backlog', status: 'todo' as const, color: '#8A89A3' },
    { id: 'c2', title: 'In review', status: 'doing' as const, color: '#2E9BF0' },
  ];
  const k = ed.create({ type: 'kanban', x: 0, y: 0, w: 600, h: 400, title: 'Sprint', colW: 280, columns, fields } as never);
  const card = (col: number, title: string, values: Record<string, unknown>, y: number) =>
    ed.create({ type: 'card', x: 22 + col * 292, y, w: 260, h: 90, frameId: k, title: plainToRichText(title), description: '', color: '#5B3FF0', status: columns[col].status, values } as never);
  card(0, 'Invite dialog', { f_p: 'hi', f_pts: 3, f_n: 'Needs copy from design' }, 120);
  card(0, 'Guest role', { f_p: 'lo', f_pts: 5, f_n: 'Blocked on the API review' }, 220);
  card(1, 'Access page', { f_p: 'hi', f_ok: true, f_n: 'Ready to ship on Monday' }, 120);
  const csv = toCsv(exportRows(toRows(ed, itemsToExport(ed), new Map())));
  source.destroy();

  const [header, ...body] = parseDelimited(csv, ',');
  const mapping = guessMapping(header);
  const rows = rowsToItems(body, { as: 'card', mapping, people: new Map() });
  const columnsFrom = guessColumnsFrom(header)!;
  const found = fieldColumns(header, body, mapping, columnsFrom);
  expect(found.map((f) => [f.name, f.type])).toEqual([
    ['Priority', 'select'],
    ['Points', 'number'],
    ['Signed off', 'checkbox'],
    ['Notes', 'text'],
  ]);
  const [into] = (board = createTestBoard({ users: ['bob'], features })).editors('csv');
  const [kid] = placeRowsOnKanban(into, rows, { columnsFrom, fields: found, stageName: header[columnsFrom] }, 'Sprint');
  const made = into.getElement<KanbanElement>(kid)!;
  expect(made.columns.map((c) => richTextToPlain(c.title))).toEqual(['Backlog', 'In review']);
  const schema = collectionSchema(made);
  const byName = (n: string) => schema.find((f) => f.name === n)!;
  const read = (title: string) => {
    const c = into.getElements().find((e): e is CardElement => e.type === 'card' && richTextToPlain(e.title) === title)!;
    return ['Stage', 'Priority', 'Points', 'Signed off', 'Notes'].map((n) => valueText(byName(n), cardValue(made, c, byName(n))));
  };
  expect(read('Invite dialog')).toEqual(['Backlog', 'High', '3', '', 'Needs copy from design']);
  expect(read('Guest role')).toEqual(['Backlog', 'Low', '5', '', 'Blocked on the API review']);
  expect(read('Access page')).toEqual(['In review', 'High', '', 'Yes', 'Ready to ship on Monday']);
});
