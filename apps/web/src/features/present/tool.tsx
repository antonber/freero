import { Zap } from 'lucide-react';
import { defineTool } from '@engine';
import { laserAt, laserOff } from './lib/session';

// Laser pointer (KAI-130): move the pointer and a fading trail shows on everyone's screen. It is
// presence only (lib/laser.ts): nothing is written to the board or to anyone's undo history, so
// viewers may point too. While presenting, L toggles the same pointer (panel.tsx).
export default defineTool({
  id: 'laser',
  label: 'Laser pointer',
  icon: Zap,
  shortcut: 'k',
  order: 96,
  placement: 'more',
  minRole: 'viewer',
  snapToGrid: false,
  cursor: 'crosshair',
  onPointerDown: (e) => laserAt(e.editor, e.point),
  onPointerMove: (e) => laserAt(e.editor, e.point),
  onDeactivate: (editor) => laserOff(editor),
});
