// OAuth clients identified by a Client ID Metadata Document (#81): the app's `client_id` is an https
// URL, and the JSON document served there says who it is and where it may send people back. This is
// what the MCP authorization spec (2025-11-25, "Client ID Metadata Documents") prefers over dynamic
// registration, and what Claude, ChatGPT and Codex use when the authorization server metadata says
// `client_id_metadata_document_supported`. Rules: draft-ietf-oauth-client-id-metadata-document-02.
//
// Fetching a URL an unknown app chose is server-side request forgery surface, so:
//   - the client_id must be a canonical https URL with a path, on the default port, without
//     userinfo, query, fragment or dot segments, and not a literal private address (§3, §8.6);
//   - the fetch is unfurl's SSRF-safe one, https only: the host is resolved by a lookup that refuses
//     private, loopback, link-local and other special-use addresses when connecting (so DNS
//     rebinding can't slip one in), redirects are never followed (§5), the body is capped at 5 KB
//     (§8.7) and the whole fetch at a few seconds;
//   - only a signed-in person's authorization request fetches (never the token endpoint, which uses
//     the stored copy), at most RATE_LIMIT_OAUTH_CLIENT_METADATA cache misses per person, one fetch
//     per URL at a time per instance;
//   - only a 200 JSON document whose `client_id` equals the URL exactly is accepted, and failures
//     are never cached (§5.2); a good document is kept as long as its Cache-Control says, within
//     5 minutes and a day (an hour when it says nothing).
// What the document says is untrusted: its name is shown next to the host it was fetched from
// (which the app can't fake), its client_uri only when it is on that same host, its logo never.
// The loopback exception of §8.6 (plain http on 127.0.0.1 / localhost, any port) exists only with
// OAUTH_CLIENT_METADATA_LOOPBACK, which config refuses in production.
import net from 'node:net';
import { getConfig } from '../../platform/config';
import { consumeRateLimit } from '../../platform/rateLimit';
import { safeFetch, UnfurlError, type Resolver } from '../unfurl/index';
import { cleanRedirects } from './redirects';
import * as repo from './repo';

export const METADATA_MAX_BYTES = 5 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_CLIENT_ID = 1000;
export const METADATA_MIN_TTL_MS = 5 * 60_000;
export const METADATA_MAX_TTL_MS = 86_400_000;
export const METADATA_DEFAULT_TTL_MS = 3_600_000;
const USER_AGENT = 'Freero-OAuth/1.0 (client metadata; +https://freero.app)';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SHARED_SECRET_METHODS = new Set(['client_secret_basic', 'client_secret_post', 'client_secret_jwt']);

/** A client_id that names a metadata document (every other client_id is `frc_…`). */
export const isMetadataClientId = (id: string): boolean => /^https?:\/\//i.test(id);

/** What a metadata document fetch brought back. */
export interface MetadataResponse {
  status: number;
  contentType: string;
  cacheControl: string;
  body: Buffer;
}
export type MetadataFetcher = (url: URL) => Promise<MetadataResponse>;

/** Why a document can't be used, in Freero's words (shown on the consent screen to the person). */
export class MetadataError extends Error {}

/**
 * Checks the client_id itself before anything is fetched. Canonical form only (`url.href` equals
 * what was sent), so one document can't hide behind spellings that compare differently (§3:
 * `https://a.example:443/c` is not `https://a.example/c`).
 */
export function checkClientIdUrl(raw: string, allowLoopback = getConfig().oauthClientMetadataLoopback): URL {
  const bad = (why: string) => new MetadataError(`The app’s client_id ${why}.`);
  if (raw.length > MAX_CLIENT_ID) throw bad('is too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad('is not a valid URL');
  }
  const loopbackHttp = allowLoopback && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) throw bad('must be an https URL');
  if (url.username || url.password) throw bad('must not carry a user name or password');
  if (url.hash || raw.includes('#')) throw bad('must not have a fragment');
  if (url.search || raw.includes('?')) throw bad('must not have a query');
  if (url.pathname === '/' || !url.pathname) throw bad('must have a path (the document’s address, e.g. https://app.example/oauth/client.json)');
  if (/\/\.\.?(\/|$)/.test(raw.slice(url.protocol.length + 2)) || /%2e/i.test(url.pathname)) throw bad('must not contain . or .. path segments');
  if (url.href !== raw) throw bad(`must be written in its canonical form (${url.href.slice(0, 200)})`);
  if (!loopbackHttp) {
    if (url.port) throw bad('must use the default https port');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || net.isIP(host)) throw bad('must name a public host, not an address');
  }
  return url;
}

