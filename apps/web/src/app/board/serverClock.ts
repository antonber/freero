// Server clock behind Host.serverNow(). Shared deadlines (e.g. a timer's absolute `endsAt`) are
// only right on clients whose clock agrees with the writer's, so every client converts to
// *server* time: it estimates `offset = serverClock - localClock` from the HTTP `Date` header of
// a few tiny requests. Lives in the app because only the app talks to the REST API.

export interface ClockSample {
  /** Local Date.now() just before the request was sent. */
  sentAt: number;
  /** Local Date.now() when the response arrived. */
  receivedAt: number;
  /** Parsed `Date` header (whole seconds, so the true server time is in [serverDate, serverDate + 1000)). */
  serverDate: number;
}

/**
 * Intersects the offset interval each sample allows. The Date header has 1 s resolution, but
 * samples that straddle a second boundary narrow the estimate to well under a second.
 * Returns null without usable samples.
 */
export function estimateOffset(samples: ClockSample[]): number | null {
  let lo = -Infinity;
  let hi = Infinity;
  let last: [number, number] | null = null;
  for (const s of samples) {
    if (!Number.isFinite(s.serverDate) || s.receivedAt < s.sentAt) continue;
    const a = s.serverDate - s.receivedAt;
    const b = s.serverDate + 1000 - s.sentAt;
    last = [a, b];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (!last) return null;
  // Inconsistent samples (a clock jump mid-measurement): trust the most recent one.
  if (lo > hi) [lo, hi] = last;
  return Math.round((lo + hi) / 2);
}

let offset = 0;
let started = false;

/** Current time on the server's clock (ms). Falls back to the local clock until measured. */
export function serverNow(): number {
  return Date.now() + offset;
}

const SAMPLE_COUNT = 5;
const SAMPLE_SPACING_MS = 210;
// Any cheap endpoint carries a Date header; this one answers 200 for everyone (guests have no account).
const SAMPLE_URL = '/api/auth/session';

async function sample(): Promise<ClockSample | null> {
  try {
    const sentAt = Date.now();
    const res = await fetch(SAMPLE_URL, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
    const receivedAt = Date.now();
    const header = res.headers.get('date');
    const serverDate = header ? Date.parse(header) : NaN;
    return Number.isFinite(serverDate) ? { sentAt, receivedAt, serverDate } : null;
  } catch {
    return null;
  }
}

/** Starts measuring the server clock once per page; cheap to call from every mount. */
export function syncServerClock(): void {
  if (started || typeof fetch !== 'function') return;
  started = true;
  const samples: ClockSample[] = [];
  let pending = SAMPLE_COUNT;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    setTimeout(async () => {
      const s = await sample();
      if (s) samples.push(s);
      if (--pending > 0) return;
      const est = estimateOffset(samples);
      if (est != null) offset = est;
    }, i * SAMPLE_SPACING_MS);
  }
}
