// A chart's data grid: one `chartCells` record per cell (layout in @freero/shared charts.ts), so
// people editing different cells at once never overwrite each other; adding or removing a row or a
// series never re-keys the others. The collection is `undoable` (feature.ts).
import {
  CHART_CELLS,
  CHART_HEAD,
  CHART_LABEL,
  CHART_LIMITS,
  chartCellKey,
  ChartDataError,
  chartFromGrid,
  chartGridFromRows,
  parseChartNumber,
  splitPastedGrid,
  type ChartCopyContent,
  type ChartElement,
  type ChartGrid,
} from '@freero/shared';
import type { Collection, Editor, NewElement, Point } from '@engine';
import { nanoid } from 'nanoid';

export const CELLS = CHART_CELLS;
export const newId = () => nanoid(10);

const cells = (editor: Editor) => editor.collection<string>(CELLS);

export function cellOf(coll: Pick<Collection<string>, 'get'>, chartId: string, rowId: string, colId: string): string {
  return coll.get(chartCellKey(chartId, rowId, colId)) ?? '';
}

/** Writes one cell (empty deletes its record). Owner-scoped editor only. */
export function setCell(editor: Editor, chartId: string, rowId: string, colId: string, text: string): void {
  const key = chartCellKey(chartId, rowId, colId);
  const coll = cells(editor);
  const v = text.trim().slice(0, CHART_LIMITS.cell);
  if (!v) {
    if (coll.get(key) !== undefined) coll.delete(key);
  } else if (coll.get(key) !== v) coll.set(key, v);
}

/** Every cell of a chart (copy, duplicate, templates). */
export function readContent(editor: Editor, el: Pick<ChartElement, 'id' | 'rows' | 'series'>): ChartCopyContent {
  const coll = cells(editor);
  const out: ChartCopyContent = {};
  const put = (r: string, c: string) => {
    const v = cellOf(coll, el.id, r, c);
    if (v) out[`${r}:${c}`] = v;
  };
  for (const s of el.series) put(CHART_HEAD, s.id);
  for (const r of el.rows) {
    put(r.id, CHART_LABEL);
    for (const s of el.series) put(r.id, s.id);
  }
  return out;
}

export function writeContent(editor: Editor, chartId: string, content: ChartCopyContent): void {
  for (const [part, v] of Object.entries(content)) {
    const i = part.indexOf(':');
    if (i > 0 && typeof v === 'string') setCell(editor, chartId, part.slice(0, i), part.slice(i + 1), v);
  }
}

/** The chart's data as rows of text, header first (the outline, CSV, the data panel). */
export function gridRows(coll: Pick<Collection<string>, 'get'>, el: Pick<ChartElement, 'id' | 'rows' | 'series'>): string[][] {
  return [
    ['', ...el.series.map((s) => cellOf(coll, el.id, CHART_HEAD, s.id))],
    ...el.rows.map((r) => [cellOf(coll, el.id, r.id, CHART_LABEL), ...el.series.map((s) => cellOf(coll, el.id, r.id, s.id))]),
  ];
}

/** Removes every cell of the chart that isn't in its current grid (after a row or series goes). */
function dropCells(editor: Editor, chartId: string, keep: Pick<ChartElement, 'rows' | 'series'>): void {
  const coll = cells(editor);
  const rows = new Set([CHART_HEAD, ...keep.rows.map((r) => r.id)]);
  const cols = new Set([CHART_LABEL, ...keep.series.map((s) => s.id)]);
  const prefix = `c:${chartId}:`;
  for (const [key] of coll.entries()) {
    if (!key.startsWith(prefix)) continue;
    const [r, c] = key.slice(prefix.length).split(':');
    if (!rows.has(r) || !cols.has(c)) coll.delete(key);
  }
}

/**
 * Replaces the chart's whole data with `grid` (a paste): new rows and series, their cells, in one
 * transaction (one undo step). Series keep their colours by position.
 */
export function replaceData(editor: Editor, el: ChartElement, grid: ChartGrid): void {
  const made = chartFromGrid(grid, newId);
  const series = made.series.map((s, i) => (el.series[i]?.color ? { ...s, color: el.series[i].color } : s));
  editor.transact(() => {
    dropCells(editor, el.id, { rows: [], series: [] });
    editor.update<ChartElement>(el.id, { rows: made.rows, series });
    writeContent(editor, el.id, made.content);
  });
}

/**
 * Pasted text (spreadsheet rows or CSV, the first row naming the series) replacing the chart's
 * data. False when the text isn't rows at all (an ordinary paste into one cell). Text that can't
 * be a chart (a word where a number goes, too many series, an unclosed quote) changes nothing and
 * the person is told why.
 */
export function pasteRows(editor: Editor, chart: ChartElement, text: string): boolean {
  try {
    const rows = splitPastedGrid(text);
    if (!rows || rows.length < 2) return false;
    replaceData(editor, chart, chartGridFromRows(rows));
  } catch (e) {
    if (!(e instanceof ChartDataError)) throw e;
    editor.host.notify(`Nothing pasted: ${e.message}.`, 'error');
  }
  return true;
}

export function addRow(editor: Editor, el: ChartElement): void {
  if (el.rows.length >= CHART_LIMITS.rows) return editor.host.notify(`A chart can show at most ${CHART_LIMITS.rows} rows`, 'info');
  editor.update<ChartElement>(el.id, { rows: [...el.rows, { id: newId() }] });
}

export function removeRow(editor: Editor, el: ChartElement, rowId: string): void {
  if (el.rows.length <= 1) return;
  const rows = el.rows.filter((r) => r.id !== rowId);
  editor.transact(() => {
    editor.update<ChartElement>(el.id, { rows });
    dropCells(editor, el.id, { rows, series: el.series });
  });
}

export function addSeries(editor: Editor, el: ChartElement): void {
  if (el.series.length >= CHART_LIMITS.series) return editor.host.notify(`A chart can show at most ${CHART_LIMITS.series} series`, 'info');
  editor.update<ChartElement>(el.id, { series: [...el.series, { id: newId() }] });
}

export function removeSeries(editor: Editor, el: ChartElement, seriesId: string): void {
  if (el.series.length <= 1) return;
  const series = el.series.filter((s) => s.id !== seriesId);
  editor.transact(() => {
    editor.update<ChartElement>(el.id, { series });
    dropCells(editor, el.id, { rows: el.rows, series });
  });
}

/** Is `text` something a value cell may hold ('' or a number)? */
export const isValue = (text: string) => !text.trim() || parseChartNumber(text) !== null;

const SAMPLE: string[][] = [
  ['', 'This year', 'Last year'],
  ['Q1', '12', '9'],
  ['Q2', '18', '14'],
  ['Q3', '15', '16'],
  ['Q4', '22', '19'],
];

/** A new bar chart with example data, centred on `at` (one transaction). Returns its id. */
export function placeChart(editor: Editor, at: Point): string {
  const made = chartFromGrid(chartGridFromRows(SAMPLE), newId);
  const w = 480;
  const h = 320;
  let id = '';
  editor.transact(() => {
    id = editor.create<'chart'>(
      { type: 'chart', kind: 'bar', title: '', rows: made.rows, series: made.series, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h } as NewElement<'chart'>,
      { select: true },
    );
    writeContent(editor, id, made.content);
  });
  return id;
}
