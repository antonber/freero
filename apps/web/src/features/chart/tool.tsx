import { BarChart3 } from 'lucide-react';
import { defineTool, useToolGhost } from '@engine';
import { placeChart } from './lib/data';
import { DATA_PANEL, TOOL_ID } from './lib/constants';

import { t } from './messages';
export default defineTool({
  id: TOOL_ID,
  label: t('chart'),
  icon: BarChart3,
  order: 59,
  placement: 'more',
  cursor: 'crosshair',
  // Click: a bar chart with example numbers centred there, its data grid open to type over them.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    editor.setTool('select');
    placeChart(editor, point);
    editor.openDock(DATA_PANEL);
  },
  Preview: () => {
    const p = useToolGhost({ w: 480, h: 320 });
    if (!p) return null;
    return <div className="fr-chart-ghost" style={{ width: 480, height: 320, transform: `translate(${p.x}px, ${p.y}px)` }} />;
  },
});
