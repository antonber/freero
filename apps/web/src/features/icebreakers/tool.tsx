import { Disc3 } from 'lucide-react';
import { defineTool, useToolGhost, useToolOptions } from '@engine';
import { SegmentedControl } from '@ui';
import { COLORS, KINDS, SIZE, STARTER_ENTRIES, TITLES, TOOL_ID, type Kind } from './lib/model';

import { t } from './messages';
interface Options {
  kind?: Kind;
}

export default defineTool({
  id: TOOL_ID,
  label: t('icebreakerWheelDiceSpeakingOrder'),
  icon: Disc3,
  order: 47,
  placement: 'more',
  cursor: 'crosshair',
  creates: ['icebreaker'],

  // Click places the widget picked in Options, centered on the cursor.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const kind = editor.getToolOptions<Options>(TOOL_ID).kind ?? 'wheel';
    const { w, h } = SIZE[kind];
    editor.create<'icebreaker'>(
      {
        type: 'icebreaker',
        x: Math.round(point.x - w / 2),
        y: Math.round(point.y - h / 2),
        w,
        h,
        kind,
        title: TITLES[kind],
        entries: kind === 'dice' ? [] : STARTER_ENTRIES,
        dice: 2,
        color: COLORS[KINDS.findIndex((k) => k.value === kind)],
      },
      { select: true },
    );
    editor.setTool('select');
  },

  Options: ({ editor }) => {
    const { kind = 'wheel' } = useToolOptions<Options>(TOOL_ID);
    return (
      <div style={{ padding: 8 }}>
        <SegmentedControl<Kind> aria-label={t('icebreaker')} size="sm" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={(k) => editor.setToolOptions(TOOL_ID, { kind: k })} />
      </div>
    );
  },

  Preview: () => {
    const { kind = 'wheel' } = useToolOptions<Options>(TOOL_ID);
    const { w, h } = SIZE[kind];
    const p = useToolGhost({ w, h });
    if (!p) return null;
    return <div className="fr-icebreaker-ghost" style={{ width: w, height: h, transform: `translate(${p.x}px, ${p.y}px)` }} />;
  },
});
