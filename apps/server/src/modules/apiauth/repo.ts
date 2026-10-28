// The only writer of oauth_clients, oauth_grants, oauth_codes, api_tokens, api_workspace_settings
// and api_workspace_credentials [S4].
import { one, query, tx } from '../../platform/db';

const d = (ms: number | null) => (ms === null ? null : new Date(ms));
const ms = (v: Date | null) => (v ? v.getTime() : null);

export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return tx(() => fn());
}

// ---- tokens ----

export type TokenKind = 'personal' | 'access' | 'refresh';

export interface TokenRow {
  id: string;
  userId: string;
  kind: TokenKind;
  name: string;
  hint: string;
  scopes: string[];
  resource: string | null;
  grantId: string | null;
  issuedVia: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  pausedAt: number | null;
  usedAt: number | null;
  /** The app behind an access / refresh token. */
  clientId: string | null;
  clientName: string | null;
}

interface TokenDbRow {
  id: string;
  user_id: string;
  kind: TokenKind;
  name: string;
  hint: string;
  scopes: string;
  resource: string | null;
  grant_id: string | null;
  issued_via: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  paused_at: Date | null;
  used_at: Date | null;
  client_id: string | null;
  client_name: string | null;
}

export const splitScopes = (s: string): string[] => s.split(' ').filter(Boolean);

const toToken = (r: TokenDbRow): TokenRow => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  name: r.name,
  hint: r.hint,
  scopes: splitScopes(r.scopes),
  resource: r.resource,
  grantId: r.grant_id,
  issuedVia: r.issued_via,
  createdAt: r.created_at.getTime(),
  expiresAt: ms(r.expires_at),
  lastUsedAt: ms(r.last_used_at),
  pausedAt: ms(r.paused_at),
  usedAt: ms(r.used_at),
  clientId: r.client_id,
  clientName: r.client_name,
});

const TOKEN_SELECT = `SELECT t.*, g.client_id, c.name AS client_name
  FROM api_tokens t LEFT JOIN oauth_grants g ON g.id = t.grant_id LEFT JOIN oauth_clients c ON c.id = g.client_id`;

export interface NewToken {
  id: string;
  userId: string;
  kind: TokenKind;
  name: string;
  tokenHash: string;
  hint: string;
  scopes: string[];
  resource: string | null;
  grantId: string | null;
  issuedVia: string;
  createdAt: number;
  expiresAt: number | null;
}

export async function insertToken(t: NewToken): Promise<void> {
  await query(
    `INSERT INTO api_tokens (id, user_id, kind, name, token_hash, hint, scopes, resource, grant_id, issued_via, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [t.id, t.userId, t.kind, t.name, t.tokenHash, t.hint, t.scopes.join(' '), t.resource, t.grantId, t.issuedVia, new Date(t.createdAt), d(t.expiresAt)],
  );
}

export async function tokenByHash(tokenHash: string): Promise<TokenRow | null> {
  const r = await one<TokenDbRow>(`${TOKEN_SELECT} WHERE t.token_hash = $1`, [tokenHash]);
  return r ? toToken(r) : null;
}

export async function personalTokensOf(userId: string): Promise<TokenRow[]> {
  return (await query<TokenDbRow>(`${TOKEN_SELECT} WHERE t.user_id = $1 AND t.kind = 'personal' ORDER BY t.created_at DESC`, [userId])).map(toToken);
}

export async function countPersonalTokens(userId: string): Promise<number> {
  return Number((await one<{ n: string }>(`SELECT count(*) AS n FROM api_tokens WHERE user_id = $1 AND kind = 'personal'`, [userId]))?.n ?? 0);
}

/** Per-owner lock for the token count (two parallel creates can't both pass the limit). */
export async function lockTokenQuota(userId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('apiauth.tokens'), hashtext($1))`, [userId]);
}

export async function personalToken(userId: string, id: string): Promise<TokenRow | null> {
  const r = await one<TokenDbRow>(`${TOKEN_SELECT} WHERE t.id = $1 AND t.user_id = $2 AND t.kind = 'personal'`, [id, userId]);
  return r ? toToken(r) : null;
}

export async function setPaused(userId: string, id: string, pausedAt: number | null): Promise<boolean> {
  const r = await query(`UPDATE api_tokens SET paused_at = $3 WHERE id = $1 AND user_id = $2 AND kind = 'personal' RETURNING id`, [id, userId, d(pausedAt)]);
  return r.length > 0;
}

