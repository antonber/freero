import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { CHART_COLORS, readChart, type ChartElement } from '@freero/shared';
import { defineElement, useCollection, type ElementRenderProps, type LowDetailPaint, type NewElement } from '@engine';
import { CELLS, gridRows, readContent, writeContent } from './lib/data';
import { ChartView } from './lib/ChartView';
import { DATA_PANEL } from './lib/constants';
import { t } from './messages';
import './chart.css';

const ChartItem = memo(function ChartItem({ element }: ElementRenderProps<ChartElement>) {
  const entries = useCollection<string>(CELLS);
  const data = useMemo(() => {
    const map = new Map(entries);
    return readChart(element, (k) => map.get(k));
  }, [entries, element]);
  return (
    <div className="fr-chart">
      <ChartView kind={element.kind} title={element.title} data={data} w={element.w} h={element.h} legend={element.legend} />
    </div>
  );
});

/**
 * Zoomed out to low detail (#131): the chart's plot area, washed with its first series' colour,
 * and its axes in the default ink (light on a dark page) — the data itself is in a collection and
 * unreadable at this size anyway.
 */
function paintChart(el: ChartElement, p: LowDetailPaint) {
  const top = el.title ? 26 : 6;
  const x0 = el.w * 0.08;
  const y1 = el.h - 20;
  if (y1 <= top) return;
  p.rect(x0, top, el.w - x0, y1 - top, el.series[0]?.color || CHART_COLORS[0], 0.18);
  p.line([{ x: x0, y: top }, { x: x0, y: y1 }, { x: el.w, y: y1 }], p.ink('#17162B'), 2);
}

export default defineElement({
  type: 'chart',
  label: { one: t('chart'), many: t('charts') },
  icon: BarChart3,
  resize: 'free',
  minSize: { w: 160, h: 120 },
  defaults: (): Omit<NewElement<'chart'>, 'x' | 'y'> => ({ type: 'chart', kind: 'bar', title: '', rows: [{ id: 'r1' }], series: [{ id: 's1' }], w: 480, h: 320 }),
  Component: ChartItem,
  lowDetail: paintChart,
  swatch: () => '#5B3FF0',
  toPlainText(el, editor) {
    const rows = gridRows(editor.collection<string>(CELLS), el);
    return [el.title, ...rows.slice(1).map((r) => r.filter(Boolean).join(' '))].filter(Boolean).join('\n');
  },
  // The data lives in chartCells: copies take theirs along (duplicate, Alt-drag, paste, templates).
  copyContent: (el, editor) => readContent(editor, el),
  pasteContent: (el, content, editor) => writeContent(editor, el.id, content as Record<string, string>),
  // Double-click opens the data grid beside the board.
  onDoubleClick(_el, { editor }) {
    editor.openDock(DATA_PANEL);
  },
});
