// The only writer of `sso_domains`, `sso_connections`, `sso_flows`, `sso_saml_cache`, `sso_sp_keys`
// and `sso_sessions` [S4].
import type { DirectoryRole } from '../workspaces/index';
import { isUniqueViolation, one, query, tx } from '../../platform/db';

/** Runs fn in one transaction (a change and its audit record commit together). */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

// ---- domains ----

export interface DomainRecord {
  id: string;
  workspaceId: string;
  domain: string;
  token: string;
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  createdAt: number;
}
interface DomainRow {
  id: string;
  workspace_id: string;
  domain: string;
  token: string;
  verified_at: Date | null;
  last_checked_at: Date | null;
  created_at: Date;
}
const toDomain = (r: DomainRow): DomainRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  domain: r.domain,
  token: r.token,
  verifiedAt: r.verified_at?.getTime() ?? null,
  lastCheckedAt: r.last_checked_at?.getTime() ?? null,
  createdAt: r.created_at.getTime(),
});

export class DomainTakenError extends Error {}

/** Adds a claim; returns false when the workspace already claims that domain. */
export async function insertDomain(d: { id: string; workspaceId: string; domain: string; token: string; now: number }): Promise<boolean> {
  try {
    await query(`INSERT INTO sso_domains (id, workspace_id, domain, token, created_at) VALUES ($1, $2, $3, $4, $5)`, [
      d.id,
      d.workspaceId,
      d.domain,
      d.token,
      new Date(d.now),
    ]);
    return true;
  } catch (e) {
    if (isUniqueViolation(e, 'sso_domains_workspace_domain_key')) return false;
    throw e;
  }
}

export async function listDomains(workspaceId: string): Promise<DomainRecord[]> {
  return (await query<DomainRow>(`SELECT * FROM sso_domains WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toDomain);
}

export async function getDomain(workspaceId: string, id: string): Promise<DomainRecord | null> {
  const r = await one<DomainRow>(`SELECT * FROM sso_domains WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
  return r ? toDomain(r) : null;
}

/** The verified claim of a domain (at most one exists), or null. */
export async function verifiedDomain(domain: string): Promise<DomainRecord | null> {
  const r = await one<DomainRow>(`SELECT * FROM sso_domains WHERE domain = $1 AND verified_at IS NOT NULL`, [domain]);
  return r ? toDomain(r) : null;
}

/** Marks a claim verified (DNS proved it). Throws DomainTakenError if another workspace holds it verified. */
export async function markDomainVerified(id: string, now: number): Promise<void> {
  try {
    await query(`UPDATE sso_domains SET verified_at = COALESCE(verified_at, $2), last_checked_at = $2 WHERE id = $1`, [id, new Date(now)]);
  } catch (e) {
    if (isUniqueViolation(e, 'sso_domains_verified_key')) throw new DomainTakenError();
    throw e;
  }
}

export async function markDomainChecked(id: string, now: number): Promise<void> {
  await query(`UPDATE sso_domains SET last_checked_at = $2 WHERE id = $1`, [id, new Date(now)]);
}

export async function deleteDomain(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM sso_domains WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, id])).length > 0;
}

// ---- connections ----

export type Protocol = 'saml' | 'oidc';

