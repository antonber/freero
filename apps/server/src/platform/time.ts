// Calendar time in a person's time zone (accounts' `timeZone`, IANA names; unknown reads as UTC).
// Pure (Intl only): due-date reminders, the "changes on your boards" email and dates in emails.

const UTC = 'UTC';

/** The canonical IANA name for `zone` ("europe/berlin" -> "Europe/Berlin"), or null when it is none. */
export function canonicalTimeZone(zone: string): string | null {
  const z = zone.trim();
  if (!z || z.length > 64) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const zoneOr = (zone: string | null | undefined) => (zone && canonicalTimeZone(zone)) || UTC;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(ms: number, zone: string | null | undefined): Parts {
  const z = zoneOr(zone);
  let f = formatters.get(z);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    formatters.set(z, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: WEEKDAYS.indexOf(p.weekday) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar day it is at `ms` in `zone`: "YYYY-MM-DD". */
export function localDate(ms: number, zone: string | null | undefined): string {
  const p = partsIn(ms, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The hour of the day (0–23) at `ms` in `zone`. */
export function localHour(ms: number, zone: string | null | undefined): number {
  return partsIn(ms, zone).hour;
}

/** The weekday (0 = Sunday) at `ms` in `zone`. */
export function localWeekday(ms: number, zone: string | null | undefined): number {
  return partsIn(ms, zone).weekday;
}

/** "YYYY-MM-DD" plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Tue 3 Nov, 14:05 (Europe/Berlin)": an instant as the reader reads their clock, for emails. */
export function formatWhen(ms: number, zone: string | null | undefined): string {
  const z = zoneOr(zone);
  const text = new Date(ms).toLocaleString('en-GB', { timeZone: z, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${text.replace(/,(?= \d\d:)/, ' at')} (${z === UTC ? 'UTC' : z})`;
}

/** "Tue 3 Nov": the day of an instant in the reader's time zone. */
export function formatDay(ms: number, zone: string | null | undefined): string {
  return new Date(ms).toLocaleDateString('en-GB', { timeZone: zoneOr(zone), weekday: 'short', day: 'numeric', month: 'short' });
}
