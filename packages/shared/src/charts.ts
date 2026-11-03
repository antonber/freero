// Charts (#137): the data grid behind a ChartElement (elements.ts), read and written the same way
// by the chart feature, the board outline and the server (MCP add_diagram `chart`).
//
//   chartCells key                     value
//   c:<chartId>:<rowId>:<colId>        string    a category label (colId CHART_LABEL), a series
//                                                name (rowId CHART_HEAD) or a value (a number as
//                                                text, '' / absent = no value)
//
// One key per cell, so concurrent edits of different cells merge; row and series ids are stable,
// so adding or removing one never re-keys the others.
import type { ChartElement, ChartKind } from './elements';

export const CHART_CELLS = 'chartCells';
export const CHART_KINDS: readonly ChartKind[] = ['bar', 'stackedBar', 'line', 'area', 'pie'];
/** Row id of the series names. */
export const CHART_HEAD = '_';
/** Column id of the category labels. */
export const CHART_LABEL = '_';
export const CHART_LIMITS = { rows: 50, series: 8, cell: 200 } as const;

/**
 * Series colours: Freero's palette (ui/tokens.css), in an order where neighbours stay apart. A
 * series' own `color` wins.
 */
export const CHART_COLORS = ['#5B3FF0', '#1FBF96', '#F5A524', '#F0645A', '#3B8BF0', '#E2559B', '#8A6A00', '#4B4A63'] as const;

export const chartCellKey = (chartId: string, rowId: string, colId: string): string => `c:${chartId}:${rowId}:${colId}`;

/** The chart a `chartCells` key belongs to (null: not a cell key). See ELEMENT_CONTENT_COLLECTIONS. */
export function chartCellOwner(key: string): string | null {
  if (!key.startsWith('c:')) return null;
  const id = key.slice(2).split(':')[0];
  return id || null;
}

/** What a chart carries outside the elements map when copied: "<rowId>:<colId>" → cell text. */
export type ChartCopyContent = Record<string, string>;

/** The `chartCells` entries that hold `content` for chart `chartId`. */
export function chartCellEntries(chartId: string, content: ChartCopyContent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [part, v] of Object.entries(content)) {
    const i = part.indexOf(':');
    if (i <= 0 || typeof v !== 'string' || !v) continue;
    out[chartCellKey(chartId, part.slice(0, i), part.slice(i + 1))] = v;
  }
  return out;
}

/**
 * A value as people type or paste it: "1,234.5", "45%", "$12", "€ 3", "-7", "1 200". Null when
 * it isn't a number (an empty cell is no value, not an error: callers check for '').
 */
export function parseChartNumber(text: string): number | null {
  const s = text
    .trim()
    .replace(/^[$€£¥₹]\s*/, '')
    .replace(/\s*[%$€£¥₹]$/, '')
    .replace(/(?<=\d)[,\s  ](?=\d{3}\b)/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Why a grid can't be a chart, in words for the person who pasted or sent it. */
export class ChartDataError extends Error {}

/** A chart's data as rows: the series names, then each category with its values (as typed). */
export interface ChartGrid {
  series: string[];
  rows: Array<{ label: string; values: string[] }>;
}

/**
 * Rows of cells (the first is the header: a corner cell, then the series names) as chart data.
 * Throws ChartDataError naming the first problem: too few or too many rows / series, a row wider
 * than the header, a value that isn't a number.
 */
export function chartGridFromRows(input: readonly (readonly unknown[])[]): ChartGrid {
  const rows = input.map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? '' : String(c)).trim()) : null));
  if (rows.some((r) => r === null)) throw new ChartDataError('Chart data is rows of cells');
  const grid = [...(rows as string[][])];
  while (grid.length && !grid[grid.length - 1].some(Boolean)) grid.pop();
  if (grid.length < 2) throw new ChartDataError('A chart needs a header row and at least one row of values');
  const [head, ...body] = grid;
  const width = Math.max(...grid.map((r) => r.length));
  while (head.length < width) head.push('');
  const nSeries = width - 1;
  if (nSeries < 1) throw new ChartDataError('A chart needs a column of labels and at least one column of values');
  if (nSeries > CHART_LIMITS.series) throw new ChartDataError(`A chart can show at most ${CHART_LIMITS.series} series (this has ${nSeries})`);
  if (body.length > CHART_LIMITS.rows) throw new ChartDataError(`A chart can show at most ${CHART_LIMITS.rows} rows (this has ${body.length})`);
  for (const r of grid) for (const c of r) if (c.length > CHART_LIMITS.cell) throw new ChartDataError(`A cell can hold at most ${CHART_LIMITS.cell} characters`);
  const out: ChartGrid = { series: head.slice(1).map((s, i) => s || `Series ${i + 1}`), rows: [] };
  body.forEach((r, i) => {
    const label = r[0] ?? '';
    const values = Array.from({ length: nSeries }, (_, k) => r[k + 1] ?? '');
    for (const v of values)
      if (v && parseChartNumber(v) === null)
        throw new ChartDataError(`Row ${i + 2}${label ? ` (“${label.slice(0, 40)}”)` : ''} has “${v.slice(0, 40)}” where a number goes`);
    out.rows.push({ label, values });
  });
  return out;
}

