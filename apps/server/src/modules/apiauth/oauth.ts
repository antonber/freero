// Freero's OAuth 2.0 authorization server, built to the OAuth 2.1 rules the MCP authorization spec
// asks for (KAI-107 reuses it as is): authorization code only, PKCE S256 required for every client,
// exact redirect URIs (loopback: any port, RFC 8252), refresh tokens that rotate and revoke the
// whole consent when one is replayed, audience-bound tokens (RFC 8707 `resource`), dynamic client
// registration (RFC 7591), metadata (RFC 8414, RFC 9728) and revocation (RFC 7009).
//
// Apps never see a password: the person signs in to Freero, the consent screen (web app,
// /oauth/authorize) says which app, what it may do and where it sends them, and only then does
// the app get a code — bound to its PKCE challenge, single use, valid for 10 minutes.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  API_SCOPES,
  DEFAULT_OAUTH_SCOPES,
  isApiScope,
  type ApiScope,
  type AuthorizedApp,
  type OAuthClientInfo,
  type OAuthConsentInfo,
  type RegisterClientRequest,
} from '@freero/shared';
import { badRequest, forbidden, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { ACCESS_PREFIX, hashSecret, newSecret, protectedResources, REFRESH_PREFIX } from './credentials';
import * as repo from './repo';

export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;
export const MAX_CLIENTS_PER_USER = 20;
const MAX_REDIRECTS = 10;
/** The resource an app gets when it names none: the REST API. */
export const DEFAULT_RESOURCE = '/api/v1';

/** An OAuth error response (RFC 6749 §5.2): `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

// ---- redirect URIs ----

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:']);

/**
 * A redirect URI an app may register: https anywhere, http only on loopback (native apps, RFC
 * 8252 §7.3), or an app's own scheme (`vscode://…`, `cursor://…`, §7.1) — never a scheme that
 * runs code, and never with a fragment. Null when it is not acceptable.
 */
export function cleanRedirectUri(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash || raw.includes('#') || u.username || u.password) return null;
  if (u.protocol === 'https:') return raw;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname) ? raw : null;
  if (UNSAFE_SCHEMES.has(u.protocol) || !/^[a-z][a-z0-9+.-]*:$/.test(u.protocol)) return null;
  return raw;
}

/** Exact match, except that a loopback http URI matches on any port (RFC 8252 §7.3). */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    const u = new URL(r);
    return u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
  });
}

// ---- clients ----

function cleanName(v: unknown, fallback?: string): string {
  const name = typeof v === 'string' ? v.trim().slice(0, 80) : '';
  if (!name && !fallback) throw badRequest('Give the app a name');
  return name || fallback!;
}

function cleanWebsite(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  try {
    const u = new URL(String(v));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    return u.toString().slice(0, 300);
  } catch {
    throw badRequest('website must be an http(s) URL');
  }
}

function cleanRedirects(v: unknown, err: (m: string) => Error): string[] {
  if (!Array.isArray(v) || !v.length) throw err('Register at least one redirect URI');
  if (v.length > MAX_REDIRECTS) throw err(`At most ${MAX_REDIRECTS} redirect URIs`);
  return v.map((r) => {
    const clean = cleanRedirectUri(r);
    if (!clean) throw err(`Redirect URI not allowed: ${String(r).slice(0, 200)} (https, http on localhost, or an app's own scheme; no fragment)`);
    return clean;
  });
}

const clientInfo = (c: repo.ClientRow & { users: number }): OAuthClientInfo => ({
  clientId: c.id,
  name: c.name,
  website: c.website,
  redirectUris: c.redirectUris,
  confidential: c.secretHash !== null,
  createdAt: c.createdAt,
  users: c.users,
});

/** An app a developer registers in settings (optionally confidential: a secret shown once). */
export async function registerClient(ownerId: string, body: Partial<RegisterClientRequest> | undefined): Promise<{ client: OAuthClientInfo; clientSecret?: string }> {
  const name = cleanName(body?.name);
  const website = cleanWebsite(body?.website);
  const redirectUris = cleanRedirects(body?.redirectUris, badRequest);
  if ((await repo.countClientsOwnedBy(ownerId)) >= MAX_CLIENTS_PER_USER) throw forbidden(`You can register up to ${MAX_CLIENTS_PER_USER} apps`);
  const secret = body?.confidential ? newSecret('frs_') : null;
  const client: repo.ClientRow = { id: `frc_${newId(20)}`, name, website, redirectUris, ownerId, secretHash: secret ? hashSecret(secret) : null, createdAt: Date.now() };
  await repo.insertClient(client);
  await recordAuditQuietly({ action: 'api.app_registered', accountId: ownerId, actorId: ownerId, target: { type: 'oauth_app', id: client.id, label: name }, metadata: { confidential: !!secret } });
  return { client: clientInfo({ ...client, users: 0 }), ...(secret ? { clientSecret: secret } : {}) };
}

