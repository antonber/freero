// Bearer credentials: personal access tokens (made in settings) and the access tokens apps get
// (oauth.ts). Every API request looks its credential up in the database — no cache — so pausing or
// revoking one, revoking an app, suspending or deprovisioning the account, or enforcing SSO takes
// effect on the very next request.
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  API_CREDENTIAL_BLOCKED,
  API_DISABLED,
  INSUFFICIENT_SCOPE,
  isApiScope,
  MAX_TOKEN_NAME,
  MAX_TOKENS_PER_USER,
  SSO_REQUIRED,
  type Account,
  type ApiScope,
  type CreateTokenRequest,
  type PersonalToken,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { setRequestUser } from '../../platform/requestContext';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getAccount, isSuspended, signInRestriction } from '../auth/index';
import { getWorkspaceInfo } from '../workspaces/index';
import * as repo from './repo';

export const PERSONAL_PREFIX = 'frp_';
export const ACCESS_PREFIX = 'fro_';
export const REFRESH_PREFIX = 'frr_';

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
/** A new secret: the prefix (so secret scanners recognise it) and 256 random bits. */
export const newSecret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const hintOf = (secret: string) => secret.slice(-4);

/** Who is calling the API and with what. */
export interface ApiCredential {
  /** The token's id. */
  tokenId: string;
  /** What admins see and block: the personal token, or the app for this person ('<clientId>:<userId>'). */
  credentialId: string;
  kind: 'personal' | 'oauth';
  /** The token's name, or the app's. */
  label: string;
  clientId: string | null;
  scopes: ApiScope[];
  account: Account;
}

// ---- personal access tokens (the owner's session) ----

const toPersonal = (t: repo.TokenRow): PersonalToken => ({
  id: t.id,
  name: t.name,
  hint: t.hint,
  scopes: t.scopes.filter(isApiScope),
  createdAt: t.createdAt,
  expiresAt: t.expiresAt,
  lastUsedAt: t.lastUsedAt,
  paused: t.pausedAt !== null,
});

export function cleanScopes(v: unknown): ApiScope[] {
  if (!Array.isArray(v) || !v.length) throw badRequest('Pick at least one scope');
  const bad = v.find((s) => !isApiScope(s));
  if (bad !== undefined) throw badRequest(`Unknown scope ${JSON.stringify(bad)}`);
  return [...new Set(v as ApiScope[])];
}

export async function listPersonalTokens(userId: string): Promise<PersonalToken[]> {
  return (await repo.personalTokensOf(userId)).map(toPersonal);
}

/**
 * A new personal access token; the secret is returned once and only its hash is kept. `issuedVia`:
 * how the session making it signed in (enforced SSO later refuses a token made without it).
 */
export async function createPersonalToken(userId: string, issuedVia: string, body: Partial<CreateTokenRequest> | undefined): Promise<{ token: PersonalToken; secret: string }> {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_TOKEN_NAME) : '';
  if (!name) throw badRequest('Give the token a name, so you can tell it apart later');
  const scopes = cleanScopes(body?.scopes);
  const days = body?.expiresInDays;
  if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365))
    throw badRequest('expiresInDays must be a whole number from 1 to 365, or null for no expiry');
  const secret = newSecret(PERSONAL_PREFIX);
  const now = Date.now();
  const id = newId(16);
  await repo.transaction(async () => {
    await repo.lockTokenQuota(userId);
    if ((await repo.countPersonalTokens(userId)) >= MAX_TOKENS_PER_USER)
      throw forbidden(`You can have up to ${MAX_TOKENS_PER_USER} tokens. Revoke ones you no longer use.`);
    await repo.insertToken({
      id,
      userId,
      kind: 'personal',
      name,
      tokenHash: hashSecret(secret),
      hint: hintOf(secret),
      scopes,
      resource: null,
      grantId: null,
      issuedVia,
      createdAt: now,
      expiresAt: days === null ? null : now + days * 86_400_000,
    });
    await recordAudit({ action: 'api.token_created', accountId: userId, actorId: userId, target: { type: 'api_token', id, label: name }, metadata: { scopes, expiresInDays: days } });
  });
  return { token: toPersonal((await repo.personalToken(userId, id))!), secret };
}