export interface ConnectionRecord {
  workspaceId: string;
  protocol: Protocol;
  enabled: boolean;
  enforced: boolean;
  breakGlassUserId: string | null;
  defaultRole: DirectoryRole;
  samlEntityId: string | null;
  samlSsoUrl: string | null;
  samlCerts: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  /** Sealed. */
  oidcClientSecret: string | null;
  testedAt: number | null;
  /** SAML: unsolicited (IdP-initiated) responses are accepted. */
  idpInitiated: boolean;
  /** SAML (#13): the IdP's SingleLogoutService. */
  samlSloUrl: string | null;
  /** SAML (#13): assertions must arrive encrypted. */
  requireEncrypted: boolean;
  /** SAML (#13): AuthnRequests and logout messages are signed with the current SP key. */
  signRequests: boolean;
  createdAt: number;
  updatedAt: number;
}
interface ConnectionRow {
  workspace_id: string;
  protocol: Protocol;
  enabled: boolean;
  enforced: boolean;
  break_glass_user_id: string | null;
  default_role: DirectoryRole;
  saml_entity_id: string | null;
  saml_sso_url: string | null;
  saml_certs: string | null;
  oidc_issuer: string | null;
  oidc_client_id: string | null;
  oidc_client_secret: string | null;
  tested_at: Date | null;
  idp_initiated: boolean;
  saml_slo_url: string | null;
  require_encrypted: boolean;
  sign_requests: boolean;
  created_at: Date;
  updated_at: Date;
}
const toConnection = (r: ConnectionRow): ConnectionRecord => ({
  workspaceId: r.workspace_id,
  protocol: r.protocol,
  enabled: r.enabled,
  enforced: r.enforced,
  breakGlassUserId: r.break_glass_user_id,
  defaultRole: r.default_role,
  samlEntityId: r.saml_entity_id,
  samlSsoUrl: r.saml_sso_url,
  samlCerts: r.saml_certs,
  oidcIssuer: r.oidc_issuer,
  oidcClientId: r.oidc_client_id,
  oidcClientSecret: r.oidc_client_secret,
  testedAt: r.tested_at?.getTime() ?? null,
  idpInitiated: r.idp_initiated,
  samlSloUrl: r.saml_slo_url,
  requireEncrypted: r.require_encrypted,
  signRequests: r.sign_requests,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

export async function getConnection(workspaceId: string): Promise<ConnectionRecord | null> {
  const r = await one<ConnectionRow>(`SELECT * FROM sso_connections WHERE workspace_id = $1`, [workspaceId]);
  return r ? toConnection(r) : null;
}

/**
 * Creates or replaces the connection's settings in one statement (enforcement is set apart, by
 * setEnforced). Changing the protocol or the identity provider (`providerChanged`) forgets
 * `tested_at` and turns enforcement off, as does disabling the connection: a provider has to prove
 * itself with a real sign-in before people can be locked to it.
 */
export async function saveConnection(
  c: Omit<ConnectionRecord, 'enforced' | 'breakGlassUserId' | 'testedAt' | 'createdAt' | 'updatedAt'>,
  providerChanged: boolean,
  now: number,
): Promise<void> {
  await query(
    `INSERT INTO sso_connections (workspace_id, protocol, enabled, default_role,
       saml_entity_id, saml_sso_url, saml_certs, oidc_issuer, oidc_client_id, oidc_client_secret, created_at, updated_at, idp_initiated,
       saml_slo_url, require_encrypted, sign_requests)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $13, $14, $15, $16)
     ON CONFLICT (workspace_id) DO UPDATE SET
       protocol = excluded.protocol, enabled = excluded.enabled,
       enforced = sso_connections.enforced AND excluded.enabled AND NOT $12::boolean,
       default_role = excluded.default_role,
       saml_entity_id = excluded.saml_entity_id, saml_sso_url = excluded.saml_sso_url,
       saml_certs = excluded.saml_certs, oidc_issuer = excluded.oidc_issuer, oidc_client_id = excluded.oidc_client_id,
       oidc_client_secret = excluded.oidc_client_secret,
       idp_initiated = excluded.idp_initiated,
       saml_slo_url = excluded.saml_slo_url, require_encrypted = excluded.require_encrypted, sign_requests = excluded.sign_requests,
       tested_at = CASE WHEN $12::boolean THEN NULL ELSE sso_connections.tested_at END,
       updated_at = excluded.updated_at`,
    [
      c.workspaceId,
      c.protocol,
      c.enabled,
      c.defaultRole,
      c.samlEntityId,
      c.samlSsoUrl,
      c.samlCerts,
      c.oidcIssuer,
      c.oidcClientId,
      c.oidcClientSecret,
      new Date(now),
      providerChanged,
      c.idpInitiated,
      c.samlSloUrl,
      c.requireEncrypted,
      c.signRequests,
    ],
  );
}

/** Sets enforcement only if a sign-in has gone through the connection (one statement). */
export async function setEnforced(workspaceId: string, enforced: boolean, breakGlassUserId: string | null, now: number): Promise<boolean> {
  const rows = await query(
    `UPDATE sso_connections SET enforced = $2, break_glass_user_id = $3, updated_at = $4
     WHERE workspace_id = $1 AND (NOT $2 OR (enabled AND tested_at IS NOT NULL)) RETURNING 1`,
    [workspaceId, enforced, breakGlassUserId, new Date(now)],
  );
  return rows.length > 0;
}

/**
 * A sign-in went through the connection as it was at `seenUpdatedAt` (when its answer was
 * validated): marks it tested only if it was not saved since — a provider an admin switched to
 * meanwhile has proven nothing.
 */
export async function markTested(workspaceId: string, now: number, seenUpdatedAt: number): Promise<void> {
  await query(`UPDATE sso_connections SET tested_at = $2 WHERE workspace_id = $1 AND updated_at = $3`, [workspaceId, new Date(now), new Date(seenUpdatedAt)]);
}

export async function resealClientSecret(workspaceId: string, sealed: string, resealed: string): Promise<void> {
  await query(`UPDATE sso_connections SET oidc_client_secret = $3 WHERE workspace_id = $1 AND oidc_client_secret = $2`, [workspaceId, sealed, resealed]);
}

export async function deleteConnection(workspaceId: string): Promise<boolean> {
  return (await query(`DELETE FROM sso_connections WHERE workspace_id = $1 RETURNING 1`, [workspaceId])).length > 0;
}

/**
 * The enabled connection of the workspace that holds `domain` verified, with the workspace id —
 * how sign-ins are routed and whether "Enforce SSO" applies to an address.
 */
export async function connectionForDomain(domain: string): Promise<ConnectionRecord | null> {
  const r = await one<ConnectionRow>(
    `SELECT c.* FROM sso_domains d JOIN sso_connections c ON c.workspace_id = d.workspace_id
     WHERE d.domain = $1 AND d.verified_at IS NOT NULL AND c.enabled`,
    [domain],
  );
  return r ? toConnection(r) : null;
}

// ---- flows ----

export interface FlowRecord {
  id: string;
  workspaceId: string;
  protocol: Protocol;
  browserHash: string;
  stateHash: string | null;
  requestId: string | null;
  nonce: string | null;
  codeVerifier: string | null;
  returnTo: string;
  result: unknown;
}
interface FlowRow {
  id: string;
  workspace_id: string;
  protocol: Protocol;
  browser_hash: string;
  state_hash: string | null;
  request_id: string | null;
  nonce: string | null;
  code_verifier: string | null;
  return_to: string;
  result: unknown;
}
const toFlow = (r: FlowRow): FlowRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  protocol: r.protocol,
  browserHash: r.browser_hash,
  stateHash: r.state_hash,
  requestId: r.request_id,
  nonce: r.nonce,
  codeVerifier: r.code_verifier,
  returnTo: r.return_to,
  result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result,
});