export async function listOwnClients(ownerId: string): Promise<OAuthClientInfo[]> {
  return (await repo.clientsOwnedBy(ownerId)).map(clientInfo);
}

/** Deletes an app its developer registered: every consent and token it had goes with it. */
export async function deleteClient(ownerId: string, clientId: string): Promise<void> {
  const gone = await repo.deleteOwnedClient(ownerId, clientId);
  if (!gone) throw notFound('No such app');
  await recordAuditQuietly({ action: 'api.app_deleted', accountId: ownerId, actorId: ownerId, target: { type: 'oauth_app', id: clientId, label: gone.name } });
}

/**
 * RFC 7591 dynamic client registration: an app (an MCP client, say) registers itself without an
 * account. Public clients only (PKCE; no secret); nobody's data is reachable until a person
 * consents on the consent screen, which says the app registered itself. Unused registrations are
 * dropped after a week (init.ts).
 */
export async function registerDynamicClient(body: unknown): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const invalid = (m: string) => new OAuthError('invalid_client_metadata', m);
  const redirectUris = cleanRedirects(b.redirect_uris, (m) => new OAuthError('invalid_redirect_uri', m));
  const method = b.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw invalid('Only public clients may register themselves (token_endpoint_auth_method "none", with PKCE)');
  const grantTypes = (b.grant_types as unknown[] | undefined) ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grantTypes) || grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))
    throw invalid('grant_types may only be authorization_code and refresh_token');
  const responseTypes = (b.response_types as unknown[] | undefined) ?? ['code'];
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== 'code')) throw invalid('response_types may only be code');
  let website: string | null = null;
  try {
    website = cleanWebsite(b.client_uri);
  } catch {
    throw invalid('client_uri must be an http(s) URL');
  }
  const client: repo.ClientRow = {
    id: `frc_${newId(20)}`,
    name: cleanName(b.client_name, 'Unnamed app'),
    website,
    redirectUris,
    ownerId: null,
    secretHash: null,
    createdAt: Date.now(),
  };
  await repo.insertClient(client);
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    client_name: client.name,
    ...(website ? { client_uri: website } : {}),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// ---- the authorization request (consent screen) ----

export interface AuthorizeParams {
  response_type?: unknown;
  client_id?: unknown;
  redirect_uri?: unknown;
  scope?: unknown;
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  resource?: unknown;
}

interface ValidRequest {
  client: repo.ClientRow;
  redirectUri: string;
  scopes: ApiScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
}

/** Where to send the browser with an error the app should hear about (RFC 6749 §4.1.2.1). */
function errorRedirect(redirectUri: string, error: string, description: string, state: string | null): string {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state !== null) u.searchParams.set('state', state);
  return u.toString();
}

/** The resource path an app asks for (absolute URL or path), or null when it isn't one of ours. */
function resourcePath(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return DEFAULT_RESOURCE;
  if (typeof v !== 'string') return null;
  let path = v;
  try {
    path = new URL(v).pathname;
  } catch {
    /* a path */
  }
  path = path.replace(/\/+$/, '');
  return protectedResources().has(path) ? path : null;
}

/**
 * Checks an authorization request. An unknown app or a redirect URI it didn't register is shown to
 * the person, never redirected to (`fatal`); anything else wrong goes back to the app (`redirect`).
 */
