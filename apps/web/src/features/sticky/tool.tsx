import { StickyNote } from 'lucide-react';
import { STICKY_COLORS } from '@freero/shared';
import { defineTool, useToolGhost, useToolOptions } from '@engine';
import { ColorSwatches } from '@ui';
import { COLOR_HEX, COLOR_NAMES, DEFAULT_COLOR, TOOL_ID, colorFromHex, toolDims, type StickyToolOptions } from './lib/constants';
import { stickyAt } from './lib/actions';
import { BoxControl } from './lib/BoxControl';

export default defineTool({
  id: TOOL_ID,
  label: 'Sticky note',
  icon: StickyNote,
  shortcut: 'n',
  order: 10,
  placement: 'main',
  cursor: 'crosshair',

  // Click places a sticky centered on the cursor and starts typing into it. The engine wraps
  // pointer-down → pointer-up in one gesture and the edit session joins it, so "place + type"
  // is a single undo step.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const id = editor.create(stickyAt(editor, point), { select: true });
    editor.setTool('select');
    if (id) editor.startEditing(id);
  },

  Options: ({ editor }) => {
    const { color = DEFAULT_COLOR, shape = 'square', size = 'm' } = useToolOptions<StickyToolOptions>(TOOL_ID);
    return (
      <div className="fr-sticky-options">
        <div className="fr-sticky-options__label">Sticky color</div>
        <ColorSwatches
          colors={COLOR_HEX}
          names={COLOR_NAMES}
          value={STICKY_COLORS[color]}
          onChange={(hex) => editor.setToolOptions(TOOL_ID, { color: colorFromHex(hex) })}
          columns={6}
          size={24}
          aria-label="Sticky color"
        />
        <div className="fr-sticky-options__label">Shape and size</div>
        <BoxControl
          shape={shape}
          size={size}
          onShape={(next) => editor.setToolOptions(TOOL_ID, { shape: next })}
          onSize={(next) => editor.setToolOptions(TOOL_ID, { size: next })}
        />
      </div>
    );
  },

  // Ghost sticky following the cursor (world space).
  Preview: () => {
    const opts = useToolOptions<StickyToolOptions>(TOOL_ID);
    const { w, h } = toolDims(opts);
    const p = useToolGhost({ w, h });
    const color = opts.color ?? DEFAULT_COLOR;
    if (!p) return null;
    return (
      <div
        className="fr-sticky-ghost"
        style={{
          width: w,
          height: h,
          background: STICKY_COLORS[color],
          transform: `translate(${p.x}px, ${p.y}px)`,
        }}
      />
    );
  },
});
