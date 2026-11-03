// Where a kanban's calendar and timeline tabs put its cards (docs/design/kanban-fields-and-views.md,
// step 3b), and what moving a card there writes. Dates are the truth, as on the timeline element:
// a card sits on the day its date field says and a bar spans its start to its end date; a drag or
// a key press is read back as whole days and written through card.setValues (the card feature's
// one write path), never as geometry. The day arithmetic is the timeline element's
// (`layout/timeline.ts`: day numbers in UTC, ISO dates without a time zone), shared so a calendar,
// a timeline tab and the timeline element agree on what a day is.
//
// Pure: the kanban feature draws with it; the server's query_cards orders a calendar or timeline
// tab's cards by it.
import type { CardElement, KanbanElement } from './elements';
import { cardValue, type FieldDef } from './fields';
import { addDays, dayOf, isISODate, isoOf, mondayOf } from './layout/timeline';

/** Card `card`'s date for field `ref` ('$due', '$start' or a date field of the kanban), or null. */
export function cardDate(k: KanbanElement, card: CardElement, ref: string, schema: readonly FieldDef[]): string | null {
  const v = ref === '$due' ? card.dueDate : ref === '$start' ? card.startDate : (() => {
    const f = schema.find((x) => x.id === ref && x.type === 'date');
    return f ? cardValue(k, card, f) : null;
  })();
  return isISODate(v) ? v : null;
}

// ------------------------------------------------------------------ calendar

/** A calendar's cards by day (ISO date → cards, in the order given) and the ones without a date. */
export interface CalendarDays {
  days: Map<string, CardElement[]>;
  undated: CardElement[];
}

/** Cards `rows` (already filtered and ordered) placed on their `ref` date. */
export function calendarDays(k: KanbanElement, rows: readonly CardElement[], ref: string, schema: readonly FieldDef[]): CalendarDays {
  const days = new Map<string, CardElement[]>();
  const undated: CardElement[] = [];
  for (const c of rows) {
    const d = cardDate(k, c, ref, schema);
    if (!d) {
      undated.push(c);
      continue;
    }
    const list = days.get(d);
    if (list) list.push(c);
    else days.set(d, [c]);
  }
  return { days, undated };
}

/** The weeks (Monday first, day numbers) a month grid shows for the month holding `day`: every week that has one of its days. */
export function monthWeeks(day: number): number[][] {
  const d = new Date(day * 86_400_000);
  const first = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86_400_000);
  const last = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86_400_000) - 1;
  const weeks: number[][] = [];
  for (let w = mondayOf(first); w <= last; w += 7) weeks.push(Array.from({ length: 7 }, (_, i) => w + i));
  return weeks;
}

/** The first day of the month `n` months from the one holding `day` (day number). */
export function monthStart(day: number, n = 0): number {
  const d = new Date(day * 86_400_000);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / 86_400_000);
}

/**
 * What putting card `card` on day `to` (null: no date) of a calendar placed by `ref` writes, as
 * card.setValues values; null when nothing would change. A card has one start and one due date and
 * a start after the due date can't be: when the move would make it so, the other date moves by
 * the same days (the card keeps its length) instead of the move being refused.
 */
export function calendarMoveValues(k: KanbanElement, card: CardElement, ref: string, to: string | null, schema: readonly FieldDef[]): Record<string, string | null> | null {
  const from = cardDate(k, card, ref, schema);
  if (from === to) return null;
  const out: Record<string, string | null> = { [ref]: to };
  if (to && (ref === '$due' || ref === '$start')) {
    const other = ref === '$due' ? '$start' : '$due';
    const o = cardDate(k, card, other, schema);
    const inverted = o && (ref === '$due' ? o > to : o < to);
    if (inverted) out[other] = from ? addDays(o, dayOf(to) - dayOf(from)) : to;
  }
  return out;
}

// ------------------------------------------------------------------ timeline

/** A bar: its first and last day (day numbers, inclusive). */
export interface DaySpan {
  start: number;
  end: number;
}

/**
 * Card `card`'s bar on a timeline from `startRef` to `endRef`: its two dates; one of them alone is
 * a one-day bar; a start after the end reads from the earlier to the later. Null: no date.
 */
export function barSpanOf(k: KanbanElement, card: CardElement, startRef: string, endRef: string, schema: readonly FieldDef[]): DaySpan | null {
  const s = cardDate(k, card, startRef, schema);
  const e = cardDate(k, card, endRef, schema);
  if (!s && !e) return null;
  const a = dayOf(s ?? e!);
  const b = dayOf(e ?? s!);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export type BarEdit = 'move' | 'start' | 'end';

/** Bar `span` moved (both ends) or resized (one end, never past the other) by `days`. */
export function editBar(span: DaySpan, edit: BarEdit, days: number): DaySpan {
  if (edit === 'move') return { start: span.start + days, end: span.end + days };
  if (edit === 'start') return { start: Math.min(span.end, span.start + days), end: span.end };
  return { start: span.start, end: Math.max(span.start, span.end + days) };
}

/**
 * What bar `span` writes, as card.setValues values: both of its dates, so the card becomes the bar
 * as drawn (a one-day bar of a card with only a due date gains its start when resized). A timeline
 * whose start and end are one field writes that field.
 */
export function spanValues(startRef: string, endRef: string, span: DaySpan): Record<string, string> {
  if (startRef === endRef) return { [startRef]: isoOf(span.start) };
  return { [startRef]: isoOf(span.start), [endRef]: isoOf(span.end) };
}

/** The days a timeline tab shows: from the Monday a week before its first bar (or today) to three weeks after its last, at most `maxDays`. */
export function timelineRange(spans: Iterable<DaySpan>, today: number, maxDays = 1500): DaySpan {
  let lo = today;
  let hi = today;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  // Too long to draw whole: from a third of it before today (the past matters less).
  const start = mondayOf(hi + 21 - lo > maxDays ? Math.max(lo - 7, today - Math.floor(maxDays / 3)) : lo - 7);
  const end = Math.min(hi + 21, start + maxDays - 1);
  return { start, end: Math.max(end, start + 27) };
}