export async function checkAuthorizeRequest(p: AuthorizeParams): Promise<{ ok: ValidRequest } | { fatal: string } | { redirect: string }> {
  const clientId = typeof p.client_id === 'string' ? p.client_id : '';
  const client = clientId ? await repo.getClient(clientId) : null;
  if (!client) return { fatal: 'This app isn’t registered with Freero (unknown client_id).' };
  const given = typeof p.redirect_uri === 'string' ? p.redirect_uri : client.redirectUris.length === 1 ? client.redirectUris[0] : '';
  if (!given || !redirectMatches(client.redirectUris, given)) return { fatal: 'The app asked to send you somewhere it didn’t register (redirect_uri).' };
  const state = typeof p.state === 'string' ? p.state.slice(0, 1000) : null;
  const back = (error: string, description: string) => ({ redirect: errorRedirect(given, error, description, state) });
  if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
  if (typeof p.code_challenge !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge))
    return back('invalid_request', 'PKCE is required: send code_challenge (S256)');
  if (p.code_challenge_method !== 'S256') return back('invalid_request', 'code_challenge_method must be S256');
  const asked = typeof p.scope === 'string' ? p.scope.split(' ').filter(Boolean) : [];
  if (asked.some((s) => !isApiScope(s))) return back('invalid_scope', `Unknown scope. Freero's scopes: ${Object.keys(API_SCOPES).join(' ')}`);
  const resource = resourcePath(p.resource);
  if (!resource) return back('invalid_target', 'Unknown resource');
  const scopes = asked.length ? [...new Set(asked as ApiScope[])] : DEFAULT_OAUTH_SCOPES;
  return { ok: { client, redirectUri: given, scopes, state, codeChallenge: p.code_challenge, resource } };
}

/** What the consent screen shows. */
export function consentInfo(v: ValidRequest): OAuthConsentInfo {
  return {
    client: { clientId: v.client.id, name: v.client.name, website: v.client.website, registration: v.client.ownerId ? 'manual' : 'dynamic' },
    scopes: v.scopes.map((id) => ({ id, label: API_SCOPES[id] })),
    redirectOrigin: (() => {
      const u = new URL(v.redirectUri);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : `${u.protocol}//${u.host}`;
    })(),
    resource: protectedResources().get(v.resource) ?? v.resource,
  };
}

/**
 * The person's answer. Allow: their consent is stored (replacing an earlier one for the app) and a
 * single-use code is sent back to the app. `issuedVia`: how their session signed in.
 */
export async function decide(userId: string, issuedVia: string, v: ValidRequest, allow: boolean): Promise<string> {
  if (!allow) return errorRedirect(v.redirectUri, 'access_denied', 'The person declined', v.state);
  const code = newSecret('frcode_');
  const now = Date.now();
  await repo.transaction(async () => {
    await repo.upsertGrant({ id: newId(16), clientId: v.client.id, userId, scopes: v.scopes, resource: v.resource, issuedVia, at: now });
    await repo.insertCode(hashSecret(code), {
      clientId: v.client.id,
      userId,
      redirectUri: v.redirectUri,
      scopes: v.scopes,
      resource: v.resource,
      codeChallenge: v.codeChallenge,
      issuedVia,
      expiresAt: now + CODE_TTL_MS,
    });
    await recordAudit({
      action: 'api.app_authorized',
      accountId: userId,
      actorId: userId,
      target: { type: 'oauth_app', id: v.client.id, label: v.client.name },
      metadata: { scopes: v.scopes, resource: v.resource, registration: v.client.ownerId ? 'manual' : 'dynamic' },
    });
  });
  const u = new URL(v.redirectUri);
  u.searchParams.set('code', code);
  if (v.state !== null) u.searchParams.set('state', v.state);
  return u.toString();
}

// ---- the token endpoint ----

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The app making a token request: its id, and for confidential apps the secret (basic or post). */
async function authenticateClient(req: Request, body: Record<string, unknown>): Promise<repo.ClientRow> {
  let id = typeof body.client_id === 'string' ? body.client_id : '';
  let secret = typeof body.client_secret === 'string' ? body.client_secret : null;
  const basic = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (basic) {
    const [u, p] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u ?? '');
    secret = decodeURIComponent(p ?? '');
  }
  const client = id ? await repo.getClient(id) : null;
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
  if (client.secretHash !== null && (!secret || !safeEqual(hashSecret(secret), client.secretHash))) throw new OAuthError('invalid_client', 'Client authentication failed', 401);
  return client;
}