/** Deletes a personal token (and where it was seen); false when it isn't the user's. */
export async function deletePersonalToken(userId: string, id: string): Promise<TokenRow | null> {
  const r = await one<TokenDbRow>(
    `DELETE FROM api_tokens t WHERE t.id = $1 AND t.user_id = $2 AND t.kind = 'personal'
     RETURNING t.*, NULL::text AS client_id, NULL::text AS client_name`,
    [id, userId],
  );
  if (r) await query(`DELETE FROM api_workspace_credentials WHERE credential_id = $1`, [id]);
  return r ? toToken(r) : null;
}

/** Records use (the caller throttles). */
export async function touchToken(id: string, grantId: string | null, at: number): Promise<void> {
  await query(`UPDATE api_tokens SET last_used_at = $2 WHERE id = $1`, [id, new Date(at)]);
  if (grantId) await query(`UPDATE oauth_grants SET last_used_at = $2 WHERE id = $1`, [grantId, new Date(at)]);
}

/**
 * Marks a refresh token used, once: the rotation step. Null when it was already used (replayed:
 * someone else holds a copy) or doesn't exist.
 */
export async function useRefreshToken(tokenHash: string, at: number): Promise<TokenRow | null> {
  const r = await one<{ id: string }>(`UPDATE api_tokens SET used_at = $2 WHERE token_hash = $1 AND kind = 'refresh' AND used_at IS NULL RETURNING id`, [
    tokenHash,
    new Date(at),
  ]);
  if (!r) return null;
  const row = await one<TokenDbRow>(`${TOKEN_SELECT} WHERE t.id = $1`, [r.id]);
  return row ? toToken(row) : null;
}

/** Deletes one token by its hash, if it belongs to an app grant of `clientId`; returns it. */
export async function deleteAppToken(tokenHash: string, clientId: string): Promise<TokenRow | null> {
  const row = await tokenByHash(tokenHash);
  if (!row || row.clientId !== clientId) return null;
  await query(`DELETE FROM api_tokens WHERE id = $1`, [row.id]);
  return row;
}

export async function deleteTokensOfGrant(grantId: string): Promise<void> {
  await query(`DELETE FROM api_tokens WHERE grant_id = $1`, [grantId]);
}

/** Every personal token and app consent of the user (their tokens go with them). Returns the counts. */
export async function deleteAllOf(userId: string): Promise<{ tokens: number; apps: number }> {
  const tokens = await query<{ id: string }>(`DELETE FROM api_tokens WHERE user_id = $1 AND kind = 'personal' RETURNING id`, [userId]);
  const apps = await query<{ id: string }>(`DELETE FROM oauth_grants WHERE user_id = $1 RETURNING id`, [userId]);
  await query(`DELETE FROM api_tokens WHERE user_id = $1`, [userId]);
  if (tokens.length) await query(`DELETE FROM api_workspace_credentials WHERE credential_id = ANY($1::text[])`, [tokens.map((t) => t.id)]);
  return { tokens: tokens.length, apps: apps.length };
}

// ---- OAuth clients ----

export interface ClientRow {
  id: string;
  name: string;
  website: string | null;
  redirectUris: string[];
  ownerId: string | null;
  secretHash: string | null;
  createdAt: number;
}
interface ClientDbRow {
  id: string;
  name: string;
  website: string | null;
  redirect_uris: string;
  owner_id: string | null;
  secret_hash: string | null;
  created_at: Date;
}
const toClient = (r: ClientDbRow): ClientRow => ({
  id: r.id,
  name: r.name,
  website: r.website,
  redirectUris: JSON.parse(r.redirect_uris) as string[],
  ownerId: r.owner_id,
  secretHash: r.secret_hash,
  createdAt: r.created_at.getTime(),
});

export async function insertClient(c: ClientRow): Promise<void> {
  await query(`INSERT INTO oauth_clients (id, name, website, redirect_uris, owner_id, secret_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    c.id,
    c.name,
    c.website,
    JSON.stringify(c.redirectUris),
    c.ownerId,
    c.secretHash,
    new Date(c.createdAt),
  ]);
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const r = await one<ClientDbRow>(`SELECT * FROM oauth_clients WHERE id = $1`, [id]);
  return r ? toClient(r) : null;
}

export async function clientsOwnedBy(userId: string): Promise<Array<ClientRow & { users: number }>> {
  const rows = await query<ClientDbRow & { users: string }>(
    `SELECT c.*, (SELECT count(*) FROM oauth_grants g WHERE g.client_id = c.id) AS users
     FROM oauth_clients c WHERE c.owner_id = $1 ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...toClient(r), users: Number(r.users) }));
}

