// The only writer of `users`, `sessions`, `auth_tokens`, `auth_identities`, `auth_oidc_flows`,
// `auth_challenges`, `user_totp` and `user_recovery_codes` [S4].
import type { Account } from '@freero/shared';
import { isUniqueViolation, one, query, tx } from '../../platform/db';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  color: string;
  avatar_url: string | null;
  created_at: Date;
  email_verified_at: Date | null;
  deletion_scheduled_for: Date | null;
}

export interface UserWithHash extends Account {
  /** null: the account signs in only through a provider (no password set yet). */
  passwordHash: string | null;
}

const toUser = (r: UserRow): UserWithHash => ({
  id: r.id,
  email: r.email,
  name: r.name,
  color: r.color,
  avatarUrl: r.avatar_url,
  createdAt: r.created_at.getTime(),
  emailVerified: r.email_verified_at !== null,
  deletionScheduledFor: r.deletion_scheduled_for?.getTime() ?? null,
  passwordHash: r.password_hash,
});

/** Thrown when an email is taken (possibly by a concurrent signup or email change). */
export class EmailTakenError extends Error {}

/** Inserts the user, and with `identity` the provider account it signs in with (atomically). */
export async function insertUser(u: UserWithHash, identity?: Omit<IdentityRecord, 'id' | 'userId' | 'createdAt' | 'lastUsedAt'> & { id: string }): Promise<void> {
  try {
    await tx(async () => {
      await query(
        `INSERT INTO users (id, email, name, password_hash, color, avatar_url, created_at, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [u.id, u.email, u.name, u.passwordHash, u.color, u.avatarUrl, new Date(u.createdAt), u.emailVerified ? new Date(u.createdAt) : null],
      );
      if (identity) await insertIdentity({ ...identity, userId: u.id, createdAt: u.createdAt });
    });
  } catch (e) {
    if (isUniqueViolation(e, 'users_email_key')) throw new EmailTakenError(u.email);
    throw e;
  }
}

export async function findUserById(id: string): Promise<UserWithHash | null> {
  const row = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  return row ? toUser(row) : null;
}

export async function findUsersByIds(ids: string[]): Promise<UserWithHash[]> {
  if (ids.length === 0) return [];
  return (await query<UserRow>(`SELECT * FROM users WHERE id = ANY($1::text[])`, [ids])).map(toUser);
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const row = await one<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);
  return row ? toUser(row) : null;
}

export async function countUsers(): Promise<number> {
  return (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`))!.n;
}

/** Changes only the given fields, in one statement (no read-modify-write that could drop a concurrent edit). */
export async function updateUserProfile(
  id: string,
  patch: { name?: string; color?: string; avatarUrl?: string | null },
): Promise<void> {
  await query(
    `UPDATE users SET name = COALESCE($2, name), color = COALESCE($3, color),
       avatar_url = CASE WHEN $4 THEN $5 ELSE avatar_url END
     WHERE id = $1`,
    [id, patch.name ?? null, patch.color ?? null, patch.avatarUrl !== undefined, patch.avatarUrl ?? null],
  );
}

/** Sets the avatar; returns the previous one (to delete its file), or undefined if no such user. */
export async function setAvatar(id: string, url: string | null): Promise<string | null | undefined> {
  const r = await one<{ previous: string | null }>(
    `UPDATE users u SET avatar_url = $2 FROM (SELECT avatar_url FROM users WHERE id = $1 FOR UPDATE) old
     WHERE u.id = $1 RETURNING old.avatar_url AS previous`,
    [id, url],
  );
  return r ? r.previous : undefined;
}

/** Marks the address verified, but only if it is still the account's address. */
export async function markEmailVerified(id: string, email: string, now: number): Promise<boolean> {
  const rows = await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, $3) WHERE id = $1 AND email = $2 RETURNING 1`,
    [id, email, new Date(now)],
  );
  return rows.length > 0;
}

/** Switches to a new (already proven) address. Throws EmailTakenError if someone has it. */
export async function changeEmail(id: string, email: string, now: number): Promise<boolean> {
  try {
    const rows = await query(`UPDATE users SET email = $2, email_verified_at = $3 WHERE id = $1 RETURNING 1`, [id, email, new Date(now)]);
    return rows.length > 0;
  } catch (e) {
    if (isUniqueViolation(e, 'users_email_key')) throw new EmailTakenError(email);
    throw e;
  }
}

export async function setPasswordHash(id: string, hash: string | null): Promise<void> {
  await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, hash]);
}

// ---- deletion ----

export async function scheduleDeletion(id: string, at: number): Promise<void> {
  await query(`UPDATE users SET deletion_scheduled_for = $2 WHERE id = $1`, [id, new Date(at)]);
}

/** Returns false if the account was not scheduled for deletion (or is gone). */
export async function cancelDeletion(id: string): Promise<boolean> {
  const rows = await query(
    `UPDATE users SET deletion_scheduled_for = NULL WHERE id = $1 AND deletion_scheduled_for IS NOT NULL RETURNING 1`,
    [id],
  );
  return rows.length > 0;
}

export async function usersDueForPurge(now: number, limit: number): Promise<UserWithHash[]> {
  return (
    await query<UserRow>(
      `SELECT * FROM users WHERE deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= $1
       ORDER BY deletion_scheduled_for LIMIT $2`,
      [new Date(now), limit],
    )
  ).map(toUser);
}

/**
 * Deletes the account if it is (still) due — a restore that won the race keeps it. Sessions,
 * tokens, memberships, stars, opens, upload rows and invites cascade.
 */
export async function deleteUserIfDue(id: string, now: number): Promise<boolean> {
  const rows = await query(
    `DELETE FROM users WHERE id = $1 AND deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= $2 RETURNING 1`,
    [id, new Date(now)],
  );
  return rows.length > 0;
}

// ---- sessions ----

interface SessionRow {
  id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string;
  ip: string;
  method: string;
  two_factor: boolean;
  auth_at: Date;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  ip: string;
  /** How it signed in: 'password', 'email_link' (password reset) or a provider id. */
  method: string;
  /** It passed a second step (authenticator code or recovery code). */
  twoFactor: boolean;
  /** When it last proved who it is (sign-in, or signing in with the provider again). */
  authAt: number;
}

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  tokenHash: r.token_hash,
  createdAt: r.created_at.getTime(),
  lastSeenAt: r.last_seen_at.getTime(),
  userAgent: r.user_agent,
  ip: r.ip,
  method: r.method,
  twoFactor: r.two_factor,
  authAt: r.auth_at.getTime(),
});

export async function insertSession(s: {
  id: string;
  tokenHash: string;
  userId: string;
  now: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
  method?: string;
  twoFactor?: boolean;
}): Promise<void> {
  await query(
    `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip, method, two_factor, auth_at)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $4)`,
    [s.id, s.tokenHash, s.userId, new Date(s.now), new Date(s.expiresAt), s.userAgent, s.ip, s.method ?? 'password', s.twoFactor ?? false],
  );
}

export async function findSessionUser(
  tokenHash: string,
  now: number,
): Promise<{ user: UserWithHash; sessionId: string; authAt: number } | null> {
  const row = await one<UserRow & { session_id: string; session_auth_at: Date }>(
    `SELECT u.*, s.id AS session_id, s.auth_at AS session_auth_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash, new Date(now)],
  );
  return row ? { user: toUser(row), sessionId: row.session_id, authAt: row.session_auth_at.getTime() } : null;
}