async function issueTokens(grant: repo.GrantRow, scopes: string[], issuedVia: string, clientName: string) {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  const now = Date.now();
  for (const [kind, secret, ttl] of [
    ['access', access, ACCESS_TTL_MS],
    ['refresh', refresh, REFRESH_TTL_MS],
  ] as const)
    await repo.insertToken({
      id: newId(16),
      userId: grant.userId,
      kind,
      name: clientName,
      tokenHash: hashSecret(secret),
      hint: secret.slice(-4),
      scopes,
      resource: grant.resource,
      grantId: grant.id,
      issuedVia,
      createdAt: now,
      expiresAt: now + ttl,
    });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: scopes.join(' ') };
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** POST /api/oauth/token: authorization_code (with PKCE) or refresh_token (rotating). */
export async function tokenRequest(req: Request, body: Record<string, unknown>) {
  const client = await authenticateClient(req, body);
  const now = Date.now();
  if (body.grant_type === 'authorization_code') {
    const code = typeof body.code === 'string' ? await repo.takeCode(hashSecret(body.code)) : null;
    if (!code || code.expiresAt <= now || code.clientId !== client.id) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used');
    if (body.redirect_uri !== undefined && body.redirect_uri !== code.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(s256(verifier), code.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    const grants = await repo.grantsOf(code.userId);
    const grant = grants.find((g) => g.clientId === client.id);
    if (!grant) throw new OAuthError('invalid_grant', 'The person revoked this app’s access');
    return issueTokens(grant, code.scopes, code.issuedVia, client.name);
  }
  if (body.grant_type === 'refresh_token') {
    const presented = typeof body.refresh_token === 'string' ? hashSecret(body.refresh_token) : '';
    const used = presented ? await repo.useRefreshToken(presented, now) : null;
    if (!used) {
      // A refresh token used twice was copied: end the whole consent (every token of it).
      const replayed = presented ? await repo.tokenByHash(presented) : null;
      if (replayed?.kind === 'refresh' && replayed.grantId && replayed.clientId === client.id) {
        await repo.deleteGrantById(replayed.grantId);
        await recordAuditQuietly({ action: 'api.app_revoked', accountId: replayed.userId, actorId: null, target: { type: 'oauth_app', id: client.id, label: client.name }, metadata: { reason: 'refresh_token_replayed' } });
      }
      throw new OAuthError('invalid_grant', 'The refresh token is invalid, expired or already used');
    }
    if (used.clientId !== client.id || !used.grantId || (used.expiresAt !== null && used.expiresAt <= now)) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired');
    const grant = await repo.getGrant(used.grantId);
    if (!grant) throw new OAuthError('invalid_grant', 'The person revoked this app’s access');
    let scopes = used.scopes;
    if (typeof body.scope === 'string' && body.scope.trim()) {
      const asked = body.scope.split(' ').filter(Boolean);
      if (asked.some((s) => !scopes.includes(s))) throw new OAuthError('invalid_scope', 'A refresh can only keep or narrow the scopes');
      scopes = asked;
    }
    return issueTokens(grant, scopes, used.issuedVia, client.name);
  }
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

/** POST /api/oauth/revoke (RFC 7009): always 200; a refresh token takes its consent's tokens along. */
export async function revokeRequest(req: Request, body: Record<string, unknown>): Promise<void> {
  const client = await authenticateClient(req, body);
  if (typeof body.token !== 'string') return;
  const gone = await repo.deleteAppToken(hashSecret(body.token), client.id);
  if (gone?.kind === 'refresh' && gone.grantId) await repo.deleteTokensOfGrant(gone.grantId);
}

// ---- the person's authorised apps ----

export async function listAuthorizedApps(userId: string): Promise<AuthorizedApp[]> {
  return (await repo.grantsOf(userId)).map((g) => ({
    clientId: g.clientId,
    name: g.client.name,
    website: g.client.website,
    registration: g.client.ownerId ? 'manual' : 'dynamic',
    scopes: g.scopes.filter(isApiScope),
    authorizedAt: g.createdAt,
    lastUsedAt: g.lastUsedAt,
  }));
}

/** Revokes the person's consent to an app: every token it holds for them stops at once. */
export async function revokeApp(userId: string, clientId: string): Promise<void> {
  const gone = await repo.deleteGrant(userId, clientId);
  if (!gone) throw notFound('That app has no access to your account');
  const client = await repo.getClient(clientId);
  await recordAuditQuietly({ action: 'api.app_revoked', accountId: userId, actorId: userId, target: { type: 'oauth_app', id: clientId, label: client?.name ?? null } });
}

// ---- metadata ----

export function authorizationServerMetadata(req: Request) {
  const base = appUrl(req, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: Object.keys(API_SCOPES),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    service_documentation: `${base}/api/v1/openapi.json`,
  };
}

export function protectedResourceMetadata(req: Request, path: string) {
  const name = protectedResources().get(path);
  if (!name) return null;
  const base = appUrl(req, '');
  return {
    resource: `${base}${path}`,
    resource_name: name,
    authorization_servers: [base],
    scopes_supported: Object.keys(API_SCOPES),
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/api/v1/openapi.json`,
  };
}
