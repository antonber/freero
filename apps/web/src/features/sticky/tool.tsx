import { StickyNote } from 'lucide-react';
import { STICKY_COLORS } from '@freero/shared';
import { defineTool, useToolGhost, useToolOptions } from '@engine';
import { ColorSwatches, Toggle } from '@ui';
import { COLOR_HEX, COLOR_NAMES, DEFAULT_COLOR, STICKY_SIZE, TOOL_ID, colorFromHex, toolDims, type StickyToolOptions } from './lib/constants';
import { stickyAt } from './lib/actions';
import { BoxControl } from './lib/BoxControl';
import { PAD_STACK } from './lib/pad';

import { t } from './messages';
/** A new sticky pad's box (#132): a medium sticky with the stack under it. */
const PAD_SIZE = STICKY_SIZE + PAD_STACK;

export default defineTool({
  id: TOOL_ID,
  label: t('stickyNote'),
  icon: StickyNote,
  shortcut: 'n',
  order: 10,
  placement: 'main',
  cursor: 'crosshair',

  // Click places a sticky centered on the cursor and starts typing into it. The engine wraps
  // pointer-down → pointer-up in one gesture and the edit session joins it, so "place + type"
  // is a single undo step. With "Sticky pad" on, it places a pad to peel stickies from.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const opts = editor.getToolOptions<StickyToolOptions>(TOOL_ID);
    if (opts.pad) {
      editor.create<'stickypad'>(
        { type: 'stickypad', x: Math.round(point.x - PAD_SIZE / 2), y: Math.round(point.y - PAD_SIZE / 2), w: PAD_SIZE, h: PAD_SIZE, color: opts.color ?? DEFAULT_COLOR },
        { select: true },
      );
      editor.setTool('select');
      return;
    }
    const id = editor.create(stickyAt(editor, point), { select: true });
    editor.setTool('select');
    if (id) editor.startEditing(id);
  },

  Options: ({ editor }) => {
    const { color = DEFAULT_COLOR, shape = 'square', size = 'm', pad = false } = useToolOptions<StickyToolOptions>(TOOL_ID);
    return (
      <div className="fr-sticky-options">
        <div className="fr-sticky-options__label">{t('stickyColor')}</div>
        <ColorSwatches
          colors={COLOR_HEX}
          names={COLOR_NAMES}
          value={STICKY_COLORS[color]}
          onChange={(hex) => editor.setToolOptions(TOOL_ID, { color: colorFromHex(hex) })}
          columns={6}
          size={24}
          aria-label={t('stickyColor')}
        />
        {pad ? null : (
          <>
            <div className="fr-sticky-options__label">{t('shapeAndSize')}</div>
            <BoxControl
              shape={shape}
              size={size}
              onShape={(next) => editor.setToolOptions(TOOL_ID, { shape: next })}
              onSize={(next) => editor.setToolOptions(TOOL_ID, { size: next })}
            />
          </>
        )}
        {editor.mayAdd('stickypad') ? (
          <Toggle size="sm" label={t('placeAStickyPad')} checked={pad} onChange={(on) => editor.setToolOptions(TOOL_ID, { pad: on })} />
        ) : null}
      </div>
    );
  },

  // Ghost sticky (or pad) following the cursor (world space).
  Preview: () => {
    const opts = useToolOptions<StickyToolOptions>(TOOL_ID);
    const { w, h } = opts.pad ? { w: PAD_SIZE, h: PAD_SIZE } : toolDims(opts);
    const p = useToolGhost({ w, h });
    const color = opts.color ?? DEFAULT_COLOR;
    if (!p) return null;
    return (
      <div
        className={`fr-sticky-ghost${opts.pad ? ' is-pad' : ''}`}
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
