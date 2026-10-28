import { Eraser, Scissors, Trash2 } from 'lucide-react';
import { defineTool, useCamera, usePointer, useToolOptions, type Editor, type Point } from '@engine';
import { eraseSweep, type EraserMode } from './lib/erase';
import './eraser.css';

const TOOL_ID = 'eraser';
/** Eraser radius in screen px for the S / M / L choices (constant on screen at any zoom). */
const RADII = [6, 12, 22] as const;
const LABELS = ['Small eraser', 'Medium eraser', 'Large eraser'] as const;
const MODES: Array<{ id: EraserMode; label: string; icon: typeof Scissors }> = [
  { id: 'partial', label: 'Erase parts of strokes', icon: Scissors },
  { id: 'stroke', label: 'Erase whole strokes', icon: Trash2 },
];

interface EraserOptions {
  size?: 0 | 1 | 2;
  mode?: EraserMode;
}

let last: Point | null = null;

function sweep(editor: Editor, from: Point, to: Point) {
  const opts = editor.getToolOptions<EraserOptions>(TOOL_ID);
  const r = RADII[opts.size ?? 1] / editor.getCamera().zoom;
  eraseSweep(editor, from, to, r, opts.mode ?? 'partial');
}

function EraserOptionsView({ editor }: { editor: Editor }) {
  const { size = 1, mode = 'partial' } = useToolOptions<EraserOptions>(TOOL_ID);
  return (
    <div className="fr-eraser-options">
      <div className="fr-eraser-row" role="group" aria-label="Eraser mode">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="fr-eraser-size"
            aria-pressed={mode === id}
            aria-label={label}
            title={label}
            onClick={() => editor.setToolOptions(TOOL_ID, { mode: id })}
          >
            <Icon size={16} strokeWidth={2} />
          </button>
        ))}
      </div>
      <div className="fr-eraser-row" role="group" aria-label="Eraser size">
        {RADII.map((r, i) => (
          <button
            key={r}
            type="button"
            className="fr-eraser-size"
            aria-pressed={size === i}
            aria-label={LABELS[i]}
            title={LABELS[i]}
            onClick={() => editor.setToolOptions(TOOL_ID, { size: i })}
          >
            <span style={{ width: 6 + i * 5, height: 6 + i * 5 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function EraserCursor() {
  const p = usePointer();
  const { zoom } = useCamera();
  const size = useToolOptions<EraserOptions>(TOOL_ID).size ?? 1;
  if (!p) return null;
  const r = RADII[size] / zoom;
  return (
    <div
      className="fr-eraser-cursor"
      style={{
        width: r * 2,
        height: r * 2,
        borderWidth: 1.5 / zoom,
        transform: `translate(${p.x - r}px, ${p.y - r}px)`,
      }}
    />
  );
}

export default defineTool({
  id: TOOL_ID,
  label: 'Eraser',
  icon: Eraser,
  shortcut: 'e',
  order: 52,
  placement: 'more',
  cursor: 'none',
  snapToGrid: false, // erases where the pointer is

  // The engine wraps pointer-down → up in one gesture, so a whole drag that cuts or erases many
  // strokes is a single undo step.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    last = point;
    sweep(editor, point, point);
  },

  onPointerMove({ editor, point }) {
    if (!last) return;
    sweep(editor, last, point);
    last = point;
  },

  onPointerUp() {
    last = null;
  },

  onCancel() {
    last = null;
  },

  Options: EraserOptionsView,
  Preview: EraserCursor,
});