/** The session proved who it is again (signed in with its provider once more). */
export async function markSessionAuthenticated(tokenHash: string, userId: string, now: number): Promise<boolean> {
  const rows = await query(`UPDATE sessions SET auth_at = $3 WHERE token_hash = $1 AND user_id = $2 RETURNING 1`, [
    tokenHash,
    userId,
    new Date(now),
  ]);
  return rows.length > 0;
}

export async function touchSession(tokenHash: string, now: number): Promise<void> {
  await query(`UPDATE sessions SET last_seen_at = $2 WHERE token_hash = $1 AND last_seen_at < $2`, [tokenHash, new Date(now)]);
}

export async function listSessions(userId: string, now: number): Promise<SessionRecord[]> {
  return (
    await query<SessionRow>(`SELECT * FROM sessions WHERE user_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC`, [
      userId,
      new Date(now),
    ])
  ).map(toSession);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

/** Deletes one of the user's sessions by its public id; returns its token hash, or null. */
export async function deleteSessionById(userId: string, id: string): Promise<string | null> {
  const r = await one<{ token_hash: string }>(`DELETE FROM sessions WHERE user_id = $1 AND id = $2 RETURNING token_hash`, [userId, id]);
  return r?.token_hash ?? null;
}

/** Deletes every session of the user except `keepTokenHash`; returns the deleted token hashes. */
export async function deleteSessionsOf(userId: string, keepTokenHash: string | null = null): Promise<string[]> {
  const rows = await query<{ token_hash: string }>(
    `DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2) RETURNING token_hash`,
    [userId, keepTokenHash],
  );
  return rows.map((r) => r.token_hash);
}

export async function deleteExpiredSessions(now: number): Promise<void> {
  await query(`DELETE FROM sessions WHERE expires_at <= $1`, [new Date(now)]);
}

// ---- emailed tokens ----

export type TokenPurpose = 'verify_email' | 'change_email' | 'reset_password';

export async function insertToken(t: {
  tokenHash: string;
  userId: string;
  purpose: TokenPurpose;
  email: string;
  now: number;
  expiresAt: number;
}): Promise<void> {
  await query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, email, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [t.tokenHash, t.userId, t.purpose, t.email, new Date(t.now), new Date(t.expiresAt)],
  );
}

