// How charts read in the board outline: their data grid as rows (series names first), so an
// assistant reading the board sees the numbers, not just "a chart". Cells live in `chartCells`
// (@freero/shared charts.ts), read here only for charts the reader can see.
import { CHART_CELLS, CHART_HEAD, CHART_LABEL, chartCellKey, defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    chart: (el, ctx) => {
      const cells = ctx.collection<string>(CHART_CELLS);
      const cell = (r: string, c: string) => ctx.plain(cells.get(chartCellKey(el.id, r, c)) ?? '');
      const rows = [
        ['', ...el.series.map((s) => cell(CHART_HEAD, s.id))],
        ...el.rows.map((r) => [cell(r.id, CHART_LABEL), ...el.series.map((s) => cell(r.id, s.id))]),
      ];
      return {
        ...(el.title ? { text: el.title } : {}),
        variant: el.kind,
        rows,
        standalone: true,
        fields: { size: `${el.rows.length}×${el.series.length}` },
      };
    },
  },
});
