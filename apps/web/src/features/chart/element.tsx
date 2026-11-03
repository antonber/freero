import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { readChart, type ChartElement } from '@freero/shared';
import { defineElement, useCollection, type ElementRenderProps, type NewElement } from '@engine';
import { CELLS, gridRows, readContent, writeContent } from './lib/data';
import { ChartView } from './lib/ChartView';
import { DATA_PANEL } from './lib/constants';
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

export default defineElement({
  type: 'chart',
  label: { one: 'Chart', many: 'Charts' },
  icon: BarChart3,
  resize: 'free',
  minSize: { w: 160, h: 120 },
  defaults: (): Omit<NewElement<'chart'>, 'x' | 'y'> => ({ type: 'chart', kind: 'bar', title: '', rows: [{ id: 'r1' }], series: [{ id: 's1' }], w: 480, h: 320 }),
  Component: ChartItem,
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
