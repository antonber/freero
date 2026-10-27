import { useSyncExternalStore } from 'react';
import { Shapes } from 'lucide-react';
import type { ShapeKind } from '@freero/shared';
import { defineTool, usePointer, useToolOptions, type Editor, type Point } from '@engine';
import { CLICK_SLOP_PX, DEFAULT_SIZE, SHAPE_KINDS, TOOL_ID, type ShapeToolOptions } from './lib/constants';
import { currentKind, shapeInRect } from './lib/actions';
import { dragRect, insetPaths } from './lib/geometry';
import { ShapeIcon } from './lib/ShapeIcon';

// Drag state for the current press. Module-level is fine: one pointer gesture at a time.
let drag: { start: Point; screen: Point; kind: ShapeKind; id: string | null } | null = null;
const listeners = new Set<() => void>();
function setDrag(next: typeof drag) {
  drag = next;
  for (const l of [...listeners]) l();
}
const useDragging = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => !!drag?.id,
  );

function finish(editor: Editor, id: string, edit: boolean) {
  editor.select([id]);
  editor.setTool('select');
  if (edit) editor.startEditing(id);
}

export default defineTool({
  id: TOOL_ID,
  label: 'Shapes',
  icon: Shapes,
  shortcut: 's',
  order: 30,
  placement: 'main',
  cursor: 'crosshair',

  // Press → drag creates the shape on the first real movement and resizes it while you drag
  // (Shift = 1:1). The engine wraps down → up in one gesture, so it is a single undo step.
  onPointerDown({ editor, point, screen, button }) {
    if (button !== 0) return;
    setDrag({ start: point, screen, kind: currentKind(editor), id: null });
  },

  // Hover moves arrive with no press in progress (drag === null); during a drag `button` is -1
  // too (pointermove carries no button change), so the drag state is what tells them apart.
  onPointerMove({ editor, point, screen, shiftKey }) {
    if (!drag) return;
    if (!drag.id && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < CLICK_SLOP_PX) return;
    const r = dragRect(drag.start, point, shiftKey);
    const box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    if (!drag.id) setDrag({ ...drag, id: editor.create(shapeInRect(editor, drag.kind, box)) || null });
    else editor.update(drag.id, box);
  },

  onPointerUp({ editor, point }) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.id) {
      const el = editor.getElement(d.id);
      // A tiny accidental drag becomes a normal-size shape rather than a speck.
      if (el && el.w < 8 && el.h < 8) editor.update(d.id, { w: DEFAULT_SIZE, h: DEFAULT_SIZE });
      finish(editor, d.id, false);
      return;
    }
    // Plain click: a default-size shape centered on the cursor, ready for typing.
    const half = DEFAULT_SIZE / 2;
    const id = editor.create(shapeInRect(editor, d.kind, { x: point.x - half, y: point.y - half, w: DEFAULT_SIZE, h: DEFAULT_SIZE }));
    if (id) finish(editor, id, true);
  },

  onCancel(editor) {
    if (drag?.id) editor.remove([drag.id]);
    setDrag(null);
  },

  onDeactivate() {
    setDrag(null);
  },

  Options: ({ editor }) => {
    const { kind = 'rect' } = useToolOptions<ShapeToolOptions>(TOOL_ID);
    return (
      <div className="fr-shape-picker" role="radiogroup" aria-label="Shape">
        {SHAPE_KINDS.map((s) => (
          <button
            key={s.kind}
            type="button"
            role="radio"
            aria-checked={s.kind === kind}
            aria-label={s.label}
            title={s.label}
            className={`fr-shape-picker__item${s.kind === kind ? ' is-active' : ''}`}
            onClick={() => editor.setToolOptions(TOOL_ID, { kind: s.kind })}
          >
            <ShapeIcon kind={s.kind} size={22} />
          </button>
        ))}
      </div>
    );
  },

  // Ghost of the armed shape under the cursor; hidden once a drag has created the real one.
  Preview: () => {
    const p = usePointer();
    const dragging = useDragging();
    const { kind = 'rect' } = useToolOptions<ShapeToolOptions>(TOOL_ID);
    if (!p || dragging) return null;
    const s = DEFAULT_SIZE;
    const paths = insetPaths(kind, s, s, 2);
    return (
      <svg
        className="fr-shape-ghost"
        width={s}
        height={s}
        style={{ transform: `translate(${p.x - s / 2}px, ${p.y - s / 2}px)` }}
        aria-hidden
      >
        <path d={paths.outline} />
        {paths.details && <path d={paths.details} fill="none" />}
      </svg>
    );
  },
});
