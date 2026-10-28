import { ChartColumn } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ActivityKind } from '@freero/shared';
import { defineTool, plainToRichText, useToolGhost, useToolOptions } from '@engine';
import { SegmentedControl } from '@ui';
import { ACCENTS, ACTIVITY_H, ACTIVITY_W, KINDS, TOOL_ID, starter } from './lib/activity';

interface Options {
  kind?: ActivityKind;
}

export default defineTool({
  id: TOOL_ID,
  label: 'Live activity',
  icon: ChartColumn,
  order: 46,
  placement: 'more',
  cursor: 'crosshair',
  creates: ['activity'],

  // Click places a poll (or the kind picked in Options) centered on the cursor, question ready to type.
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const kind = editor.getToolOptions<Options>(TOOL_ID).kind ?? 'poll';
    const { question, options } = starter(kind, () => nanoid(8));
    const id = editor.create<'activity'>(
      {
        type: 'activity',
        x: point.x - ACTIVITY_W / 2,
        y: point.y - ACTIVITY_H / 2,
        w: ACTIVITY_W,
        h: ACTIVITY_H,
        kind,
        question: plainToRichText(question),
        options,
        maxChoices: 1,
        scale: 5,
        anonymous: true,
        results: 'live',
        guests: true,
        closed: false,
        color: ACCENTS[KINDS.findIndex((k) => k.value === kind) % ACCENTS.length],
      },
      { select: true },
    );
    editor.setTool('select');
    if (id) editor.startEditing(id);
  },

  Options: ({ editor }) => {
    const { kind = 'poll' } = useToolOptions<Options>(TOOL_ID);
    return (
      <div style={{ padding: 8 }}>
        <SegmentedControl<ActivityKind>
          aria-label="Activity kind"
          size="sm"
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
          value={kind}
          onChange={(k) => editor.setToolOptions(TOOL_ID, { kind: k })}
        />
      </div>
    );
  },

  Preview: () => {
    const p = useToolGhost({ w: ACTIVITY_W, h: ACTIVITY_H });
    if (!p) return null;
    return (
      <div
        style={{
          position: 'absolute',
          width: ACTIVITY_W,
          height: ACTIVITY_H,
          transform: `translate(${p.x}px, ${p.y}px)`,
          border: '2px dashed var(--fr-primary)',
          borderRadius: 14,
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
    );
  },
});
