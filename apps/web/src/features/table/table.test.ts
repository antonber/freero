import { afterEach, describe, expect, it } from 'vitest';
import type { TableElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import tableDef from './element';
import { CELLS, cellText, setCellText } from './lib/cells';
import { insertRow, layoutTable, moveFrom, newTable, parseDelimited, toCsv } from './lib/model';
import { createFromGrid, moveCell, patchOption, setColumnType, setFilter, sortByColumn } from './lib/actions';
import { plainGrid } from './lib/cells';

const bundle: FeatureBundle = { manifest, elements: [tableDef], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

function twoPeople(): [Editor, Editor] {
  board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
  const [a, b] = board.editors('table');
  return [a, b];
}

/** A 2 × 2 table both replicas know about. */
function sharedTable(ann: Editor): TableElement {
  let n = 0;
  const id = ann.create(newTable({ x: 0, y: 0 }, 2, 2, { newId: () => `k${++n}` }));
  board!.sync();
  return ann.getElement<TableElement>(id)!;
}

const text = (ed: Editor, t: TableElement, r: number, c: number) => cellText(ed.collection<string>(CELLS), t.id, t.rows[r].id, t.cols[c].id);

describe('two people editing one table at once', () => {
  it('keeps both texts when two people type into different cells at the same moment', () => {
    const [ann, bob] = twoPeople();
    const t = sharedTable(ann);
    setCellText(ann, t.id, t.rows[0].id, t.cols[0].id, 'from ann');
    setCellText(bob, t.id, t.rows[1].id, t.cols[1].id, 'from bob');
    board!.sync();
    for (const ed of [ann, bob]) {
      expect(text(ed, t, 0, 0)).toBe('from ann');
      expect(text(ed, t, 1, 1)).toBe('from bob');
    }
  });

  it('keeps text typed into a cell while someone else inserts a row above it', () => {
    const [ann, bob] = twoPeople();
    const t = sharedTable(ann);
    ann.update<TableElement>(t.id, insertRow(t, 0, () => 'new-row'));
    setCellText(bob, t.id, t.rows[1].id, t.cols[0].id, 'typed meanwhile');
    board!.sync();
    for (const ed of [ann, bob]) {
      const now = ed.getElement<TableElement>(t.id)!;
      expect(now.rows.map((r) => r.id)).toEqual(['new-row', t.rows[0].id, t.rows[1].id]);
      expect(text(ed, now, 2, 0)).toBe('typed meanwhile');
    }
  });
});

describe('cell edits and copies', () => {
  it('undo takes back a cell edit (cells are part of the undo history)', () => {
    const [ann] = twoPeople();
    const t = sharedTable(ann);
    ann.beginGesture();
    setCellText(ann, t.id, t.rows[0].id, t.cols[0].id, 'oops');
    ann.endGesture();
    ann.undo();
    expect(text(ann, t, 0, 0)).toBe('');
    ann.redo();
    expect(text(ann, t, 0, 0)).toBe('oops');
  });

  it('a duplicated table has its own cells: editing the copy leaves the original alone', () => {
    const [ann] = twoPeople();
    const t = sharedTable(ann);
    setCellText(ann, t.id, t.rows[0].id, t.cols[1].id, 'original');
    const [copyId] = ann.duplicate([t.id]);
    const copy = ann.getElement<TableElement>(copyId)!;
    expect(text(ann, copy, 0, 1)).toBe('original');
    setCellText(ann, copy.id, copy.rows[0].id, copy.cols[1].id, 'changed in copy');
    expect(text(ann, t, 0, 1)).toBe('original');
    // Undo: first the cell edit, then the duplicate together with its cells (one step).
    ann.undo();
    expect(text(ann, copy, 0, 1)).toBe('original');
    ann.undo();
    expect(ann.getElement(copyId)).toBeUndefined();
    expect(text(ann, copy, 0, 1)).toBe('');
  });
});

describe('table text after switching boards', () => {
  it("a table's plain text (copy as text, Layers label) reads its own board's cells, not the first board shown", () => {
    const paste = (ed: Editor, text: string) => {
      tableDef.importData!(ed, { files: [], text, html: null }, { x: 0, y: 0 });
      return ed.getElements().find((el) => el.type === 'table') as TableElement;
    };
    const first = createTestBoard({ users: ['ann'], features: [bundle] });
    paste(first.editors('table')[0], 'Old\tboard');
    first.destroy();
    board = createTestBoard({ users: ['ann'], features: [bundle] });
    const [ann] = board.editors('table');
    const t = paste(ann, 'Name\tCity\nAda\tLondon');
    expect(tableDef.toPlainText!(t, ann)).toBe('Name\tCity\nAda\tLondon');
  });
});

describe('table structure', () => {
  it('dragging a corner handle scales the columns so the grid still fills the table', () => {
    const t = { ...newTable({ x: 0, y: 0 }, 2, 3), id: 't' } as unknown as TableElement;
    const resized = { ...t, w: t.w * 2 };
    const patch = layoutTable(resized, t)!;
    expect(patch.cols!.reduce((s, c) => s + c.w, 0)).toBe(resized.w);
    expect(patch.cols![0].w).toBe(t.cols[0].w * 2);
  });

  it('Tab walks the cells row by row and asks for a new row after the last one', () => {
    const t = newTable({ x: 0, y: 0 }, 2, 2) as unknown as TableElement;
    expect(moveFrom(t, t.rows[0].id, t.cols[1].id, 'next')).toEqual({ rowId: t.rows[1].id, colId: t.cols[0].id });
    expect(moveFrom(t, t.rows[1].id, t.cols[1].id, 'next')).toBe('append');
    expect(moveFrom(t, t.rows[0].id, t.cols[0].id, 'up')).toBeNull();
  });
});

describe('typed columns (KAI-123)', () => {
  const alone = () => {
    board = createTestBoard({ users: ['ann'], features: [bundle] });
    return board.editors('table')[0];
  };
  const tableOf = (ed: Editor, id: string) => ed.getElement<TableElement>(id)!;
  const column = (ed: Editor, id: string, c: number) => plainGrid(ed.collection<string>(CELLS), tableOf(ed, id), { mode: 'export' }).map((r) => r[c]);

  it('sorts a number column by value (9 before 10), keeps the header on top and empty cells last', () => {
    const ann = alone();
    const id = createFromGrid(ann, [['Item', 'Cost'], ['a', '10'], ['b', ''], ['c', '9'], ['d', '100']], { x: 0, y: 0 });
    sortByColumn(ann, id, tableOf(ann, id).cols[1].id, 'asc');
    expect(column(ann, id, 0)).toEqual(['Item', 'c', 'a', 'd', 'b']);
    sortByColumn(ann, id, tableOf(ann, id).cols[1].id, 'desc');
    expect(column(ann, id, 0)).toEqual(['Item', 'd', 'a', 'c', 'b']);
  });

  it('keeps text that is not a number when a column becomes a number column and back', async () => {
    const ann = alone();
    const id = createFromGrid(ann, [['Item', 'Note'], ['a', '1,200'], ['b', 'about ten']], { x: 0, y: 0 });
    const colId = tableOf(ann, id).cols[1].id;
    await setColumnType(ann, id, colId, 'number');
    expect(column(ann, id, 1)).toEqual(['Note', '1200', 'about ten']);
    await setColumnType(ann, id, colId, 'text');
    expect(column(ann, id, 1)).toEqual(['Note', '1200', 'about ten']);
  });

  it('a pasted sheet keeps its numbers, dates and yes / no values when exported to CSV again', () => {
    const ann = alone();
    const grid = [['Task', 'Points', 'Due', 'Done'], ['Ship', '3', '2026-11-02', 'TRUE'], ['Test', '0.5', '2026-11-09', 'FALSE']];
    const id = createFromGrid(ann, grid, { x: 0, y: 0 });
    expect(tableOf(ann, id).cols.map((c) => c.type ?? 'text')).toEqual(['text', 'number', 'date', 'checkbox']);
    expect(parseDelimited(toCsv(plainGrid(ann.collection<string>(CELLS), tableOf(ann, id), { mode: 'export' })))).toEqual(grid);
  });

  it('renaming a select option relabels the cells holding it, and one undo takes both back', async () => {
    const ann = alone();
    const id = createFromGrid(ann, [['Task', 'Status'], ['a', 'Doing'], ['b', 'Done'], ['c', 'Doing']], { x: 0, y: 0 });
    const colId = tableOf(ann, id).cols[1].id;
    await setColumnType(ann, id, colId, 'select');
    const doing = tableOf(ann, id).cols[1].options!.find((o) => o.label === 'Doing')!;
    ann.beginGesture();
    patchOption(ann, id, colId, doing.id, { label: 'In progress' });
    ann.endGesture();
    expect(column(ann, id, 1)).toEqual(['Status', 'In progress', 'Done', 'In progress']);
    ann.undo();
    expect(column(ann, id, 1)).toEqual(['Status', 'Doing', 'Done', 'Doing']);
    expect(tableOf(ann, id).cols[1].options!.map((o) => o.label)).toEqual(['Doing', 'Done']);
  });

  it('Tab skips rows a filter hides, and adding a row from the last shown one keeps the hidden rows', () => {
    const ann = alone();
    const id = createFromGrid(ann, [['Task', 'Owner'], ['a', 'x'], ['b', ''], ['c', 'y']], { x: 0, y: 0 });
    const t = tableOf(ann, id);
    setFilter(ann, id, { colId: t.cols[1].id, op: 'notEmpty' });
    moveCell(ann, tableOf(ann, id), t.rows[1].id, t.cols[1].id, 'next');
    expect(ann.getEditingPart()).toBe(`${t.rows[3].id}:${t.cols[0].id}`);
    ann.stopEditing();
    moveCell(ann, tableOf(ann, id), t.rows[3].id, t.cols[1].id, 'next');
    expect(tableOf(ann, id).rows.slice(0, 4).map((r) => r.id)).toEqual(t.rows.map((r) => r.id));
    expect(tableOf(ann, id).rows).toHaveLength(5);
  });
});

describe('spreadsheet paste and CSV export', () => {
  it('reads cells copied from a spreadsheet, including a quoted cell with a line break and tabs', () => {
    expect(parseDelimited('Name\tNotes\r\nAda\t"two\nlines"\r\nBob\t\r\n')).toEqual([
      ['Name', 'Notes'],
      ['Ada', 'two\nlines'],
      ['Bob', ''],
    ]);
  });

  it('does not mistake one line of prose with commas for a CSV table', () => {
    expect(parseDelimited('Thanks, see you tomorrow, Ada')).toBeNull();
    expect(parseDelimited('First line, with a comma\nsecond line without')).toBeNull();
  });

  it('exports cells with commas, quotes and line breaks so a spreadsheet reads them back unchanged', () => {
    const grid = [
      ['a,b', 'say "hi"'],
      ['two\nlines', 'plain'],
    ];
    expect(parseDelimited(toCsv(grid))).toEqual(grid);
  });
});