/** The production fetcher: https through unfurl's SSRF guard, no redirects, 5 KB. `testNetwork`: tests only. */
export function httpsMetadataFetcher(testNetwork?: { resolve: Resolver; isBlocked(ip: string): boolean; port: number }): MetadataFetcher {
  return async (url) => {
    const r = await safeFetch(url.href, {
      maxBytes: METADATA_MAX_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      accept: 'application/json',
      protocols: ['https:'],
      followRedirects: false,
      userAgent: USER_AGENT,
      ...(testNetwork ? { testNetwork } : {}),
    });
    return { status: r.status, contentType: r.contentType, cacheControl: r.cacheControl, body: r.body };
  };
}

/** Development / tests (OAUTH_CLIENT_METADATA_LOOPBACK): plain http to this machine only, same caps. */
const loopbackFetcher: MetadataFetcher = async (url) => {
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) throw new MetadataError('Only loopback addresses are fetched over http.');
  const res = await fetch(url, { redirect: 'manual', headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > METADATA_MAX_BYTES) {
      await reader.cancel();
      throw new UnfurlError('Too large.', 'too_large');
    }
    chunks.push(value);
  }
  return { status: res.status, contentType: (res.headers.get('content-type') ?? '').toLowerCase(), cacheControl: res.headers.get('cache-control') ?? '', body: Buffer.concat(chunks) };
};

let fetcher: MetadataFetcher | null = null;
/** Tests only: replace how documents are fetched (null: the production fetchers). */
export function setMetadataFetcher(f: MetadataFetcher | null): void {
  fetcher = f;
}
const fetchDocument = (url: URL) => (fetcher ?? (url.protocol === 'http:' ? loopbackFetcher : httpsMetadataFetcher()))(url);

/** How long a good document is kept: its Cache-Control max-age, within our bounds (§5.2). */
export function metadataTtl(cacheControl: string): number {
  const cc = cacheControl.toLowerCase();
  if (/(^|[\s,])(no-store|no-cache)([\s,=]|$)/.test(cc)) return METADATA_MIN_TTL_MS;
  const age = /(?:^|[\s,])max-age\s*=\s*"?(\d+)/.exec(cc);
  if (!age) return METADATA_DEFAULT_TTL_MS;
  return Math.min(METADATA_MAX_TTL_MS, Math.max(METADATA_MIN_TTL_MS, Number(age[1]) * 1000));
}

export interface ParsedMetadata {
  name: string;
  website: string | null;
  redirectUris: string[];
}

/**
 * Validates a fetched document (§4, MCP "For Authorization Servers"); its redirect URIs follow the
 * rules of every other client (redirects.ts).
 */
