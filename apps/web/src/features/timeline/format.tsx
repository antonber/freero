import { useRef, useState } from 'react';
import { CalendarRange, ChartGantt, Diamond, Plus } from 'lucide-react';
import type { TimelineBarElement, TimelineElement, TimelineScale } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, IconButton, Popover, SegmentedControl, ToolbarButton } from '@ui';
import { BAR_COLORS, addBar, addLane, patchBars, setRange, setScale, setView } from './lib/actions';
import { formatRange, isISODate } from './lib/dates';

const SCALES: Array<{ value: TimelineScale; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

/** Two date fields in a popover: a timeline's range, or a bar's dates. */
function DatesControl({ label, start, end, onChange, single }: { label: string; start: string; end: string; onChange: (p: { start?: string; end?: string }) => void; single?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ToolbarButton ref={ref} className="fr-timeline-fmt__btn" label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarRange size={16} />
        {formatRange(start, single ? start : end)}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={label}>
        <div className="fr-timeline-pop">
          <label className="fr-timeline-pop__label">
            {single ? 'Date' : 'Start'}
            <input type="date" value={start} max={single ? undefined : end} onChange={(e) => isISODate(e.target.value) && onChange(single ? { start: e.target.value, end: e.target.value } : { start: e.target.value })} />
          </label>
          {!single && (
            <label className="fr-timeline-pop__label">
              End
              <input type="date" value={end} min={start} onChange={(e) => isISODate(e.target.value) && onChange({ end: e.target.value })} />
            </label>
          )}
        </div>
      </Popover>
    </>
  );
}

function TimelineControls({ editor, t }: { editor: Editor; t: TimelineElement }) {
  return (
    <div className="fr-timeline-fmt">
      <SegmentedControl<'dates' | 'horizons'>
        size="sm"
        aria-label="View"
        value={t.view ?? 'dates'}
        options={[
          { value: 'dates', label: 'Dates' },
          { value: 'horizons', label: 'Now · Next · Later' },
        ]}
        onChange={(v) => setView(editor, t.id, v)}
      />
      <SegmentedControl<TimelineScale> size="sm" aria-label="Scale" value={t.scale} options={SCALES} onChange={(v) => setScale(editor, t.id, v)} />
      {t.view !== 'horizons' && <DatesControl label="Date range" start={t.start} end={t.end} onChange={(p) => setRange(editor, t.id, p)} />}
      <button type="button" className="fr-timeline-fmt__btn" onClick={() => addLane(editor, t.id)}>
        <Plus size={16} aria-hidden />
        Lane
      </button>
      <IconButton icon={ChartGantt} label="Add bar" size={32} onClick={() => addBar(editor, t.id)} />
      <IconButton icon={Diamond} label="Add milestone" size={32} onClick={() => addBar(editor, t.id, { milestone: true, color: BAR_COLORS[6] })} />
    </div>
  );
}

function BarColor({ editor, bars }: { editor: Editor; bars: TimelineBarElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color = bars.every((b) => b.color === bars[0].color) ? bars[0].color : null;
  return (
    <>
      <ToolbarButton ref={ref} className="fr-timeline-fmt__btn" label="Colour" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="fr-timeline-fmt__dot" style={{ background: color ?? 'conic-gradient(#5B3FF0, #1FA463, #F5A524, #E5484D, #5B3FF0)' }} />
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Bar colour">
        <ColorSwatches colors={BAR_COLORS} value={color} columns={5} size={26} allowCustom onChange={(c) => patchBars(editor, bars, { color: c })} aria-label="Bar colour" />
      </Popover>
    </>
  );
}

function BarControls({ editor, bars }: { editor: Editor; bars: TimelineBarElement[] }) {
  const one = bars.length === 1 ? bars[0] : null;
  const milestone = bars.every((b) => b.milestone);
  return (
    <div className="fr-timeline-fmt">
      {one && (
        <DatesControl
          label={one.milestone ? 'Date' : 'Dates'}
          single={!!one.milestone}
          start={one.start}
          end={one.end}
          onChange={(p) => {
            const start = p.start ?? one.start;
            const end = p.end ?? one.end;
            if (end >= start) patchBars(editor, [one], { start, end });
          }}
        />
      )}
      <BarColor editor={editor} bars={bars} />
      <IconButton
        icon={Diamond}
        label={milestone ? 'Make it a bar' : 'Make it a milestone'}
        size={32}
        active={milestone}
        onClick={() => editor.updateMany(bars.map((b) => ({ id: b.id, patch: (milestone ? { milestone: false } : { milestone: true, end: b.start }) as Partial<TimelineBarElement> })))}
      />
    </div>
  );
}

export default [
  defineFormat({
    id: 'timeline.format',
    order: 50,
    appliesTo: (selection) => selection.length === 1 && selection[0].type === 'timeline' && !selection[0].locked,
    Component: ({ editor, selection }) => <TimelineControls editor={editor} t={selection[0] as TimelineElement} />,
  }),
  defineFormat({
    id: 'timeline.barFormat',
    order: 10,
    appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'timelinebar'),
    Component: ({ editor, selection }) => <BarControls editor={editor} bars={selection as TimelineBarElement[]} />,
  }),
];
