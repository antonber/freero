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

// ---------------------------------------------------------------- measuring (FAC-9)
// Measured on the first board of the page, again whenever the board's socket reconnects (a laptop
// that slept, a network change), and — while it fails (a board opened offline from the device
// copy, a blip) — again after a growing pause instead of never. Until a measurement succeeds,
// `measuredNow()` is null and nothing writes a shared deadline (Host.measuredServerNow): one written
// in an unmeasured local clock would be off by that clock's skew for everyone else.

export interface ServerClock {
  /** Server time: the local clock until measured. */
  now(): number;
  /** Server time, or null while not measured yet (and a measurement starts). */
  measuredNow(): number | null;
  /** Measures unless measured or measuring (cheap to call from every mount). */
  sync(): void;
  /** Measures again now (the socket reconnected); the last offset stands meanwhile. */
  remeasure(): void;
}

const SAMPLE_COUNT = 5;
const SAMPLE_SPACING_MS = 210;
/** Pauses before measuring again after a failed measurement (the last one repeats). */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export function createServerClock(sample: () => Promise<ClockSample | null>, clock: () => number = Date.now): ServerClock {
  let offset = 0;
  let measured = false;
  let measuring = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const measure = () => {
    if (measuring) return;
    if (retry) clearTimeout(retry);
    retry = null;
    measuring = true;
    const samples: ClockSample[] = [];
    let pending = SAMPLE_COUNT;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      setTimeout(async () => {
        const s = await sample().catch(() => null);
        if (s) samples.push(s);
        if (--pending > 0) return;
        measuring = false;
        const est = estimateOffset(samples);
        if (est != null) {
          offset = est;
          measured = true;
          failures = 0;
        } else retry = setTimeout(measure, RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
      }, i * SAMPLE_SPACING_MS);
    }
  };
  const sync = () => {
    if (!measured && !measuring && !retry) measure();
  };

  return {
    now: () => clock() + offset,
    measuredNow() {
      if (measured) return clock() + offset;
      sync();
      return null;
    },
    sync,
    remeasure: measure,
  };
}

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

const pageClock = createServerClock(sample);
const canMeasure = () => typeof fetch === 'function';

/** Current time on the server's clock (ms). Falls back to the local clock until measured. */
export const serverNow = (): number => pageClock.now();
/** Server time once measured, else null (Host.measuredServerNow). */
export const measuredServerNow = (): number | null => (canMeasure() ? pageClock.measuredNow() : serverNow());
/** Starts measuring the server clock (retried while it fails); cheap to call from every mount. */
export function syncServerClock(): void {
  if (canMeasure()) pageClock.sync();
}
/** The board's socket reconnected: measure again (Host.onConnected). */
export function remeasureServerClock(): void {
  if (canMeasure()) pageClock.remeasure();
}
