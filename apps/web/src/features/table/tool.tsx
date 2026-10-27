import { Table2 } from 'lucide-react';
import { defineTool, usePointer } from '@engine';
import { COL_W, ROW_H } from './lib/model';
import { placeTable } from './lib/actions';

export default defineTool({
  id: 'table',
  label: 'Table',
  icon: Table2,
  order: 58,
  placement: 'more',
  cursor: 'crosshair',
  // Click: a 3 × 3 table (header row on) centered there, typing in its first cell. The engine
  // wraps the click and the edit session that follows in one undo step.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    editor.setTool('select');
    placeTable(editor, point);
  },
  Preview: () => {
    const p = usePointer();
    if (!p) return null;
    const w = COL_W * 3;
    const h = ROW_H * 3;
    return <div className="fr-table-ghost" style={{ width: w, height: h, transform: `translate(${p.x - w / 2}px, ${p.y - h / 2}px)` }} />;
  },
});