export async function countClientsOwnedBy(userId: string): Promise<number> {
  return Number((await one<{ n: string }>(`SELECT count(*) AS n FROM oauth_clients WHERE owner_id = $1`, [userId]))?.n ?? 0);
}

export async function deleteOwnedClient(userId: string, id: string): Promise<ClientRow | null> {
  const r = await one<ClientDbRow>(`DELETE FROM oauth_clients WHERE id = $1 AND owner_id = $2 RETURNING *`, [id, userId]);
  return r ? toClient(r) : null;
}

/** Self-registered apps nobody authorised within `olderThan` (abandoned registrations). */
export async function deleteUnusedDynamicClients(olderThan: number): Promise<number> {
  const r = await query(
    `DELETE FROM oauth_clients c WHERE c.owner_id IS NULL AND c.created_at < $1
       AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id) RETURNING id`,
    [new Date(olderThan)],
  );
  return r.length;
}

// ---- grants and codes ----

export interface GrantRow {
  id: string;
  clientId: string;
  userId: string;
  scopes: string[];
  resource: string;
  issuedVia: string;
  createdAt: number;
  lastUsedAt: number | null;
}
interface GrantDbRow {
  id: string;
  client_id: string;
  user_id: string;
  scopes: string;
  resource: string;
  issued_via: string;
  created_at: Date;
  last_used_at: Date | null;
}
const toGrant = (r: GrantDbRow): GrantRow => ({
  id: r.id,
  clientId: r.client_id,
  userId: r.user_id,
  scopes: splitScopes(r.scopes),
  resource: r.resource,
  issuedVia: r.issued_via,
  createdAt: r.created_at.getTime(),
  lastUsedAt: ms(r.last_used_at),
});

/** The person's consent to the app (one per app and person): replaced by a newer consent. */
export async function upsertGrant(g: { id: string; clientId: string; userId: string; scopes: string[]; resource: string; issuedVia: string; at: number }): Promise<GrantRow> {
  const r = await one<GrantDbRow>(
    `INSERT INTO oauth_grants (id, client_id, user_id, scopes, resource, issued_via, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id, user_id) DO UPDATE SET scopes = EXCLUDED.scopes, resource = EXCLUDED.resource,
       issued_via = EXCLUDED.issued_via, created_at = EXCLUDED.created_at
     RETURNING *`,
    [g.id, g.clientId, g.userId, g.scopes.join(' '), g.resource, g.issuedVia, new Date(g.at)],
  );
  return toGrant(r!);
}

export async function getGrant(id: string): Promise<GrantRow | null> {
  const r = await one<GrantDbRow>(`SELECT * FROM oauth_grants WHERE id = $1`, [id]);
  return r ? toGrant(r) : null;
}

