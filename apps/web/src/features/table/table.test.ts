import { afterEach, describe, expect, it } from 'vitest';
import type { TableElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import tableDef from './element';
import { CELLS, cellText, setCellText } from './lib/cells';
import { insertRow, layoutTable, moveFrom, newTable, parseDelimited, toCsv } from './lib/model';

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
