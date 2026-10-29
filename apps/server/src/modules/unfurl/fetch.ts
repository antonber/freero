// SSRF-safe outbound HTTP for link previews — and for anything else the server fetches from a URL
// someone else chose (OAuth client metadata documents, apiauth). Every hop (the URL and each redirect):
//   - http/https only (or just https: `protocols`), default ports only, no credentials in the URL;
//   - the host is resolved by OUR lookup, which refuses private, loopback, link-local, CGNAT,
//     multicast and other reserved addresses — at connect time, so DNS rebinding between a check
//     and the connection can't sneak a private address in;
//   - at most MAX_REDIRECTS redirects, each validated the same way (or none: `followRedirects: false`);
//   - one overall deadline and a byte cap on the body.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const MAX_REDIRECTS = 4;
const USER_AGENT = 'FreeroBot/1.0 (link preview; +https://freero.app)';

/** Why a fetch was refused or failed, for callers that word it themselves. */
export type FetchFailure = 'url' | 'blocked' | 'timeout' | 'redirect' | 'status' | 'too_large';

export class UnfurlError extends Error {
  constructor(
    message: string,
    readonly failure: FetchFailure = 'url',
  ) {
    super(message);
  }
}

/** True for addresses an outbound preview request must never reach. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 || // "this" network
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local (cloud metadata)
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    // IPv4-mapped / -compatible (::ffff:10.0.0.1, ::ffff:a00:1): judge the IPv4 inside.
    const mapped = /^(?:0*:)*:?(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isBlockedAddress(mapped[1]);
    const hexMapped = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (v === '::' || v === '::1') return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    return (
      (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (first & 0xffc0) === 0xfec0 || // site-local (deprecated)
      (first & 0xff00) === 0xff00 || // multicast
      v.startsWith('64:ff9b:') || // NAT64 (can reach IPv4 private space)
      v.startsWith('2001:db8:') || // documentation
      v.startsWith('100::') // discard
    );
  }
  return true; // not an IP at all: refuse
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** Resolves a host name to all its addresses. */
export type Resolver = (
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

const dnsResolver: Resolver = (hostname, options, cb) =>
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => cb(err, (addresses as dns.LookupAddress[]) ?? []));

/**
 * dns.lookup that refuses blocked addresses (used by every outbound connection here). `resolve`
 * and `isBlocked` are only replaced by tests that serve from a local test server.
 */
function guardedLookup(resolve: Resolver, isBlocked: (ip: string) => boolean) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCb): void =>
    resolve(hostname, options, (err, list) => {
      if (err) return cb(err, '');
      if (!list.length || list.some((a) => isBlocked(a.address))) {
        return cb(Object.assign(new UnfurlError('That address is not reachable for previews.', 'blocked'), { code: 'EBLOCKED' }), '');
      }
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
}

/** Throws unless `raw` is a URL a preview may fetch. */
export function checkUrl(raw: string, isBlocked: (ip: string) => boolean = isBlockedAddress, protocols: readonly string[] = ['http:', 'https:']): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnfurlError('Not a valid URL.');
  }
  if (!protocols.includes(url.protocol)) throw new UnfurlError(`Only ${protocols.map((p) => p.slice(0, -1)).join(' and ')} links can be previewed.`);
  if (url.username || url.password) throw new UnfurlError('Links with credentials are not previewed.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnfurlError('Only default ports are previewed.');
  // Literal IPs are checked here too (the lookup also sees them).
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlocked(host)) throw new UnfurlError('That address is not reachable for previews.', 'blocked');
  return url;
}

export interface Fetched {
  url: string;
  status: number;
  contentType: string;
  /** The answer's Cache-Control header ('' when none). */
  cacheControl: string;
  body: Buffer;
  /** The body was cut at the byte cap (fine for HTML: the <head> comes first). */
  truncated: boolean;
}

export interface FetchOptions {
  maxBytes: number;
  /** Overall deadline for all hops, ms. */
  timeoutMs: number;
  accept: string;
  /** Cut the body at maxBytes instead of failing (HTML). */
  allowTruncate?: boolean;
  /** Stop reading once this (lower-case) text has arrived, e.g. '</head>' for page metadata. */
  until?: string;
  /** Schemes allowed on every hop (default http and https). */
  protocols?: readonly string[];
  /** False: a redirect is a failure ('redirect'), never followed. Default true. */
  followRedirects?: boolean;
  userAgent?: string;
  /**
   * Tests only: reach a local test server. Production callers never set this, so every hop is
   * checked against isBlockedAddress (by checkUrl and at connect time).
   */
  testNetwork?: { resolve: Resolver; isBlocked(ip: string): boolean; port: number };
}

function requestOnce(url: URL, opts: FetchOptions, deadline: number, lookup: ReturnType<typeof guardedLookup>): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        lookup: lookup as unknown as net.LookupFunction,
        ...(opts.testNetwork ? { port: opts.testNetwork.port } : {}),
        headers: { 'User-Agent': opts.userAgent ?? USER_AGENT, Accept: opts.accept, 'Accept-Encoding': 'identity' },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => resolve({ res, req }),
    );
    req.on('timeout', () => req.destroy(new UnfurlError('The site took too long to answer.', 'timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** GET with the protections above; follows (and re-checks) redirects. */
export async function safeFetch(raw: string, opts: FetchOptions): Promise<Fetched> {
  const deadline = Date.now() + opts.timeoutMs;
  const isBlocked = opts.testNetwork?.isBlocked ?? isBlockedAddress;
  const lookup = guardedLookup(opts.testNetwork?.resolve ?? dnsResolver, isBlocked);
  let url = checkUrl(raw, isBlocked, opts.protocols);
  for (let hop = 0; ; hop++) {
    const { res, req } = await requestOnce(url, opts, deadline, lookup);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (opts.followRedirects === false) throw new UnfurlError(`The site answered ${status} (a redirect, which is not followed).`, 'redirect');
      if (hop >= MAX_REDIRECTS) throw new UnfurlError('Too many redirects.', 'redirect');
      url = checkUrl(new URL(res.headers.location, url).toString(), isBlocked, opts.protocols);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new UnfurlError(`The site answered ${status}.`, 'status');
    }
    const declared = Number(res.headers['content-length'] ?? 0);
    if (declared > opts.maxBytes && !opts.allowTruncate) {
      res.destroy();
      throw new UnfurlError('Too large to preview.', 'too_large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const timer = setTimeout(() => req.destroy(new UnfurlError('The site took too long to answer.', 'timeout')), Math.max(1, deadline - Date.now()));
    try {
      await new Promise<void>((resolve, reject) => {
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            if (!opts.allowTruncate) return reject(new UnfurlError('Too large to preview.', 'too_large'));
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            truncated = true;
            res.destroy();
            return resolve();
          }
          chunks.push(chunk);
          if (opts.until && chunk.toString('latin1').toLowerCase().includes(opts.until)) {
            truncated = true;
            res.destroy();
            resolve();
          }
        });
        res.on('end', () => resolve());
        res.on('error', reject);
        req.on('error', reject);
      });
    } finally {
      clearTimeout(timer);
      if (!res.destroyed) res.destroy();
    }
    return { url: url.toString(), status, contentType: String(res.headers['content-type'] ?? '').toLowerCase(), cacheControl: String(res.headers['cache-control'] ?? ''), body: Buffer.concat(chunks), truncated };
  }
}
