import { useSyncExternalStore } from 'react';
import { Type } from 'lucide-react';
import { defineTool, usePointer, type Editor, type Point } from '@engine';
import { CLICK_SLOP_PX, DEFAULT_FONT_SIZE, TOOL_ID } from './lib/constants';
import { textAtCaret } from './lib/actions';
import { textPadding } from './lib/layout';

// The width being dragged out (world rect), shown by the Preview; module-level because only
// one pointer gesture runs at a time.
let drag: { start: Point; screen: Point; cur: Point | null } | null = null;
const listeners = new Set<() => void>();
function setDrag(next: typeof drag) {
  drag = next;
  for (const l of [...listeners]) l();
}
const useDrag = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => drag,
  );

function place(editor: Editor, id: string) {
  editor.setTool('select');
  if (id) editor.startEditing(id);
}

export default defineTool({
  id: TOOL_ID,
  label: 'Text',
  icon: Type,
  shortcut: 't',
  order: 20,
  placement: 'main',
  cursor: 'text',

  onPointerDown({ editor, point, screen, button, target }) {
    if (button !== 0) return;
    // Clicking an existing text box with the Text tool edits it instead of stacking a new one.
    if (target?.type === 'text' && !target.locked) {
      editor.select([target.id]);
      place(editor, target.id);
      return;
    }
    setDrag({ start: point, screen, cur: null });
  },

  onPointerMove({ point, screen }) {
    if (!drag) return;
    if (!drag.cur && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < CLICK_SLOP_PX) return;
    setDrag({ ...drag, cur: point });
  },

  // Click: an auto-width box with the caret where you clicked. Drag: a fixed-width box as wide
  // as the drag, text wraps inside it.
  onPointerUp({ editor }) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.cur && Math.abs(d.cur.x - d.start.x) >= 16) {
      const x = Math.min(d.start.x, d.cur.x);
      const w = Math.abs(d.cur.x - d.start.x);
      const pad = textPadding(DEFAULT_FONT_SIZE);
      const id = editor.create<'text'>(
        { ...textAtCaret({ x: x + pad, y: Math.min(d.start.y, d.cur.y) + pad + (DEFAULT_FONT_SIZE * 1.3) / 2 }), autoWidth: false, w: Math.round(w) },
        { select: true },
      );
      place(editor, id);
      return;
    }
    place(editor, editor.create(textAtCaret(d.start), { select: true }));
  },

  onCancel() {
    setDrag(null);
  },

  onDeactivate() {
    setDrag(null);
  },

  Preview: () => {
    const p = usePointer();
    const d = useDrag();
    if (d?.cur) {
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      const h = Math.ceil(DEFAULT_FONT_SIZE * 1.3 + textPadding(DEFAULT_FONT_SIZE) * 2);
      return (
        <div
          className="fr-textbox-dragbox"
          style={{ width: Math.abs(d.cur.x - d.start.x), height: Math.max(h, Math.abs(d.cur.y - d.start.y)), transform: `translate(${x}px, ${y}px)` }}
        />
      );
    }
    if (!p || d) return null;
    const lh = DEFAULT_FONT_SIZE * 1.3;
    return (
      <div className="fr-textbox-ghost" style={{ height: lh, fontSize: DEFAULT_FONT_SIZE, transform: `translate(${p.x - 1}px, ${p.y - lh / 2}px)` }}>
        <span className="fr-textbox-ghost__caret" style={{ height: lh }} />
        <span className="fr-textbox-ghost__label">Text</span>
      </div>
    );
  },
});