/**
 * Uses a token: deletes it and returns what it was for, if it was valid (right purpose, not
 * expired). One statement, so two concurrent uses cannot both succeed.
 */
export async function takeToken(tokenHash: string, purpose: TokenPurpose, now: number): Promise<{ userId: string; email: string } | null> {
  const r = await one<{ user_id: string; email: string; expires_at: Date }>(
    `DELETE FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 RETURNING user_id, email, expires_at`,
    [tokenHash, purpose],
  );
  if (!r || r.expires_at.getTime() <= now) return null;
  return { userId: r.user_id, email: r.email };
}

export async function deleteTokens(userId: string, purpose: TokenPurpose): Promise<void> {
  await query(`DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2`, [userId, purpose]);
}

export async function deleteExpiredTokens(now: number): Promise<void> {
  await query(`DELETE FROM auth_tokens WHERE expires_at <= $1`, [new Date(now)]);
}

// ---- sign-in provider identities ----

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  issuer: string;
  subject: string;
  email: string | null;
  email_verified: boolean;
  created_at: Date;
  last_used_at: Date;
}

export interface IdentityRecord {
  id: string;
  userId: string;
  provider: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
  lastUsedAt: number;
}

const toIdentity = (r: IdentityRow): IdentityRecord => ({
  id: r.id,
  userId: r.user_id,
  provider: r.provider,
  issuer: r.issuer,
  subject: r.subject,
  email: r.email,
  emailVerified: r.email_verified,
  createdAt: r.created_at.getTime(),
  lastUsedAt: r.last_used_at.getTime(),
});

/** Thrown when the provider account is connected to another Freero account already. */
export class IdentityTakenError extends Error {}
/** Thrown when the account already has an identity of that provider. */
export class ProviderAlreadyLinkedError extends Error {}