export async function insertFlow(f: Omit<FlowRecord, 'result'>, now: number, expiresAt: number): Promise<void> {
  await query(
    `INSERT INTO sso_flows (id, workspace_id, protocol, browser_hash, state_hash, request_id, nonce, code_verifier, return_to, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [f.id, f.workspaceId, f.protocol, f.browserHash, f.stateHash, f.requestId, f.nonce, f.codeVerifier, f.returnTo, new Date(now), new Date(expiresAt)],
  );
}

/** A SAML flow waiting for its response: records the verified claims (once; false if it is gone, used or expired). */
export async function recordSamlResult(workspaceId: string, id: string, requestId: string, result: unknown, now: number): Promise<boolean> {
  const rows = await query(
    `UPDATE sso_flows SET result = $4 WHERE workspace_id = $1 AND id = $2 AND protocol = 'saml' AND request_id = $3
       AND result IS NULL AND expires_at > $5 RETURNING 1`,
    [workspaceId, id, requestId, JSON.stringify(result), new Date(now)],
  );
  return rows.length > 0;
}

/**
 * An IdP-initiated sign-in: nobody started it here, so the verified claims arrive with the flow —
 * bound to the browser the identity provider's page posted from (the cookie set on that answer).
 */
export async function insertAnsweredSamlFlow(
  f: { id: string; workspaceId: string; browserHash: string; returnTo: string },
  result: unknown,
  now: number,
  expiresAt: number,
): Promise<void> {
  await query(
    `INSERT INTO sso_flows (id, workspace_id, protocol, browser_hash, return_to, result, created_at, expires_at)
     VALUES ($1, $2, 'saml', $3, $4, $5, $6, $7)`,
    [f.id, f.workspaceId, f.browserHash, f.returnTo, JSON.stringify(result), new Date(now), new Date(expiresAt)],
  );
}

/** Uses up a SAML flow that has its result, if this browser started it. */
export async function takeSamlFlow(workspaceId: string, id: string, browserHash: string, now: number): Promise<FlowRecord | null> {
  const r = await one<FlowRow>(
    `DELETE FROM sso_flows WHERE workspace_id = $1 AND id = $2 AND browser_hash = $3 AND protocol = 'saml'
       AND result IS NOT NULL AND expires_at > $4 RETURNING *`,
    [workspaceId, id, browserHash, new Date(now)],
  );
  return r ? toFlow(r) : null;
}

/** Uses up an OIDC flow by its state, if this browser started it. */
export async function takeOidcFlow(workspaceId: string, stateHash: string, browserHash: string, now: number): Promise<FlowRecord | null> {
  const r = await one<FlowRow>(
    `DELETE FROM sso_flows WHERE workspace_id = $1 AND state_hash = $2 AND browser_hash = $3 AND protocol = 'oidc'
       AND expires_at > $4 RETURNING *`,
    [workspaceId, stateHash, browserHash, new Date(now)],
  );
  return r ? toFlow(r) : null;
}

export async function deleteExpired(now: number): Promise<void> {
  await query(`DELETE FROM sso_flows WHERE expires_at <= $1`, [new Date(now)]);
  await query(`DELETE FROM sso_saml_cache WHERE expires_at <= $1`, [new Date(now)]);
}

// ---- node-saml cache (per workspace) ----

export async function cacheSave(workspaceId: string, key: string, value: string, expiresAt: number): Promise<void> {
  await query(
    `INSERT INTO sso_saml_cache (workspace_id, key, value, expires_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    [workspaceId, key, value, new Date(expiresAt)],
  );
}

export async function cacheGet(workspaceId: string, key: string, now: number): Promise<string | null> {
  return (await one<{ value: string }>(`SELECT value FROM sso_saml_cache WHERE workspace_id = $1 AND key = $2 AND expires_at > $3`, [workspaceId, key, new Date(now)]))?.value ?? null;
}

/** Removes the key and returns its (unexpired) value, in one statement. */
export async function cacheTake(workspaceId: string, key: string, now: number): Promise<string | null> {
  const r = await one<{ value: string; expires_at: Date }>(`DELETE FROM sso_saml_cache WHERE workspace_id = $1 AND key = $2 RETURNING value, expires_at`, [workspaceId, key]);
  return r && r.expires_at.getTime() > now ? r.value : null;
}

/** Saves the key unless an unexpired one exists, in one statement; true when saved. */
export async function cacheSaveIfAbsent(workspaceId: string, key: string, value: string, expiresAt: number, now: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO sso_saml_cache (workspace_id, key, value, expires_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
       WHERE sso_saml_cache.expires_at <= $5
     RETURNING 1`,
    [workspaceId, key, value, new Date(expiresAt), new Date(now)],
  );
  return rows.length > 0;
}

// ---- the SAML service provider's key pairs (#13) ----

export interface SpKeyRecord {
  id: string;
  workspaceId: string;
  /** Sealed. */
  privateKey: string;
  certificate: string;
  current: boolean;
  createdAt: number;
}
interface SpKeyRow {
  id: string;
  workspace_id: string;
  private_key: string;
  certificate: string;
  current: boolean;
  created_at: Date;
}
const toSpKey = (r: SpKeyRow): SpKeyRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  privateKey: r.private_key,
  certificate: r.certificate,
  current: r.current,
  createdAt: r.created_at.getTime(),
});

export async function listSpKeys(workspaceId: string): Promise<SpKeyRecord[]> {
  return (await query<SpKeyRow>(`SELECT * FROM sso_sp_keys WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toSpKey);
}

/** The workspace's keys, locked for the caller's transaction (key changes are serialized per workspace). */
export async function lockSpKeys(workspaceId: string): Promise<SpKeyRecord[]> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('sso.sp_keys'), hashtext($1))`, [workspaceId]);
  return listSpKeys(workspaceId);
}

export async function insertSpKey(k: Omit<SpKeyRecord, 'createdAt'>, now: number): Promise<void> {
  await query(`INSERT INTO sso_sp_keys (id, workspace_id, private_key, certificate, current, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    k.id,
    k.workspaceId,
    k.privateKey,
    k.certificate,
    k.current,
    new Date(now),
  ]);
}

