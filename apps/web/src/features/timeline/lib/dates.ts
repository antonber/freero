// Calendar dates as whole day numbers. Dates are stored as local calendar dates 'YYYY-MM-DD' (no
// time zone, like card due dates); the arithmetic runs in UTC so a day is always one day long.
import type { TimelineScale } from '@freero/shared';

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isISODate = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Day number of an ISO date (days since 1970-01-01). */
export function dayOf(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (iso: string, n: number): string => isoOf(dayOf(iso) + n);

/** This device's calendar date of a moment (the server's clock, for "today"). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day-of-week, Monday = 0. */
export const weekday = (day: number): number => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;

export const mondayOf = (day: number): number => day - weekday(day);

/** ISO-8601 week number. */
export function isoWeek(day: number): number {
  const thursday = day - weekday(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(year, 0, 4) / DAY_MS);
  return 1 + Math.round((thursday - (jan4 - weekday(jan4) + 3)) / 7);
}

const parts = (day: number) => {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const dayFromParts = (y: number, m: number, d = 1) => Math.round(Date.UTC(y, m, d) / DAY_MS);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A labelled span of days on the axis (one header cell), `to` exclusive. */
export interface Tick {
  from: number;
  to: number;
  label: string;
}

function spans(from: number, to: number, next: (day: number) => number, label: (day: number) => string): Tick[] {
  const out: Tick[] = [];
  for (let at = from; at < to && out.length < 2000; ) {
    const end = Math.min(to, next(at));
    out.push({ from: at, to: end, label: label(at) });
    at = end;
  }
  return out;
}

const nextMonth = (day: number) => {
  const p = parts(day);
  return dayFromParts(p.y, p.m + 1);
};
const nextQuarter = (day: number) => {
  const p = parts(day);
  return dayFromParts(p.y, p.m - (p.m % 3) + 3);
};
const nextYear = (day: number) => dayFromParts(parts(day).y + 1, 0);

/**
 * The two header rows for days `from`..`to` (inclusive) at a scale: the coarse row (months or
 * years) above the unit row (days, weeks, months, quarters).
 */
export function axisTicks(scale: TimelineScale, from: number, to: number): { top: Tick[]; units: Tick[] } {
  const end = to + 1;
  const month = (d: number) => `${MONTHS[parts(d).m]} ${parts(d).y}`;
  const year = (d: number) => String(parts(d).y);
  switch (scale) {
    case 'day':
      return { top: spans(from, end, nextMonth, month), units: spans(from, end, (d) => d + 1, (d) => String(parts(d).d)) };
    case 'week':
      return { top: spans(from, end, nextMonth, month), units: spans(from, end, (d) => mondayOf(d) + 7, (d) => `W${isoWeek(d)}`) };
    case 'month':
      return { top: spans(from, end, nextYear, year), units: spans(from, end, nextMonth, (d) => MONTHS[parts(d).m]) };
    case 'quarter':
      return { top: spans(from, end, nextYear, year), units: spans(from, end, nextQuarter, (d) => `Q${Math.floor(parts(d).m / 3) + 1}`) };
  }
}

/** "Oct 26 – Nov 6" for a bar's tooltip and the outline. */
export function formatRange(start: string, end: string): string {
  const a = parts(dayOf(start));
  const b = parts(dayOf(end));
  const one = (p: { m: number; d: number }) => `${MONTHS[p.m]} ${p.d}`;
  if (start === end) return `${one(a)}, ${a.y}`;
  return a.y === b.y ? `${one(a)} – ${one(b)}, ${b.y}` : `${one(a)}, ${a.y} – ${one(b)}, ${b.y}`;
}
