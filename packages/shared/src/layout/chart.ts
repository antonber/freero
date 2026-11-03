// A chart from rows of cells (#137): the structure the MCP add_diagram `chart` and the board API
// insert. The cells go where the chart feature keeps them (`content`, charts.ts ChartCopyContent).
import { CHART_SIZE, ChartDataError, chartFromGrid, chartGridFromRows } from '../charts';
import type { ChartKind } from '../elements';
import { LayoutError, type ElementDraft, type LaidOut, type LayoutContext } from './types';

export function layoutChart(rows: string[][], kind: ChartKind, title: string, ctx: LayoutContext): LaidOut {
  let grid;
  try {
    grid = chartGridFromRows(rows);
  } catch (e) {
    if (e instanceof ChartDataError) throw new LayoutError(e.message);
    throw e;
  }
  const id = ctx.newId();
  const made = chartFromGrid(grid, ctx.newId);
  // Wider for many categories, so their labels stay readable.
  const w = Math.max(CHART_SIZE.w, Math.min(1200, 120 + made.rows.length * (kind === 'pie' ? 0 : 56)));
  const el: ElementDraft = {
    id,
    type: 'chart',
    x: 0,
    y: 0,
    w,
    h: CHART_SIZE.h,
    rotation: 0,
    kind,
    title: title.trim().slice(0, 200),
    rows: made.rows,
    series: made.series,
  };
  return { elements: [el], content: { [id]: made.content }, moves: [], size: { w, h: CHART_SIZE.h } };
}
