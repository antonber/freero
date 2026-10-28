import { afterEach, expect, it } from 'vitest';
import type { CardElement, StickyElement, Tag } from '@freero/shared';
import { createTestBoard, plainToRichText, richTextToPlain, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import { placeRows, toRows, itemsToExport } from './lib/board';
import { csvCell, exportRows, guessMapping, parseDelimited, rowsToItems, toCsv } from './lib/csv';

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