export async function grantsOf(userId: string): Promise<Array<GrantRow & { client: ClientRow }>> {
  const rows = await query<GrantDbRow & { c_id: string; c_name: string; c_website: string | null; c_redirect_uris: string; c_owner_id: string | null; c_secret_hash: string | null; c_created_at: Date }>(
    `SELECT g.*, c.id AS c_id, c.name AS c_name, c.website AS c_website, c.redirect_uris AS c_redirect_uris, c.owner_id AS c_owner_id,
            c.secret_hash AS c_secret_hash, c.created_at AS c_created_at
     FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id WHERE g.user_id = $1 ORDER BY g.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    ...toGrant(r),
    client: toClient({ id: r.c_id, name: r.c_name, website: r.c_website, redirect_uris: r.c_redirect_uris, owner_id: r.c_owner_id, secret_hash: r.c_secret_hash, created_at: r.c_created_at }),
  }));
}

export async function deleteGrant(userId: string, clientId: string): Promise<GrantRow | null> {
  const r = await one<GrantDbRow>(`DELETE FROM oauth_grants WHERE user_id = $1 AND client_id = $2 RETURNING *`, [userId, clientId]);
  return r ? toGrant(r) : null;
}

export async function deleteGrantById(id: string): Promise<void> {
  await query(`DELETE FROM oauth_grants WHERE id = $1`, [id]);
}

export interface CodeRow {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
  codeChallenge: string;
  issuedVia: string;
  expiresAt: number;
}

export async function insertCode(codeHash: string, c: CodeRow): Promise<void> {
  await query(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scopes, resource, code_challenge, issued_via, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [codeHash, c.clientId, c.userId, c.redirectUri, c.scopes.join(' '), c.resource, c.codeChallenge, c.issuedVia, new Date(c.expiresAt)],
  );
}

/** Redeems a code: deleted in the same statement, so it works once. */
export async function takeCode(codeHash: string): Promise<CodeRow | null> {
  const r = await one<{ client_id: string; user_id: string; redirect_uri: string; scopes: string; resource: string; code_challenge: string; issued_via: string; expires_at: Date }>(
    `DELETE FROM oauth_codes WHERE code_hash = $1 RETURNING *`,
    [codeHash],
  );
  return r
    ? {
        clientId: r.client_id,
        userId: r.user_id,
        redirectUri: r.redirect_uri,
        scopes: splitScopes(r.scopes),
        resource: r.resource,
        codeChallenge: r.code_challenge,
        issuedVia: r.issued_via,
        expiresAt: r.expires_at.getTime(),
      }
    : null;
}

/** Expired codes and tokens (refresh tokens: also used ones past their life). */
export async function deleteExpired(now: number): Promise<number> {
  const codes = await query(`DELETE FROM oauth_codes WHERE expires_at < $1 RETURNING code_hash`, [new Date(now)]);
  const tokens = await query(`DELETE FROM api_tokens WHERE expires_at < $1 RETURNING id`, [new Date(now)]);
  return codes.length + tokens.length;
}

// ---- workspaces ----

export async function workspaceApiEnabled(workspaceId: string): Promise<boolean> {
  return (await one<{ enabled: boolean }>(`SELECT enabled FROM api_workspace_settings WHERE workspace_id = $1`, [workspaceId]))?.enabled ?? true;
}

export async function setWorkspaceApiEnabled(workspaceId: string, enabled: boolean, by: string, at: number): Promise<boolean> {
  const before = await workspaceApiEnabled(workspaceId);
  await query(
    `INSERT INTO api_workspace_settings (workspace_id, enabled, updated_at, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [workspaceId, enabled, new Date(at), by],
  );
  return before !== enabled;
}

/** Records that a credential reached the workspace; returns whether an admin blocked it there. */
export async function noteWorkspaceUse(u: { workspaceId: string; credentialId: string; userId: string; kind: string; label: string; scopes: string[]; at: number }): Promise<boolean> {
  const r = await one<{ blocked_at: Date | null }>(
    `INSERT INTO api_workspace_credentials (workspace_id, credential_id, user_id, kind, label, scopes, first_used_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (workspace_id, credential_id) DO UPDATE SET last_used_at = EXCLUDED.last_used_at, label = EXCLUDED.label, scopes = EXCLUDED.scopes
     RETURNING blocked_at`,
    [u.workspaceId, u.credentialId, u.userId, u.kind, u.label, u.scopes.join(' '), new Date(u.at)],
  );
  return !!r?.blocked_at;
}

export interface WorkspaceCredentialRow {
  credentialId: string;
  userId: string;
  kind: 'personal' | 'oauth';
  label: string;
  scopes: string[];
  firstUsedAt: number;
  lastUsedAt: number;
  blocked: boolean;
}

export async function workspaceCredentials(workspaceId: string): Promise<WorkspaceCredentialRow[]> {
  const rows = await query<{ credential_id: string; user_id: string; kind: 'personal' | 'oauth'; label: string; scopes: string; first_used_at: Date; last_used_at: Date; blocked_at: Date | null }>(
    `SELECT * FROM api_workspace_credentials WHERE workspace_id = $1 ORDER BY last_used_at DESC LIMIT 500`,
    [workspaceId],
  );
  return rows.map((r) => ({
    credentialId: r.credential_id,
    userId: r.user_id,
    kind: r.kind,
    label: r.label,
    scopes: splitScopes(r.scopes),
    firstUsedAt: r.first_used_at.getTime(),
    lastUsedAt: r.last_used_at.getTime(),
    blocked: r.blocked_at !== null,
  }));
}

/** Blocks / unblocks a credential in the workspace; null when it never reached it. */
export async function setWorkspaceCredentialBlocked(workspaceId: string, credentialId: string, blocked: boolean, by: string, at: number): Promise<WorkspaceCredentialRow | null> {
  const r = await query<{ credential_id: string }>(
    `UPDATE api_workspace_credentials SET blocked_at = $3, blocked_by = $4 WHERE workspace_id = $1 AND credential_id = $2 RETURNING credential_id`,
    [workspaceId, credentialId, blocked ? new Date(at) : null, blocked ? by : null],
  );
  if (!r.length) return null;
  return (await workspaceCredentials(workspaceId)).find((c) => c.credentialId === credentialId) ?? null;
}

// ---- data export (GDPR) ----

export async function grantsAndTokensForExport(userId: string) {
  return { tokens: await personalTokensOf(userId), apps: await grantsOf(userId), clients: await clientsOwnedBy(userId) };
}
