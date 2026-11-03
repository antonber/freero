// Outbound connections to a workspace's SIEM. Hosts are typed by workspace admins, so they are
// untrusted like webhook URLs (modules/webhooks) and link previews (modules/unfurl):
//   - https / TLS only, no credentials in a URL — unless the operator allows private endpoints
//     (SIEM_PRIVATE_ENDPOINTS: a SIEM on their own network), which also allows plain http;
//   - the host must not resolve to a private, loopback, link-local or otherwise reserved address,
//     checked by OUR lookup when connecting (DNS rebinding can't slip one in between);
//   - redirects are never followed; one deadline per attempt; answers are read up to a small cap.
// TLS certificates are always verified (a syslog server on a private CA names that CA's PEM).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { isBlockedAddress } from '../unfurl/index';

export class SinkTargetError extends Error {}

const MAX_ANSWER_BYTES = 64 * 1024;
const USER_AGENT = 'Freero-Audit-Stream/1.0 (+https://freero.app)';

/** Throws a SinkTargetError (safe to show) unless `raw` is a URL a sink may send to. */
export function checkSinkUrl(raw: unknown, allowPrivate: boolean, what = 'The URL'): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new SinkTargetError(`${what} is required`);
  if (raw.length > 2000) throw new SinkTargetError(`${what} is too long`);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SinkTargetError(`${what} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new SinkTargetError(`${what} must start with https://`);
  if (url.username || url.password) throw new SinkTargetError(`${what} can’t carry a user name or password`);
  url.hash = '';
  checkHost(url.hostname, allowPrivate, what);
  return url;
}

/** A host name (not an address literal of a private network, not localhost) unless private endpoints are allowed. */
export function checkHost(hostIn: string, allowPrivate: boolean, what = 'The host'): string {
  const host = hostIn.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9.:-]+$/.test(host)) throw new SinkTargetError(`${what} is not a valid host name`);
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && isBlockedAddress(host))))
    throw new SinkTargetError(`${what} can’t be a private or local address`);
  return host;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb): void {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    const addrs = (list as dns.LookupAddress[] | undefined) ?? [];
    if (err) return cb(err, '');
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address)))
      return cb(Object.assign(new SinkTargetError('The host resolves to a private address, which audit streams are never sent to'), { code: 'EBLOCKED' }), '');
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

export interface Outcome {
  ok: boolean;
  status: number | null;
  /** The answer's body (capped), for token responses. */
  body: string;
  /** Why it failed, in Freero's words; null when it worked. */
  error: string | null;
}

/** One POST. Never throws: the outcome says what happened. */
export function post(
  rawUrl: string,
  body: string | Buffer,
  headers: Record<string, string>,
  opts: { timeoutMs: number; allowPrivate: boolean },
): Promise<Outcome> {
  let url: URL;
  try {
    url = checkSinkUrl(rawUrl, opts.allowPrivate);
  } catch (e) {
    return Promise.resolve({ ok: false, status: null, body: '', error: (e as Error).message });
  }
  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (o: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(o);
    };
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, 'content-length': String(payload.length), 'user-agent': USER_AGENT },
        timeout: opts.timeoutMs,
        ...(opts.allowPrivate ? {} : { lookup: guardedLookup as unknown as net.LookupFunction }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_ANSWER_BYTES) res.destroy();
          else chunks.push(c);
        });
        const end = () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (status >= 200 && status < 300) finish({ ok: true, status, body: text, error: null });
          else if (status >= 300 && status < 400) finish({ ok: false, status, body: '', error: `Answered with a redirect (${status}), which isn’t followed` });
          else finish({ ok: false, status, body: text, error: `Answered ${status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}` });
        };
        res.on('end', end);
        res.on('close', end);
        res.on('error', end);
      },
    );
    const late = () => {
      req.destroy();
      finish({ ok: false, status: null, body: '', error: `No answer within ${Math.round(opts.timeoutMs / 1000)} s` });
    };
    const deadline = setTimeout(late, opts.timeoutMs);
    req.on('timeout', late);
    req.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      finish({ ok: false, status: null, body: '', error: e instanceof SinkTargetError ? e.message : `Couldn’t connect (${code ?? 'network error'})` });
    });
    req.end(payload);
  });
}

/**
 * Sends syslog frames over TLS (RFC 5425: octet-counted, `<length> <message>`), then closes.
 * Success = every byte written and the connection ended cleanly. The certificate is verified
 * against the public CAs, or `ca` (PEM) when given.
 */
export function sendSyslogTls(
  host: string,
  port: number,
  messages: string[],
  opts: { timeoutMs: number; allowPrivate: boolean; ca?: string },
): Promise<Outcome> {
  let name: string;
  try {
    name = checkHost(host, opts.allowPrivate);
  } catch (e) {
    return Promise.resolve({ ok: false, status: null, body: '', error: (e as Error).message });
  }
  const payload = Buffer.concat(messages.map((m) => Buffer.from(`${Buffer.byteLength(m)} ${m}`)));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (o: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(o);
    };
    const socket = tls.connect({
      host: name,
      port,
      servername: net.isIP(name) ? undefined : name,
      ca: opts.ca || undefined,
      rejectUnauthorized: true,
      timeout: opts.timeoutMs,
      ...(opts.allowPrivate ? {} : { lookup: guardedLookup as unknown as net.LookupFunction }),
    });
    const deadline = setTimeout(() => finish({ ok: false, status: null, body: '', error: `No answer within ${Math.round(opts.timeoutMs / 1000)} s` }), opts.timeoutMs);
    socket.once('secureConnect', () => {
      socket.end(payload, () => finish({ ok: true, status: null, body: '', error: null }));
    });
    socket.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      finish({
        ok: false,
        status: null,
        body: '',
        error: e instanceof SinkTargetError ? e.message : /CERT|SELF_SIGNED|UNABLE_TO|ALTNAME/.test(code ?? e.message) ? `The server’s TLS certificate isn’t trusted (${code ?? e.message})` : `Couldn’t connect (${code ?? 'network error'})`,
      });
    });
  });
}
