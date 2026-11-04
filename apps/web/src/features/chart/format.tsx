import { AreaChart, BarChart3, ChartColumnStacked, ChartPie, LineChart, Table2 } from 'lucide-react';
import type { ChartElement, ChartKind } from '@freero/shared';
import { defineFormat } from '@engine';
import { ToolbarButton } from '@ui';
import { DATA_PANEL } from './lib/constants';

const KINDS: Array<{ kind: ChartKind; label: string; Icon: typeof BarChart3 }> = [
  { kind: 'bar', label: 'Bar chart', Icon: BarChart3 },
  { kind: 'stackedBar', label: 'Stacked bars', Icon: ChartColumnStacked },
  { kind: 'line', label: 'Line chart', Icon: LineChart },
  { kind: 'area', label: 'Area chart', Icon: AreaChart },
  { kind: 'pie', label: 'Pie chart (first series)', Icon: ChartPie },
];

export default defineFormat({
  id: 'chart.format',
  order: 50,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'chart'),
  Component: ({ editor, selection }) => {
    const charts = selection as ChartElement[];
    const kind = charts.every((c) => c.kind === charts[0].kind) ? charts[0].kind : null;
    return (
      <>
        {KINDS.map(({ kind: k, label, Icon }) => (
          <ToolbarButton
            key={k}
            label={label}
            aria-pressed={kind === k}
            className={kind === k ? 'is-active' : undefined}
            onClick={() => editor.transact(() => charts.forEach((c) => editor.update<ChartElement>(c.id, { kind: k })))}
          >
            <Icon size={17} />
          </ToolbarButton>
        ))}
        {charts.length === 1 && (
          <ToolbarButton label="Edit data" wide onClick={() => editor.openDock(DATA_PANEL)}>
            <Table2 size={16} />
            <span>Data</span>
          </ToolbarButton>
        )}
      </>
    );
  },
});