/**
 * Pasted text as rows of cells: tab-separated (spreadsheets) or comma-separated (CSV, with quoted
 * fields). Null when it isn't a grid at all (one line without a separator: ordinary text).
 * Throws ChartDataError for a quote that never closes.
 */
export function splitPastedGrid(text: string): string[][] | null {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.includes('\n') && !src.includes('\t')) return null;
  const sep = src.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
      atStart = true;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atStart = true;
    } else {
      cell += ch;
      if (ch !== ' ') atStart = false;
    }
  }
  if (quoted) throw new ChartDataError('A quoted cell never closes (a " is missing)');
  row.push(cell);
  rows.push(row);
  return rows;
}

/** The series colour drawn for series `i`. */
export const chartColor = (series: ChartElement['series'][number] | undefined, i: number): string => series?.color || CHART_COLORS[i % CHART_COLORS.length];

/** What a chart shows: its categories, and per series its name, colour and values (null: none). */
export interface ChartData {
  labels: string[];
  series: Array<{ id: string; name: string; color: string; values: Array<number | null> }>;
}

export function readChart(el: Pick<ChartElement, 'id' | 'rows' | 'series'>, get: (key: string) => string | undefined): ChartData {
  return {
    labels: el.rows.map((r) => get(chartCellKey(el.id, r.id, CHART_LABEL)) ?? ''),
    series: el.series.map((s, i) => ({
      id: s.id,
      name: get(chartCellKey(el.id, CHART_HEAD, s.id)) || `Series ${i + 1}`,
      color: chartColor(s, i),
      values: el.rows.map((r) => {
        const v = get(chartCellKey(el.id, r.id, s.id));
        return v ? parseChartNumber(v) : null;
      }),
    })),
  };
}

/** A grid as a new chart's structure and cells (ids from `newId`). */
export function chartFromGrid(grid: ChartGrid, newId: () => string): { rows: ChartElement['rows']; series: ChartElement['series']; content: ChartCopyContent } {
  const rows = grid.rows.map(() => ({ id: newId() }));
  const series = grid.series.map(() => ({ id: newId() }));
  const content: ChartCopyContent = {};
  grid.series.forEach((name, k) => name && (content[`${CHART_HEAD}:${series[k].id}`] = name));
  grid.rows.forEach((r, i) => {
    if (r.label) content[`${rows[i].id}:${CHART_LABEL}`] = r.label;
    r.values.forEach((v, k) => v && (content[`${rows[i].id}:${series[k].id}`] = v));
  });
  return { rows, series, content };
}

/** The default size of a new chart. */
export const CHART_SIZE = { w: 480, h: 320 } as const;