export async function insertIdentity(i: Omit<IdentityRecord, 'lastUsedAt'>): Promise<void> {
  try {
    await query(
      `INSERT INTO auth_identities (id, user_id, provider, issuer, subject, email, email_verified, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [i.id, i.userId, i.provider, i.issuer, i.subject, i.email, i.emailVerified, new Date(i.createdAt)],
    );
  } catch (e) {
    if (isUniqueViolation(e, 'auth_identities_subject_key')) throw new IdentityTakenError();
    if (isUniqueViolation(e, 'auth_identities_user_provider_key')) throw new ProviderAlreadyLinkedError();
    throw e;
  }
}

export async function findIdentity(provider: string, issuer: string, subject: string): Promise<IdentityRecord | null> {
  const row = await one<IdentityRow>(`SELECT * FROM auth_identities WHERE provider = $1 AND issuer = $2 AND subject = $3`, [
    provider,
    issuer,
    subject,
  ]);
  return row ? toIdentity(row) : null;
}

/** Records a sign-in through the identity, with the email the provider asserts now. */
export async function touchIdentity(id: string, email: string | null, emailVerified: boolean, now: number): Promise<void> {
  await query(`UPDATE auth_identities SET email = $2, email_verified = $3, last_used_at = $4 WHERE id = $1`, [
    id,
    email,
    emailVerified,
    new Date(now),
  ]);
}

export async function listIdentities(userId: string): Promise<IdentityRecord[]> {
  return (await query<IdentityRow>(`SELECT * FROM auth_identities WHERE user_id = $1 ORDER BY created_at`, [userId])).map(toIdentity);
}

/**
 * Disconnects an identity unless it is the account's last way to sign in (no password and no other
 * identity). The user row is locked, so two concurrent disconnects can't both pass the check.
 */
export async function deleteIdentityIfNotLast(userId: string, id: string): Promise<'deleted' | 'last' | 'missing'> {
  return tx(async () => {
    const user = await one<{ has_password: boolean }>(
      `SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (!user) return 'missing';
    const ids = await query<{ id: string }>(`SELECT id FROM auth_identities WHERE user_id = $1`, [userId]);
    if (!ids.some((r) => r.id === id)) return 'missing';
    if (!user.has_password && ids.length < 2) return 'last';
    await query(`DELETE FROM auth_identities WHERE id = $1 AND user_id = $2`, [id, userId]);
    return 'deleted';
  });
}

// ---- authorization requests in flight ----

export type OidcIntent = 'login' | 'link' | 'reauth';