/** Pauses (refused at once, kept) or resumes a personal token: the per-token kill switch. */
export async function setTokenPaused(userId: string, id: string, paused: unknown): Promise<PersonalToken> {
  if (typeof paused !== 'boolean') throw badRequest('paused must be true or false');
  const before = await repo.personalToken(userId, id);
  if (!before || !(await repo.setPaused(userId, id, paused ? Date.now() : null))) throw notFound('No such token');
  if ((before.pausedAt !== null) !== paused)
    await recordAuditQuietly({ action: paused ? 'api.token_paused' : 'api.token_resumed', accountId: userId, actorId: userId, target: { type: 'api_token', id, label: before.name } });
  return toPersonal((await repo.personalToken(userId, id))!);
}

export async function revokePersonalToken(userId: string, id: string): Promise<void> {
  const gone = await repo.deletePersonalToken(userId, id);
  if (!gone) throw notFound('No such token');
  await recordAuditQuietly({ action: 'api.token_revoked', accountId: userId, actorId: userId, target: { type: 'api_token', id, label: gone.name } });
}

/** Every token and app consent of the person (the per-user "disconnect everything"). */
export async function revokeEverything(userId: string, actorId: string | null, reason: 'user' | 'operator' | 'signed_out_everywhere'): Promise<{ tokens: number; apps: number }> {
  const n = await repo.deleteAllOf(userId);
  if (n.tokens || n.apps)
    await recordAuditQuietly({ action: 'api.token_revoked', accountId: userId, actorId, target: { type: 'user', id: userId }, metadata: { all: true, reason, tokens: n.tokens, apps: n.apps } });
  return n;
}

// ---- authenticating a request ----

/** A protected resource: the REST API, the MCP server. */
export interface ProtectedResource {
  name: string;
  /** The scopes it uses (its metadata's `scopes_supported`; asked for when an app names none). Default: all. */
  scopes?: ApiScope[];
  /**
   * Scopes an app may ask for that stay OFF unless the person turns them on in the consent screen
   * (the MCP server: writing boards directly; read + suggest is the default there).
   */
  optInScopes?: ApiScope[];
  /** Served at the bare /.well-known/oauth-protected-resource too (clients that only look there). */
  root?: boolean;
}

/** Protected resources by path. */
const resources = new Map<string, ProtectedResource>();

/** Declares a protected resource (its OAuth metadata is published, apps may ask for tokens for it). */
export function registerProtectedResource(path: string, name: string, opts: Omit<ProtectedResource, 'name'> = {}): void {
  resources.set(path, { name, ...opts });
}
export const protectedResources = (): ReadonlyMap<string, ProtectedResource> => resources;
/** The resource the bare /.well-known/oauth-protected-resource describes. */
export const rootResource = (): string => [...resources].find(([, r]) => r.root)?.[0] ?? '/api/v1';

/** RFC 9728: where a client learns how to get a token for `resource`. */
export const resourceMetadataUrl = (req: Request, resource: string) => appUrl(req, `/.well-known/oauth-protected-resource${resource}`);

class BearerError extends HttpError {
  constructor(status: number, message: string, code: string, readonly challenge: string) {
    super(status, message, code);
  }
}

const lastTouched = new Map<string, number>();
const TOUCH_EVERY_MS = 60_000;

/**
 * The credential a request carries for `resource`, or a 401/403 (with a WWW-Authenticate challenge)
 * that says why. Also refused: paused or expired tokens, tokens for another resource, suspended
 * accounts and accounts awaiting deletion, and credentials a sign-in restriction now refuses
 * (enforced SSO: a credential made from a session that didn't sign in through the workspace's
 * identity provider stops working when SSO becomes required).
 */
