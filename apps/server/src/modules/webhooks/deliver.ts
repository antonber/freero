// Outbound webhook requests. Endpoint URLs are typed by workspace admins, so they are untrusted
// like link previews' URLs (modules/unfurl) and workspace AI endpoints (modules/ai):
//   - https only, no credentials in the URL — unless the operator allows private endpoints
//     (WEBHOOK_PRIVATE_ENDPOINTS: receivers on their own network), which also allows plain http;
//   - the host must not resolve to a private, loopback, link-local, CGNAT or other reserved address,
//     checked by OUR lookup when connecting (DNS rebinding between a check and the connection can't
//     slip one in) — unfurl's `isBlockedAddress`;
//   - redirects are never followed (a 3xx is a failed attempt), so a public URL can't bounce the
//     request to an internal one;
//   - one deadline per attempt, and the answer's body is read only up to a small cap and dropped.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isBlockedAddress } from '../unfurl/index';

export class EndpointError extends Error {}

const MAX_URL = 2000;
const MAX_ANSWER_BYTES = 64 * 1024;
const USER_AGENT = 'Freero-Webhooks/1.0 (+https://freero.app)';

/** Throws an EndpointError (Freero's words, safe to show) unless `raw` is a URL deliveries may go to. */
export function checkEndpointUrl(raw: unknown, allowPrivate: boolean): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new EndpointError('Enter the URL that should receive events');
  if (raw.length > MAX_URL) throw new EndpointError('That URL is too long');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new EndpointError('That is not a valid URL');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new EndpointError('Webhook URLs must start with https://');
  if (url.username || url.password) throw new EndpointError('Webhook URLs can’t carry a user name or password');
  if (url.hash) url.hash = '';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && isBlockedAddress(host))))
    throw new EndpointError('Webhooks can’t be sent to private or local addresses');
  return url;
}

/** The URL as admins see it: scheme, host and the first part of the path (the rest may be a token). */
export function displayUrl(url: URL): string {
  const first = url.pathname.split('/').filter(Boolean)[0];
  const more = url.pathname.split('/').filter(Boolean).length > 1 || url.search;
  return `${url.protocol}//${url.host}${first ? `/${first}` : ''}${more ? '/…' : ''}`;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    const addrs = (list as dns.LookupAddress[] | undefined) ?? [];
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address)))
      return cb(Object.assign(new EndpointError('The URL resolves to a private address, which webhooks are never sent to'), { code: 'EBLOCKED' }), '');
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

export interface Attempt {
  /** The receiver's HTTP status, or null when there was no answer. */
  status: number | null;
  ok: boolean;
  /** Why it failed, in Freero's words (null when it worked). */
  error: string | null;
  durationMs: number;
}

/** One POST of `body` with `headers`. Never throws: the outcome says what happened. */
export function postOnce(raw: string, body: string, headers: Record<string, string>, opts: { timeoutMs: number; allowPrivate: boolean }): Promise<Attempt> {
  const started = Date.now();
  const done = (status: number | null, error: string | null): Attempt => ({ status, ok: error === null, error, durationMs: Date.now() - started });
  let url: URL;
  try {
    url = checkEndpointUrl(raw, opts.allowPrivate);
  } catch (e) {
    return Promise.resolve(done(null, (e as Error).message));
  }
  const payload = Buffer.from(body);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (a: Attempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(a);
    };
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'content-length': String(payload.length), 'user-agent': USER_AGENT },
        timeout: opts.timeoutMs,
        ...(opts.allowPrivate ? {} : { lookup: guardedLookup as unknown as net.LookupFunction }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_ANSWER_BYTES) res.destroy();
        });
        const end = () => {
          if (status >= 200 && status < 300) finish(done(status, null));
          else if (status >= 300 && status < 400) finish(done(status, `Answered with a redirect (${status}), which webhooks don’t follow`));
          else finish(done(status, `Answered ${status}`));
        };
        res.on('end', end);
        res.on('close', end);
        res.on('error', end);
      },
    );
    const deadline = setTimeout(() => {
      req.destroy();
      finish(done(null, `No answer within ${Math.round(opts.timeoutMs / 1000)} s`));
    }, opts.timeoutMs);
    req.on('timeout', () => {
      req.destroy();
      finish(done(null, `No answer within ${Math.round(opts.timeoutMs / 1000)} s`));
    });
    req.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      finish(done(null, e instanceof EndpointError ? e.message : `Couldn’t connect (${code ?? 'network error'})`));
    });
    req.end(payload);
  });
}