export function parseMetadataDocument(url: URL, res: MetadataResponse): ParsedMetadata {
  const bad = (why: string) => new MetadataError(`The app’s client metadata document ${why}.`);
  if (res.status !== 200) throw bad(`answered ${res.status} (it must answer 200 itself; redirects are not followed)`);
  const type = res.contentType.split(';')[0].trim();
  if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) throw bad('is not served as JSON (Content-Type application/json)');
  let doc: unknown;
  try {
    doc = JSON.parse(res.body.toString('utf8'));
  } catch {
    throw bad('is not valid JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad('is not a JSON object');
  const d = doc as Record<string, unknown>;
  // Simple string comparison (§4): a document can't speak for any other URL.
  if (d.client_id !== url.href) throw bad('names a different client_id than the URL it is served at');
  if ('client_secret' in d || 'client_secret_expires_at' in d) throw bad('contains a client secret, which a metadata document must never carry');
  const method = d.token_endpoint_auth_method ?? 'none';
  const methods = Array.isArray(d.token_endpoint_auth_methods_supported) ? d.token_endpoint_auth_methods_supported : [];
  if (typeof method !== 'string' || SHARED_SECRET_METHODS.has(method)) throw bad('asks for a shared-secret token_endpoint_auth_method, which metadata documents may not use');
  // Freero takes these clients as public clients (PKCE, token_endpoint_auth_method "none"). A
  // document preferring private_key_jwt is accepted only when it also says it can do "none"
  // (ChatGPT publishes both), since Freero never advertises private_key_jwt.
  if (method !== 'none' && !methods.includes('none')) throw bad('requires client authentication Freero doesn’t offer (Freero accepts public clients: token_endpoint_auth_method "none", with PKCE)');
  if (d.grant_types !== undefined && !(Array.isArray(d.grant_types) && d.grant_types.includes('authorization_code'))) throw bad('doesn’t allow the authorization_code grant');
  if (d.response_types !== undefined && !(Array.isArray(d.response_types) && d.response_types.includes('code'))) throw bad('doesn’t allow response_type code');
  if (typeof d.client_name !== 'string' || !d.client_name.trim()) throw bad('has no client_name');
  const redirectUris = cleanRedirects(d.redirect_uris, (m) => bad(`lists redirect_uris Freero can’t use: ${m}`));
  // The name is the app's claim; the host is what it can't fake. Its website is shown only when it
  // is on that host (§8.1 lets the server tie client_uri to the client_id), so a document can't
  // pass off someone else's site as its own.
  let website: string | null = null;
  try {
    const site = typeof d.client_uri === 'string' ? new URL(d.client_uri) : null;
    if (site && site.protocol === url.protocol && site.host === url.host && !site.username && !site.password) website = site.toString().slice(0, 300);
  } catch {
    /* not a URL: not shown */
  }
  return { name: d.client_name.trim().slice(0, 80), website, redirectUris };
}

const inFlight = new Map<string, Promise<repo.ClientRow>>();

/**
 * The client a metadata-document client_id names: the stored copy while it is fresh, else the
 * document fetched (and validated, and stored) now. `userId`: the signed-in person whose
 * authorization request this is; each fetch counts against their rate limit. Throws MetadataError
 * (Freero's words) when the document can't be used, and a 429 when they fetch too many.
 */
export async function resolveMetadataClient(clientId: string, userId: string | null): Promise<repo.ClientRow> {
  const url = checkClientIdUrl(clientId);
  const stored = await repo.getClient(clientId);
  if (stored && stored.metadataExpiresAt !== null && stored.metadataExpiresAt > Date.now()) return stored;
  const pending = inFlight.get(clientId);
  if (pending) return pending;
  const run = (async () => {
    if (userId) await consumeRateLimit('oauthClientMetadata', userId);
    let res: MetadataResponse;
    try {
      res = await fetchDocument(url);
    } catch (e) {
      throw new MetadataError(fetchFailure(url, e));
    }
    const parsed = parseMetadataDocument(url, res);
    const now = Date.now();
    return repo.upsertMetadataClient({ id: clientId, ...parsed, at: now, expiresAt: now + metadataTtl(res.cacheControl) });
  })();
  inFlight.set(clientId, run);
  try {
    return await run;
  } finally {
    inFlight.delete(clientId);
  }
}

function fetchFailure(url: URL, e: unknown): string {
  const at = `Freero couldn’t load the app’s client metadata document from ${url.host}`;
  if (e instanceof MetadataError) return `${at}: ${e.message}`;
  const failure = e instanceof UnfurlError ? e.failure : null;
  if (failure === 'blocked') return `${at}: that host is on a private network, which Freero never fetches from.`;
  if (failure === 'too_large') return `${at}: it is larger than ${METADATA_MAX_BYTES / 1024} KB.`;
  if (failure === 'timeout') return `${at}: it took too long to answer.`;
  if (failure === 'redirect') return `${at}: it answered with a redirect, which is not followed (serve the document at the client_id URL itself).`;
  if (failure === 'status') return `${at}: ${e instanceof Error ? e.message.replace(/^The site /, 'it ') : 'it failed'}`;
  return `${at}.`;
}
