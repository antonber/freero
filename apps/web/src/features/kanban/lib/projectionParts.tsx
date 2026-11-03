// Pieces the calendar and timeline tabs share (step 3b): dates in words, a windowed list of cards
// (a day's "+N more", the cards without a date) and the dates popover — the way to set a card's
// dates without dragging (keyboard, phones).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { timelineLayout as T } from '@freero/shared';
import { Button, Popover } from '@ui';

const DAY_MS = 86_400_000;
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const longDay = fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const shortDay = fmt({ month: 'short', day: 'numeric' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const weekdayShort = fmt({ weekday: 'short' });

/** "Tuesday, November 4, 2026" (in this browser's language). */
export const dayWords = (day: number) => longDay.format(new Date(day * DAY_MS));
/** "Nov 4". */
export const dayShort = (day: number) => shortDay.format(new Date(day * DAY_MS));
/** "November 2026". */
export const monthWords = (day: number) => monthYear.format(new Date(day * DAY_MS));
/** "Mon" … "Sun" for the week of `monday`. */
export const weekdayNames = (monday: number) => Array.from({ length: 7 }, (_, i) => weekdayShort.format(new Date((monday + i) * DAY_MS)));
/** A day number's day of the month. */
export const dayOfMonth = (day: number) => new Date(day * DAY_MS).getUTCDate();
export const sameMonth = (a: number, b: number) => {
  const x = new Date(a * DAY_MS);
  const y = new Date(b * DAY_MS);
  return x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth();
};
export const { dayOf, isoOf } = T;
/** A value quoted for an attribute selector (ids are plain, but never trust that). */
export const attr = (v: string) => v.replace(/["\\]/g, '\\$&');

/**
 * A scrolling list of fixed-height rows that draws only the ones in view (thousands of cards
 * without a date cost what fits). `render(i)` draws row `i`.
 */
export function WindowedList({ count, rowH, render, className, label, maxHeight }: { count: number; rowH: number; render: (i: number) => ReactNode; className?: string; label: string; maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const viewH = h || maxHeight || 400;
  const first = Math.max(0, Math.floor(top / rowH) - 4);
  const last = Math.min(count - 1, Math.ceil((top + viewH) / rowH) + 4);
  const rows: ReactNode[] = [];
  for (let i = first; i <= last; i++)
    rows.push(
      <div key={i} role="listitem" className="fr-kanban-proj__row" style={{ top: i * rowH, height: rowH }}>
        {render(i)}
      </div>,
    );
  return (
    <div ref={ref} role="list" aria-label={label} className={`fr-kanban-proj__list${className ? ` ${className}` : ''}`} style={maxHeight ? { maxHeight } : undefined} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-fr-scrollable="">
      <div style={{ position: 'relative', height: count * rowH }}>{rows}</div>
    </div>
  );
}

/**
 * The dates popover: one date (a calendar's field) or a start and an end (a timeline's bar), typed
 * or picked, saved with Enter or Save; "No date" clears. The keyboard and touch way to move a card.
 */
export function DatesPopover({
  anchor,
  title,
  start,
  end,
  onSave,
  onClose,
}: {
  anchor: HTMLElement | null;
  title: string;
  /** The date (or the start), ISO or ''. */
  start: string;
  /** A timeline's end date, ISO or ''; undefined: one date. */
  end?: string;
  onSave: (start: string | null, end: string | null) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState(start);
  const [b, setB] = useState(end ?? '');
  const two = end !== undefined;
  const bad = two && !!a && !!b && b < a;
  const save = () => {
    if (bad) return;
    onSave(a || null, two ? b || null : null);
    onClose();
  };
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} side="bottom" align="start" width={260} aria-label={title} escapeToContent>
      <form
        className="fr-kanban-proj__dates"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <strong className="fr-kanban-proj__dates-title">{title}</strong>
        <label>
          <span>{two ? 'Start' : 'Date'}</span>
          <input type="date" autoFocus value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        {two && (
          <label>
            <span>End</span>
            <input type="date" value={b} aria-invalid={bad} onChange={(e) => setB(e.target.value)} />
          </label>
        )}
        {bad && <span className="fr-kanban-proj__dates-bad">The end can’t be before the start.</span>}
        <span className="fr-kanban-proj__dates-actions">
          <Button size="sm" variant="ghost" onClick={() => (onSave(null, null), onClose())}>
            No date
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={bad}>
            Save
          </Button>
        </span>
      </form>
    </Popover>
  );
}