/** Makes one key current and the others not, in one statement. */
export async function makeSpKeyCurrent(workspaceId: string, keyId: string): Promise<void> {
  await query(`UPDATE sso_sp_keys SET current = false WHERE workspace_id = $1 AND current AND id <> $2`, [workspaceId, keyId]);
  await query(`UPDATE sso_sp_keys SET current = true WHERE workspace_id = $1 AND id = $2`, [workspaceId, keyId]);
}

export async function deleteSpKey(workspaceId: string, keyId: string): Promise<boolean> {
  return (await query(`DELETE FROM sso_sp_keys WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, keyId])).length > 0;
}

export async function resealSpKey(id: string, sealed: string, resealed: string): Promise<void> {
  await query(`UPDATE sso_sp_keys SET private_key = $3 WHERE id = $1 AND private_key = $2`, [id, sealed, resealed]);
}

// ---- sessions a SAML sign-in started (#13, single logout) ----

export interface SamlSessionRecord {
  sessionKey: string;
  workspaceId: string;
  nameId: string;
  nameIdFormat: string | null;
  sessionIndex: string | null;
}

export async function insertSamlSession(s: SamlSessionRecord, now: number): Promise<void> {
  await query(
    `INSERT INTO sso_sessions (session_key, workspace_id, name_id, name_id_format, session_index, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [s.sessionKey, s.workspaceId, s.nameId, s.nameIdFormat, s.sessionIndex, new Date(now)],
  );
}

export async function getSamlSession(sessionKey: string): Promise<SamlSessionRecord | null> {
  const r = await one<{ session_key: string; workspace_id: string; name_id: string; name_id_format: string | null; session_index: string | null }>(
    `SELECT * FROM sso_sessions WHERE session_key = $1`,
    [sessionKey],
  );
  return r ? { sessionKey: r.session_key, workspaceId: r.workspace_id, nameId: r.name_id, nameIdFormat: r.name_id_format, sessionIndex: r.session_index } : null;
}

/** Keys of the sessions this workspace's SAML sign-in started for `nameId` (and `sessionIndex`, when given). */
export async function samlSessionKeys(workspaceId: string, nameId: string, sessionIndex: string | null): Promise<string[]> {
  return (
    await query<{ session_key: string }>(
      `SELECT session_key FROM sso_sessions WHERE workspace_id = $1 AND name_id = $2 AND ($3::text IS NULL OR session_index = $3)`,
      [workspaceId, nameId, sessionIndex],
    )
  ).map((r) => r.session_key);
}

// ---- domain control (#64) ----

export interface DomainPolicy {
  captureSignups: boolean;
  blockWorkspaces: boolean;
}

export async function getDomainPolicy(workspaceId: string): Promise<DomainPolicy> {
  const r = await one<{ capture_signups: boolean; block_workspaces: boolean }>(
    `SELECT capture_signups, block_workspaces FROM sso_domain_policies WHERE workspace_id = $1`,
    [workspaceId],
  );
  return { captureSignups: r?.capture_signups ?? false, blockWorkspaces: r?.block_workspaces ?? false };
}

export async function saveDomainPolicy(workspaceId: string, p: DomainPolicy, now: number): Promise<void> {
  await query(
    `INSERT INTO sso_domain_policies (workspace_id, capture_signups, block_workspaces, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id) DO UPDATE SET capture_signups = excluded.capture_signups,
       block_workspaces = excluded.block_workspaces, updated_at = excluded.updated_at`,
    [workspaceId, p.captureSignups, p.blockWorkspaces, new Date(now)],
  );
}

/** The workspace that holds `domain` verified, with its domain policy — or null. */
export async function domainOwner(domain: string): Promise<({ workspaceId: string } & DomainPolicy) | null> {
  const r = await one<{ workspace_id: string; capture_signups: boolean | null; block_workspaces: boolean | null }>(
    `SELECT d.workspace_id, p.capture_signups, p.block_workspaces FROM sso_domains d
     LEFT JOIN sso_domain_policies p ON p.workspace_id = d.workspace_id
     WHERE d.domain = $1 AND d.verified_at IS NOT NULL`,
    [domain],
  );
  return r ? { workspaceId: r.workspace_id, captureSignups: r.capture_signups ?? false, blockWorkspaces: r.block_workspaces ?? false } : null;
}

export interface CaptureRecord {
  workspaceId: string;
  userId: string;
  email: string;
  joinsAt: number;
  startedBy: string | null;
}
interface CaptureRow {
  workspace_id: string;
  user_id: string;
  email: string;
  joins_at: Date;
  started_by: string | null;
}
const toCapture = (r: CaptureRow): CaptureRecord => ({
  workspaceId: r.workspace_id,
  userId: r.user_id,
  email: r.email,
  joinsAt: r.joins_at.getTime(),
  startedBy: r.started_by,
});

/** Starts a capture unless one is pending for that person here; true when started. */
export async function insertCapture(c: CaptureRecord, now: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO sso_domain_captures (workspace_id, user_id, email, joins_at, started_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, user_id) DO NOTHING RETURNING 1`,
    [c.workspaceId, c.userId, c.email, new Date(c.joinsAt), c.startedBy, new Date(now)],
  );
  return rows.length > 0;
}

export async function capturesOf(workspaceId: string): Promise<CaptureRecord[]> {
  return (await query<CaptureRow>(`SELECT * FROM sso_domain_captures WHERE workspace_id = $1`, [workspaceId])).map(toCapture);
}

/** Removes a pending capture (cancelled, joined or void); returns it, or null. */
export async function takeCapture(workspaceId: string, userId: string): Promise<CaptureRecord | null> {
  const r = await one<CaptureRow>(`DELETE FROM sso_domain_captures WHERE workspace_id = $1 AND user_id = $2 RETURNING *`, [workspaceId, userId]);
  return r ? toCapture(r) : null;
}

export async function dueCaptures(now: number, limit: number): Promise<CaptureRecord[]> {
  return (await query<CaptureRow>(`SELECT * FROM sso_domain_captures WHERE joins_at <= $1 ORDER BY joins_at LIMIT $2`, [new Date(now), limit])).map(toCapture);
}

export async function personalSsoData(userId: string): Promise<Array<{ workspaceId: string; breakGlass: boolean; joinsAt: number | null }>> {
  const [glass, captures] = await Promise.all([
    query<{ workspace_id: string }>(`SELECT workspace_id FROM sso_connections WHERE break_glass_user_id = $1`, [userId]),
    query<{ workspace_id: string; joins_at: Date }>(`SELECT workspace_id, joins_at FROM sso_domain_captures WHERE user_id = $1`, [userId]),
  ]);
  return [
    ...glass.map((r) => ({ workspaceId: r.workspace_id, breakGlass: true, joinsAt: null })),
    ...captures.map((r) => ({ workspaceId: r.workspace_id, breakGlass: false, joinsAt: r.joins_at.getTime() })),
  ];
}