export interface OidcFlow {
  provider: string;
  intent: OidcIntent;
  userId: string | null;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

export async function insertOidcFlow(stateHash: string, f: OidcFlow, now: number, expiresAt: number): Promise<void> {
  await query(
    `INSERT INTO auth_oidc_flows (state_hash, provider, intent, user_id, code_verifier, nonce, return_to, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [stateHash, f.provider, f.intent, f.userId, f.codeVerifier, f.nonce, f.returnTo, new Date(now), new Date(expiresAt)],
  );
}

/** Uses a flow: deletes it and returns it if it had not expired. One statement: single use. */
export async function takeOidcFlow(stateHash: string, now: number): Promise<OidcFlow | null> {
  const r = await one<{
    provider: string;
    intent: OidcIntent;
    user_id: string | null;
    code_verifier: string;
    nonce: string;
    return_to: string;
    expires_at: Date;
  }>(`DELETE FROM auth_oidc_flows WHERE state_hash = $1 RETURNING *`, [stateHash]);
  if (!r || r.expires_at.getTime() <= now) return null;
  return { provider: r.provider, intent: r.intent, userId: r.user_id, codeVerifier: r.code_verifier, nonce: r.nonce, returnTo: r.return_to };
}

// ---- sign-ins waiting for their second step ----

/** A provider identity to connect once the second step succeeds (JSON in auth_challenges.link). */
export interface PendingLink {
  provider: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export interface Challenge {
  userId: string;
  method: string;
  link: PendingLink | null;
}

export async function insertChallenge(tokenHash: string, c: Challenge, now: number, expiresAt: number): Promise<void> {
  await query(
    `INSERT INTO auth_challenges (token_hash, user_id, method, link, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenHash, c.userId, c.method, c.link === null ? null : JSON.stringify(c.link), new Date(now), new Date(expiresAt)],
  );
}

/**
 * Counts one attempt at the challenge and returns it — or null when it is unknown, expired or out
 * of attempts. One statement, so parallel guesses can't exceed `maxAttempts`.
 */
export async function attemptChallenge(tokenHash: string, now: number, maxAttempts: number): Promise<Challenge | null> {
  const r = await one<{ user_id: string; method: string; link: PendingLink | string | null }>(
    `UPDATE auth_challenges SET attempts = attempts + 1
     WHERE token_hash = $1 AND expires_at > $2 AND attempts < $3 RETURNING user_id, method, link`,
    [tokenHash, new Date(now), maxAttempts],
  );
  if (!r) return null;
  const link = typeof r.link === 'string' ? (JSON.parse(r.link) as PendingLink) : r.link;
  return { userId: r.user_id, method: r.method, link };
}

/** Uses up a challenge; false if another request already did. */
export async function deleteChallenge(tokenHash: string): Promise<boolean> {
  return (await query(`DELETE FROM auth_challenges WHERE token_hash = $1 RETURNING 1`, [tokenHash])).length > 0;
}

export async function deleteExpiredAuthFlows(now: number): Promise<void> {
  await query(`DELETE FROM auth_oidc_flows WHERE expires_at <= $1`, [new Date(now)]);
  await query(`DELETE FROM auth_challenges WHERE expires_at <= $1`, [new Date(now)]);
}

// ---- two-factor authentication ----

export interface TotpRecord {
  /** Encrypted (see twoFactor.ts). */
  secret: string;
  enabledAt: number | null;
  lastTimeStep: number | null;
}

export async function findTotp(userId: string): Promise<TotpRecord | null> {
  const r = await one<{ secret: string; enabled_at: Date | null; last_time_step: number | string | null }>(
    `SELECT secret, enabled_at, last_time_step FROM user_totp WHERE user_id = $1`,
    [userId],
  );
  return r
    ? { secret: r.secret, enabledAt: r.enabled_at?.getTime() ?? null, lastTimeStep: r.last_time_step === null ? null : Number(r.last_time_step) }
    : null;
}

export async function twoFactorEnabled(userId: string): Promise<boolean> {
  return !!(await one(`SELECT 1 FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL`, [userId]));
}

/** Starts (or restarts) an enrolment; never replaces an enabled authenticator (then false). */
export async function savePendingTotp(userId: string, secret: string, now: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO user_totp (user_id, secret, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, created_at = EXCLUDED.created_at, last_time_step = NULL
       WHERE user_totp.enabled_at IS NULL
     RETURNING 1`,
    [userId, secret, new Date(now)],
  );
  return rows.length > 0;
}

/**
 * Turns on the pending authenticator (the one whose code was checked: same stored secret) with
 * that code's time step and stores the recovery codes, in one transaction. False if there was no
 * such pending enrolment any more.
 */
export async function enableTotp(userId: string, secret: string, timeStep: number, codeHashes: string[], now: number): Promise<boolean> {
  return tx(async () => {
    const rows = await query(
      `UPDATE user_totp SET enabled_at = $4, last_time_step = $3 WHERE user_id = $1 AND secret = $2 AND enabled_at IS NULL RETURNING 1`,
      [userId, secret, timeStep, new Date(now)],
    );
    if (rows.length === 0) return false;
    await insertRecoveryCodes(userId, codeHashes);
    return true;
  });
}

async function insertRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
  await query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
  await query(`INSERT INTO user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`, [userId, codeHashes]);
}

/** Accepts a code's time step once: false if this or a later step was already used. */
export async function useTotpStep(userId: string, timeStep: number): Promise<boolean> {
  const rows = await query(
    `UPDATE user_totp SET last_time_step = $2
     WHERE user_id = $1 AND enabled_at IS NOT NULL AND (last_time_step IS NULL OR last_time_step < $2) RETURNING 1`,
    [userId, timeStep],
  );
  return rows.length > 0;
}

/** Uses a recovery code once (one statement: two concurrent uses can't both succeed). */
export async function useRecoveryCode(userId: string, codeHash: string, now: number): Promise<boolean> {
  const rows = await query(
    `UPDATE user_recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING 1`,
    [userId, codeHash, new Date(now)],
  );
  return rows.length > 0;
}

export async function countRecoveryCodes(userId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]))!.n;
}

export async function replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
  await tx(() => insertRecoveryCodes(userId, codeHashes));
}

export async function deleteTwoFactor(userId: string): Promise<void> {
  await tx(async () => {
    await query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
  });
}

/** Every match of `pattern`'s first group in a profile picture URL (restricted to `among` when given). */
export async function matchesInAvatars(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name
     FROM (SELECT regexp_matches(avatar_url, $1, 'g') AS m FROM users WHERE avatar_url IS NOT NULL) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}