export async function authenticate(req: Request, resource: string): Promise<ApiCredential> {
  const meta = `resource_metadata="${resourceMetadataUrl(req, resource)}"`;
  const fail = (status: number, message: string, code: string, error?: string) =>
    new BearerError(status, message, code, `Bearer realm="freero", ${error ? `error="${error}", ` : ''}${meta}`);
  if (!getConfig().publicApi) throw fail(403, 'The Freero API is turned off on this server', API_DISABLED);
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) throw fail(401, 'Send a token: Authorization: Bearer <token>', 'unauthorized');
  const secret = m[1];
  if (!secret.startsWith(PERSONAL_PREFIX) && !secret.startsWith(ACCESS_PREFIX)) throw fail(401, 'Invalid token', 'invalid_token', 'invalid_token');
  const token = await repo.tokenByHash(hashSecret(secret));
  const now = Date.now();
  if (!token || token.kind === 'refresh') throw fail(401, 'Invalid token', 'invalid_token', 'invalid_token');
  if (token.expiresAt !== null && token.expiresAt <= now) throw fail(401, 'This token has expired', 'invalid_token', 'invalid_token');
  if (token.pausedAt !== null) throw fail(401, 'This token is paused. Resume it in your Freero settings.', 'invalid_token', 'invalid_token');
  if (token.resource !== null && token.resource !== resource) throw fail(401, 'This token is for another Freero resource', 'invalid_token', 'invalid_token');
  let account: Account;
  try {
    account = await getAccount(token.userId);
  } catch {
    throw fail(401, 'Invalid token', 'invalid_token', 'invalid_token');
  }
  if (account.deletionScheduledFor !== null || (await isSuspended(account.id))) throw fail(401, 'This account can’t use the API right now', 'invalid_token', 'invalid_token');
  const restriction = await signInRestriction({ email: account.email, userId: account.id, method: token.issuedVia });
  if (restriction)
    throw fail(403, `${restriction.message} Make a new token (or connect the app again) after signing in with SSO.`, SSO_REQUIRED, 'invalid_token');

  if (now - (lastTouched.get(token.id) ?? 0) > TOUCH_EVERY_MS) {
    if (lastTouched.size > 50_000) lastTouched.clear();
    lastTouched.set(token.id, now);
    await repo.touchToken(token.id, token.grantId, now);
  }
  setRequestUser(req, account.id);
  const oauth = token.kind === 'access';
  return {
    tokenId: token.id,
    credentialId: oauth ? `${token.clientId}:${account.id}` : token.id,
    kind: oauth ? 'oauth' : 'personal',
    label: oauth ? (token.clientName ?? 'App') : token.name,
    clientId: token.clientId,
    scopes: token.scopes.filter(isApiScope),
    account,
  };
}

/** Sends a refused authentication the way OAuth clients expect it (WWW-Authenticate + JSON). */
export function sendAuthError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof BearerError) {
    res.setHeader('WWW-Authenticate', err.challenge);
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
}

/** 403 `insufficient_scope` unless the credential carries `scope`. */
export function requireScope(req: Request, cred: ApiCredential, scope: ApiScope, resource: string): void {
  if (cred.scopes.includes(scope)) return;
  throw new BearerError(
    403,
    `This token can’t do that: it needs the ${scope} scope`,
    INSUFFICIENT_SCOPE,
    `Bearer realm="freero", error="insufficient_scope", scope="${scope}", resource_metadata="${resourceMetadataUrl(req, resource)}"`,
  );
}
export const isBearerError = (e: unknown): e is HttpError & { challenge: string } => e instanceof BearerError;

/**
 * The credential is about to act in a workspace (read or change a board there, create one): team
 * workspaces whose admins turned API access off, or blocked this credential, refuse it (403), and
 * the use is recorded for the admin console. Personal workspaces have no policies.
 */
export async function useInWorkspace(cred: ApiCredential, workspaceId: string): Promise<void> {
  const ws = await getWorkspaceInfo(workspaceId);
  if (!ws || ws.kind !== 'team') return;
  if (!(await repo.workspaceApiEnabled(workspaceId)))
    throw new HttpError(403, `${ws.name} has turned off API access to its boards`, API_DISABLED);
  const blocked = await repo.noteWorkspaceUse({
    workspaceId,
    credentialId: cred.credentialId,
    userId: cred.account.id,
    kind: cred.kind,
    label: cred.label,
    scopes: cred.scopes,
    at: Date.now(),
  });
  if (blocked) throw new HttpError(403, `An admin of ${ws.name} blocked this ${cred.kind === 'oauth' ? 'app' : 'token'} there`, API_CREDENTIAL_BLOCKED);
}
