// HTTP to a tracker (plain node http/https, no vendor SDK). A tracker's address is typed in by an
// admin or a person, so it is untrusted like a workspace's AI endpoint: https only and no private,
// loopback or link-local address (checked when connecting, so DNS rebinding can't slip one in) —
// unless the operator allows private trackers (TRACKER_PRIVATE_ENDPOINTS, for a self-hosted Jira
// Data Center on the same network). Redirects are never followed; answers are size-capped.
//
// Rate limits and transient failures: a 429 / 502 / 503 / 504 or a network error is retried with
// exponential backoff (honouring Retry-After) a few times within a short budget; a longer wait
// is handed back to the caller (`TrackerError.retryAfterMs`), which pauses the connection and
// retries the link later. Credentials travel only in headers and never appear in errors or logs.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isBlockedAddress } from '../unfurl/index';

const MAX_REPLY_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
/** At most this long spent waiting between retries of one call; longer waits go back to the caller. */
const RETRY_BUDGET_MS = 8_000;
const MAX_ATTEMPTS = 4;

export type TrackerErrorKind = 'auth' | 'rate' | 'unavailable' | 'not_found' | 'refused' | 'invalid';

/** A tracker call failed. `message` is Freero's own words (safe to show and to store). */
export class TrackerError extends Error {
  constructor(
    message: string,
    readonly kind: TrackerErrorKind,
    readonly status = 0,
    /** The tracker asked to wait this long before calling again. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

export interface HttpRules {
  allowPrivate: boolean;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** JSON body (objects) or a form body (URLSearchParams). */
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: unknown;
  text: string;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    const addrs = (list as dns.LookupAddress[] | undefined) ?? [];
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address)))
      return cb(Object.assign(new TrackerError('The tracker’s address is private, which this server doesn’t call.', 'refused'), { code: 'EBLOCKED' }), '');
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

/** Throws unless `raw` is a tracker address this server may call. Returns its origin + path, no trailing slash. */
export function checkTrackerUrl(raw: string, rules: HttpRules): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TrackerError('The tracker address is not a valid URL.', 'invalid');
  }
  if (url.protocol !== 'https:' && !(rules.allowPrivate && url.protocol === 'http:')) throw new TrackerError('The tracker address must start with https://.', 'invalid');
  if (url.username || url.password) throw new TrackerError('Put the token in the token field, not in the address.', 'invalid');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!rules.allowPrivate && (host === 'localhost' || (net.isIP(host) && isBlockedAddress(host))))
    throw new TrackerError('The tracker’s address is private, which this server doesn’t call.', 'refused');
  return url;
}

function once(req: HttpRequest, rules: HttpRules): Promise<HttpResponse> {
  const url = checkTrackerUrl(req.url, rules);
  let payload: Buffer | null = null;
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Freero-Tracker-Sync',
    ...req.headers,
  };
  if (req.body instanceof URLSearchParams) {
    payload = Buffer.from(req.body.toString());
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (req.body !== undefined) {
    payload = Buffer.from(JSON.stringify(req.body));
    headers['content-type'] = 'application/json';
  }
  if (payload) headers['content-length'] = String(payload.length);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const r = mod.request(
      url,
      {
        method: req.method,
        headers,
        timeout: timeoutMs,
        ...(rules.allowPrivate ? {} : { lookup: guardedLookup as unknown as net.LookupFunction }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_REPLY_BYTES) r.destroy(new TrackerError('The tracker’s answer was too large.', 'unavailable'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* not JSON: the status decides */
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json,
            text,
          });
        });
        res.on('error', reject);
      },
    );
    const deadline = setTimeout(() => r.destroy(new TrackerError('The tracker took too long to answer.', 'unavailable')), timeoutMs);
    r.on('timeout', () => r.destroy(new TrackerError('The tracker took too long to answer.', 'unavailable')));
    r.on('error', (e) => {
      clearTimeout(deadline);
      reject(e instanceof TrackerError ? e : new TrackerError(`Couldn’t reach the tracker (${(e as NodeJS.ErrnoException).code ?? 'network error'}).`, 'unavailable'));
    });
    r.on('close', () => clearTimeout(deadline));
    r.end(payload ?? undefined);
  });
}

/** Milliseconds a 429/503 asks us to wait (Retry-After seconds or date; X-RateLimit-Reset epoch seconds). */
export function retryAfterMs(headers: http.IncomingHttpHeaders, now = Date.now()): number | null {
  const ra = headers['retry-after'];
  const v = Array.isArray(ra) ? ra[0] : ra;
  if (v) {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return Math.round(Number(v) * 1000);
    const at = Date.parse(v);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const reset = headers['x-ratelimit-reset'];
  const r = Array.isArray(reset) ? reset[0] : reset;
  if (r && /^\d+$/.test(r)) {
    const n = Number(r);
    // Epoch seconds (GitHub) or milliseconds (Linear).
    const at = n > 1e12 ? n : n * 1000;
    if (at > now) return at - now;
  }
  return null;
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One call with retries for rate limits and transient failures. Resolves with any other status
 * (the provider decides what a 4xx means); throws TrackerError when the tracker stays unreachable
 * or rate limited beyond the retry budget.
 */
export async function trackerRequest(req: HttpRequest, rules: HttpRules, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<HttpResponse> {
  const wait = opts.sleep ?? sleep;
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    let res: HttpResponse | null = null;
    let failure: TrackerError | null = null;
    try {
      res = await once(req, rules);
    } catch (e) {
      if (!(e instanceof TrackerError) || e.kind !== 'unavailable') throw e;
      failure = e;
    }
    if (res && !RETRYABLE.has(res.status)) return res;
    const asked = res ? retryAfterMs(res.headers) : null;
    const backoff = Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
    const delay = asked ?? backoff;
    if (attempt >= MAX_ATTEMPTS || waited + delay > RETRY_BUDGET_MS) {
      if (res?.status === 429) throw new TrackerError('The tracker is rate limiting Freero; the sync will try again shortly.', 'rate', 429, asked ?? 60_000);
      if (res) throw new TrackerError(`The tracker is unavailable right now (${res.status}).`, 'unavailable', res.status, asked ?? backoff);
      throw failure ?? new TrackerError('Couldn’t reach the tracker.', 'unavailable');
    }
    await wait(delay);
    waited += delay;
  }
}

/** A short, safe excerpt of what a tracker said about a refused call (never the request). */
export function trackerMessage(json: unknown): string | null {
  const j = json as {
    errorMessages?: unknown;
    errors?: unknown;
    message?: unknown;
    error_description?: unknown;
    error?: unknown;
  } | null;
  if (!j || typeof j !== 'object') return null;
  const parts: string[] = [];
  if (Array.isArray(j.errorMessages)) parts.push(...j.errorMessages.filter((m): m is string => typeof m === 'string'));
  if (j.errors && typeof j.errors === 'object' && !Array.isArray(j.errors)) for (const [k, v] of Object.entries(j.errors)) if (typeof v === 'string') parts.push(`${k}: ${v}`);
  if (Array.isArray(j.errors)) for (const e of j.errors) if (e && typeof (e as { message?: unknown }).message === 'string') parts.push((e as { message: string }).message);
  if (typeof j.message === 'string') parts.push(j.message);
  if (typeof j.error_description === 'string') parts.push(j.error_description);
  else if (typeof j.error === 'string') parts.push(j.error);
  const out = parts.join('; ').replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, 300) : null;
}
