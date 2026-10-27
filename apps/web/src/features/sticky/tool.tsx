import { StickyNote } from 'lucide-react';
import { STICKY_COLORS } from '@freero/shared';
import { defineTool, usePointer, useToolOptions } from '@engine';
import { ColorSwatches } from '@ui';
import { COLOR_HEX, COLOR_NAMES, DEFAULT_COLOR, STICKY_SIZE, TOOL_ID, colorFromHex, type StickyToolOptions } from './lib/constants';
import { stickyAt } from './lib/actions';

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
    const { color = DEFAULT_COLOR } = useToolOptions<StickyToolOptions>(TOOL_ID);
    return (
      <div className="fr-sticky-options">
        <div className="fr-sticky-options__label">Sticky color</div>
        <ColorSwatches
          colors={COLOR_HEX}
          names={COLOR_NAMES}
          value={STICKY_COLORS[color]}
          onChange={(hex) => editor.setToolOptions(TOOL_ID, { color: colorFromHex(hex) })}
          columns={4}
          size={26}
          aria-label="Sticky color"
        />
      </div>
    );
  },

  // Ghost sticky following the cursor (world space).
  Preview: () => {
    const p = usePointer();
    const { color = DEFAULT_COLOR } = useToolOptions<StickyToolOptions>(TOOL_ID);
    if (!p) return null;
    return (
      <div
        className="fr-sticky-ghost"
        style={{
          width: STICKY_SIZE,
          height: STICKY_SIZE,
          background: STICKY_COLORS[color],
          transform: `translate(${p.x - STICKY_SIZE / 2}px, ${p.y - STICKY_SIZE / 2}px)`,
        }}
      />
    );
  },
});
