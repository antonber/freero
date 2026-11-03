// Who may call the Teams bot's messaging endpoint (#113): only the Bot Connector service, proven by
// the JWT it sends in `Authorization: Bearer` — validated exactly as Microsoft requires of bots that
// do it themselves (learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-
// authentication, "Authenticate requests from the Bot Connector service to your bot"):
//
// 1. a Bearer token in the Authorization header, a well-formed JWS (header.payload.signature);
// 2. signed with RS256 (the metadata's id_token_signing_alg_values_supported) by a key of the JWKS
//    the OpenID metadata names (login.botframework.com/v1/.well-known/openidconfiguration), found
//    by `kid`; keys are cached and refreshed at least daily, and at once (rate-limited) when a token
//    names a key we don't have yet;
// 3. `iss` = https://api.botframework.com, `aud` = the bot's Microsoft App ID;
// 4. within `nbf` / `exp`, five minutes of clock skew;
// 5. `serviceUrl` claim = the activity's serviceUrl (a token for one conversation's service can't be
//    replayed to steer our replies elsewhere);
// 6. the signing key endorsed for the activity's channel (`endorsements` contains its channelId) —
//    otherwise 403.
//
// No library: node:crypto verifies the signature over the JWK directly.
import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { logger } from '../../platform/log';

export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';
export const CLOCK_SKEW_SECONDS = 5 * 60;
const KEYS_MAX_AGE_MS = 24 * 60 * 60_000;
const REFRESH_AT_MOST_EVERY_MS = 5 * 60_000;

export type BotAuthResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; status: 401 | 403; reason: 'missing' | 'malformed' | 'algorithm' | 'unknown_key' | 'signature' | 'issuer' | 'audience' | 'expired' | 'not_yet_valid' | 'service_url' | 'endorsement' | 'metadata' };

interface SigningKey {
  key: KeyObject;
  endorsements: string[] | null;
}

interface KeySet {
  keys: Map<string, SigningKey>;
  algorithms: string[];
  fetchedAt: number;
}

const b64json = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Validates Bot Connector tokens for one bot against one OpenID metadata document. */
export class BotTokenValidator {
  private set: KeySet | null = null;
  private loading: Promise<KeySet> | null = null;
  private lastRefreshAttempt = 0;

  constructor(
    private readonly botAppId: string,
    private readonly metadataUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async load(): Promise<KeySet> {
    const get = async (url: string) => {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    };
    const meta = await get(this.metadataUrl);
    if (typeof meta.jwks_uri !== 'string') throw new Error('OpenID metadata without jwks_uri');
    const jwks = await get(meta.jwks_uri);
    const keys = new Map<string, SigningKey>();
    for (const jwk of Array.isArray(jwks.keys) ? (jwks.keys as Array<Record<string, unknown>>) : []) {
      if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.use !== undefined && jwk.use !== 'sig')) continue;
      try {
        const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as JsonWebKey, format: 'jwk' });
        const endorsements = Array.isArray(jwk.endorsements) ? jwk.endorsements.filter((e): e is string => typeof e === 'string') : null;
        keys.set(jwk.kid, { key, endorsements });
      } catch {
        /* a key we can't read can't sign anything we accept */
      }
    }
    const algorithms = Array.isArray(meta.id_token_signing_alg_values_supported) ? meta.id_token_signing_alg_values_supported.filter((a): a is string => typeof a === 'string') : ['RS256'];
    return { keys, algorithms, fetchedAt: Date.now() };
  }

  /** The key set, fetched when missing or older than a day, or again now when `refresh` (at most every few minutes). */
  private async keySet(now: number, refresh = false): Promise<KeySet> {
    const stale = !this.set || now - this.set.fetchedAt > KEYS_MAX_AGE_MS;
    const mayRefresh = refresh && now - this.lastRefreshAttempt > REFRESH_AT_MOST_EVERY_MS;
    if (this.set && !stale && !mayRefresh) return this.set;
    if (!this.loading) {
      // Only refreshes a token's unknown key asked for are throttled: tokens naming made-up keys
      // can't make us fetch Microsoft's keys more than once every few minutes.
      if (mayRefresh) this.lastRefreshAttempt = now;
      this.loading = this.load()
        .then((s) => (this.set = s))
        .finally(() => (this.loading = null));
    }
    try {
      return await this.loading;
    } catch (e) {
      // Keys we had stay good until they are replaced: a metadata hiccup doesn't stop the bot.
      if (this.set) {
        logger.warn({ teams: { botKeys: 'refresh failed', error: String(e) } }, 'teams bot keys not refreshed');
        return this.set;
      }
      throw e;
    }
  }

  /** Checks one request's Authorization header against the activity it carries. */
  async validate(authorization: string | undefined, activity: { serviceUrl?: unknown; channelId?: unknown }, nowMs = Date.now()): Promise<BotAuthResult> {
    const fail = (status: 401 | 403, reason: Extract<BotAuthResult, { ok: false }>['reason']): BotAuthResult => ({ ok: false, status, reason });
    const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization ?? '');
    if (!authorization) return fail(401, 'missing');
    if (!m) return fail(401, 'malformed');
    const [, h, p, s] = m;
    const header = b64json(h);
    const claims = b64json(p);
    if (!header || !claims) return fail(401, 'malformed');
    let set: KeySet;
    try {
      set = await this.keySet(nowMs);
    } catch (e) {
      logger.error({ teams: { botKeys: 'unavailable', error: String(e) } }, 'teams bot keys unavailable');
      return fail(401, 'metadata');
    }
    if (header.alg !== 'RS256' || !set.algorithms.includes('RS256')) return fail(401, 'algorithm');
    if (typeof header.kid !== 'string') return fail(401, 'unknown_key');
    let signing = set.keys.get(header.kid);
    if (!signing) {
      // A key rolled in since we last looked: refresh once (rate-limited) before refusing.
      set = await this.keySet(nowMs, true).catch(() => set);
      signing = set.keys.get(header.kid);
      if (!signing) return fail(401, 'unknown_key');
    }
    if (!verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), signing.key, Buffer.from(s, 'base64url'))) return fail(401, 'signature');
    if (claims.iss !== BOT_FRAMEWORK_ISSUER) return fail(401, 'issuer');
    const aud = claims.aud;
    if (!(aud === this.botAppId || (Array.isArray(aud) && aud.length === 1 && aud[0] === this.botAppId))) return fail(401, 'audience');
    const now = nowMs / 1000;
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) return fail(401, 'expired');
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) return fail(401, 'not_yet_valid');
    const serviceUrl = typeof activity.serviceUrl === 'string' ? activity.serviceUrl : null;
    // Bot Connector tokens spell the claim `serviceurl`; accept `serviceUrl` too.
    const claimed = claims.serviceurl ?? claims.serviceUrl;
    if (!serviceUrl || claimed !== serviceUrl) return fail(401, 'service_url');
    const channel = typeof activity.channelId === 'string' ? activity.channelId : '';
    if (!channel || !signing.endorsements?.includes(channel)) return fail(403, 'endorsement');
    return { ok: true, claims };
  }
}
