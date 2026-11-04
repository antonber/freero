// Time zones as people read them: "Chicago (UTC−06:00)", grouped by region, found by city, region,
// the zone's own name ("Central Time") or its offset ("-6", "utc+5:30").

export interface ZoneOption {
  /** IANA id, what the account stores. */
  id: string;
  city: string;
  /** First part of the id ("America", "Europe"), or '' for zones without one ("UTC"). */
  region: string;
  /** Minutes ahead of UTC now (daylight saving included). */
  offset: number;
  /** "Chicago (UTC−06:00)". */
  label: string;
  /** "Central Time", in the interface language, or ''. */
  generic: string;
}

const MINUS = '−';

/** "UTC+05:30", "UTC−06:00", "UTC+00:00". */
export function offsetText(minutes: number): string {
  const sign = minutes < 0 ? MINUS : '+';
  const a = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Minutes ahead of UTC at `at` in `zone`, or null when this browser doesn't know the zone. */
export function zoneOffset(zone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'));
    const utc = Math.floor(at.getTime() / 60_000) * 60_000;
    return Math.round((local - utc) / 60_000);
  } catch {
    return null;
  }
}

function genericName(zone: string, locale: string, at: Date): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    // Zones without a name of their own come back as an offset ("GMT-03:00"): nothing to add.
    return /^(GMT|UTC)([+\-−]|$)/.test(name) ? '' : name;
  } catch {
    return '';
  }
}

/** Browsers still list some zones by their old ids (ICU): show and find them by today's names. */
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Kolkata',
  'Europe/Kiev': 'Kyiv',
  'Asia/Saigon': 'Ho Chi Minh City',
  'Asia/Katmandu': 'Kathmandu',
  'Asia/Rangoon': 'Yangon',
  'America/Godthab': 'Nuuk',
  'Atlantic/Faeroe': 'Faroe',
  'Pacific/Truk': 'Chuuk',
  'Pacific/Ponape': 'Pohnpei',
  'Pacific/Enderbury': 'Kanton',
  'America/Buenos_Aires': 'Buenos Aires',
};

export function zoneOption(id: string, locale: string, at: Date): ZoneOption {
  const parts = id.split('/');
  const city = RENAMED[id] ?? (parts.length > 1 ? parts[parts.length - 1] : id).replace(/_/g, ' ');
  const offset = zoneOffset(id, at) ?? 0;
  return { id, city, region: parts.length > 1 ? parts[0] : '', offset, label: `${city} (${offsetText(offset)})`, generic: genericName(id, locale, at) };
}

/** Every zone this browser knows, plus `keep` (the saved one, which it may not list), by offset then city. */
export function zoneOptions(keep: readonly string[], locale: string, at = new Date()): ZoneOption[] {
  let known: string[] = [];
  try {
    known = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    known = [];
  }
  const kept = keep.filter(Boolean);
  const ids = [...new Set([...kept, ...known, 'UTC'])];
  // One entry per place: a saved "Asia/Kolkata" and this browser's "Asia/Calcutta" are one city.
  const seen = new Set<string>();
  const options = ids.map((id) => zoneOption(id, locale, at)).filter((z) => {
    const place = `${z.region}/${z.city}/${z.offset}`;
    if (seen.has(place)) return false;
    seen.add(place);
    return true;
  });
  return options.sort((a, b) => a.offset - b.offset || a.city.localeCompare(b.city));
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "-6", "+5:30", "utc+0530", "GMT−3" → minutes; null when the query isn't an offset. */
function offsetQuery(q: string): number | null {
  const m = /^(?:utc|gmt)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(q.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '+' ? minutes : -minutes;
}

/** The zones a search finds: every word in the city, region, id or name, or the zones at an offset. */
export function searchZones(zones: readonly ZoneOption[], query: string): ZoneOption[] {
  const q = fold(query.trim());
  if (!q) return [...zones];
  const at = offsetQuery(q);
  if (at !== null) return zones.filter((z) => z.offset === at);
  const words = q.split(/\s+/);
  return zones.filter((z) => {
    const hay = fold(`${z.city} ${z.region} ${z.id.replace(/_/g, ' ')} ${z.generic} ${offsetText(z.offset)}`);
    return words.every((w) => hay.includes(w));
  });
}
