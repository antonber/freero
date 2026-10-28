import { Frame } from 'lucide-react';
import { defineTool, useToolGhost, useToolOptions, type Editor, type Point } from '@engine';
import { dragRect, PRESETS, presetById, TOOL_ID, type FramePreset } from './lib/frames';
import { createFrame, syncMembership } from './lib/actions';

interface FrameToolOptions {
  preset?: FramePreset;
}

/** Drags shorter than this (screen px) count as a click: drop a preset-sized frame. */
const CLICK_PX = 6;

let drag: { start: Point; startScreen: Point; id: string | null } | null = null;

const presetOf = (editor: Editor) => presetById(editor.getToolOptions<FrameToolOptions>(TOOL_ID).preset ?? '16:9');

function PresetIcon({ w, h }: { w: number; h: number }) {
  const k = 18 / Math.max(w, h);
  return (
    <span className="fr-frame-preset__icon" aria-hidden>
      <span style={{ width: Math.max(8, w * k), height: Math.max(8, h * k) }} />
    </span>
  );
}

export default defineTool({
  id: TOOL_ID,
  label: 'Frame',
  icon: Frame,
  shortcut: 'f',
  order: 50,
  placement: 'main',
  cursor: 'crosshair',

  onPointerDown({ point, screen, button }) {
    if (button !== 0) return;
    drag = { start: point, startScreen: screen, id: null };
  },

  // Drag to draw: the frame exists from the first move so collaborators see it grow. The engine
  // wraps pointer-down → pointer-up in one gesture, so create + resize + adopt is one undo step.
  onPointerMove({ editor, point, screen, shiftKey }) {
    if (!drag) return;
    if (!drag.id && Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < CLICK_PX) return;
    const p = presetOf(editor);
    const rect = dragRect(drag.start, point, shiftKey && p.id !== 'custom' ? p.w / p.h : null);
    if (!drag.id) drag.id = createFrame(editor, rect, shiftKey ? p.id : 'custom') || null;
    else editor.update(drag.id, rect);
  },

  onPointerUp({ editor, point }) {
    if (!drag) return;
    let id = drag.id;
    if (!id) {
      const p = presetOf(editor);
      id = createFrame(editor, { x: point.x - p.w / 2, y: point.y - p.h / 2, w: p.w, h: p.h }, p.id) || null;
    }
    drag = null;
    if (!id) return;
    syncMembership(editor, id);
    editor.select([id]);
    editor.setTool('select');
  },

  onCancel(editor) {
    if (drag?.id) editor.remove([drag.id]);
    drag = null;
  },

  Options: ({ editor }) => {
    const { preset = '16:9' } = useToolOptions<FrameToolOptions>(TOOL_ID);
    return (
      <div className="fr-frame-options">
        <div className="fr-frame-options__label">Frame size</div>
        <div className="fr-frame-options__grid" role="radiogroup" aria-label="Frame size">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              title={p.hint}
              className={`fr-frame-preset${preset === p.id ? ' is-active' : ''}`}
              onClick={() => editor.setToolOptions(TOOL_ID, { preset: p.id })}
            >
              <PresetIcon w={p.w} h={p.h} />
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );
  },

  // Ghost of the frame a click would create, centered on the cursor.
  Preview: () => {
    const { preset = '16:9' } = useToolOptions<FrameToolOptions>(TOOL_ID);
    const p = presetById(preset);
    const at = useToolGhost(p);
    if (!at || drag) return null;
    return (
      <div
        className="fr-frame-ghost"
        style={{ width: p.w, height: p.h, transform: `translate(${at.x}px, ${at.y}px)` }}
      />
    );
  },
});
