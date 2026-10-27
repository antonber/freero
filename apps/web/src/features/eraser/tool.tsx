import { Eraser } from 'lucide-react';
import { defineTool, useCamera, usePointer, useToolOptions, type Editor, type Point } from '@engine';
import { sweepTouches } from './lib/sweep';
import './eraser.css';

const TOOL_ID = 'eraser';
/** Eraser radius in screen px for the S / M / L choices (constant on screen at any zoom). */
const RADII = [6, 12, 22] as const;
const LABELS = ['Small eraser', 'Medium eraser', 'Large eraser'] as const;

interface EraserOptions {
  size?: 0 | 1 | 2;
}

let last: Point | null = null;
const erased = new Set<string>();

function radiusPx(editor: Editor): number {
  return RADII[editor.getToolOptions<EraserOptions>(TOOL_ID).size ?? 1];
}

/** Deletes every unlocked pen stroke the sweep from → to touches (the pen says where its ink is). */
function sweep(editor: Editor, from: Point, to: Point) {
  const distanceTo = editor.getDefinition('pen')?.distanceTo;
  if (!distanceTo) return;
  const r = radiusPx(editor) / editor.getCamera().zoom;
  const box = {
    x: Math.min(from.x, to.x) - r,
    y: Math.min(from.y, to.y) - r,
    w: Math.abs(to.x - from.x) + 2 * r,
    h: Math.abs(to.y - from.y) + 2 * r,
  };
  const hits = editor
    .elementsInRect(box, 'intersect')
    .filter(
      (el) => el.type === 'pen' && !el.locked && !erased.has(el.id) && sweepTouches(distanceTo, el, from, to, r),
    )
    .map((el) => el.id);
  if (!hits.length) return;
  for (const id of hits) erased.add(id);
  editor.remove(hits);
}

function EraserOptionsView({ editor }: { editor: Editor }) {
  const size = useToolOptions<EraserOptions>(TOOL_ID).size ?? 1;
  return (
    <div className="fr-eraser-options" role="group" aria-label="Eraser size">
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

  // The engine wraps pointer-down → up in one gesture, so a whole drag that erases many
  // strokes is a single undo step.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    erased.clear();
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
    erased.clear();
  },

  onCancel() {
    last = null;
    erased.clear();
  },

  Options: EraserOptionsView,
  Preview: EraserCursor,
});
