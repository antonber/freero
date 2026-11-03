import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import chartDef from './element';
import { addRow, CELLS, gridRows, pasteRows, placeChart, setCell } from './lib/data';

const bundle: FeatureBundle = { manifest, elements: [chartDef], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

function twoPeople(): [Editor, Editor, ChartElement] {
  board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
  const [ann, bob] = board.editors('chart');
  const id = placeChart(ann, { x: 0, y: 0 });
  board.sync();
  return [ann, bob, ann.getElement<ChartElement>(id)!];
}

const grid = (ed: Editor, id: string) => gridRows(ed.collection<string>(CELLS), ed.getElement<ChartElement>(id)!);

describe('two people editing one chart’s data at once', () => {
  it('keeps both numbers when two people change different cells at the same moment', () => {
    const [ann, bob, chart] = twoPeople();
    const [q1, q2] = chart.rows;
    const [thisYear, lastYear] = chart.series;
    setCell(ann, chart.id, q1.id, thisYear.id, '40');
    setCell(bob, chart.id, q2.id, lastYear.id, '7');
    board!.sync();
    for (const ed of [ann, bob]) {
      const g = grid(ed, chart.id);
      expect(g[1][1]).toBe('40');
      expect(g[2][2]).toBe('7');
    }
  });

  it('keeps a number typed while someone else adds a row', () => {
    const [ann, bob, chart] = twoPeople();
    addRow(ann, chart);
    setCell(bob, chart.id, chart.rows[3].id, chart.series[0].id, '99');
    board!.sync();
    for (const ed of [ann, bob]) {
      const g = grid(ed, chart.id);
      expect(g).toHaveLength(6);
      expect(g[4][1]).toBe('99');
    }
  });
});

describe('pasting spreadsheet rows into the data grid', () => {
  it('replaces the data with the pasted rows, the first naming the series, in one undo step', () => {
    const [ann, , chart] = twoPeople();
    expect(pasteRows(ann, chart, 'Team\tVotes\nAlpha\t3\nBeta\t1,200\n')).toBe(true);
    expect(grid(ann, chart.id)).toEqual([['', 'Votes'], ['Alpha', '3'], ['Beta', '1,200']]);
    ann.undo();
    expect(grid(ann, chart.id)[0]).toEqual(['', 'This year', 'Last year']);
  });

  it('a paste that can’t be a chart changes nothing and says why', () => {
    const [ann, , chart] = twoPeople();
    const before = grid(ann, chart.id);
    const notify = vi.spyOn(ann.host, 'notify');
    // A word where a number goes, a quote that never closes, more series than a chart shows.
    for (const bad of ['Month,Sales\nJan,lots\n', '"Name,Sales\nJan,3\n', `X\t${'S\t'.repeat(9)}\nQ1\t1\n`]) {
      notify.mockClear();
      expect(pasteRows(ann, chart, bad), bad).toBe(true);
      expect(notify, bad).toHaveBeenCalledWith(expect.stringMatching(/^Nothing pasted: /), 'error');
      expect(grid(ann, chart.id)).toEqual(before);
    }
    // One value is an ordinary paste into the cell, not a grid.
    expect(pasteRows(ann, chart, '42')).toBe(false);
  });
});
