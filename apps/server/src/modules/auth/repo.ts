// The only writer of `users`, `sessions` and `auth_tokens` [S4].
import type { Account } from '@freero/shared';
import { isUniqueViolation, one, query } from '../../platform/db';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  color: string;
  avatar_url: string | null;
  created_at: Date;
  email_verified_at: Date | null;
  deletion_scheduled_for: Date | null;
}

export interface UserWithHash extends Account {
  passwordHash: string;
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

export async function insertUser(u: UserWithHash): Promise<void> {
  try {
    await query(
      `INSERT INTO users (id, email, name, password_hash, color, avatar_url, created_at, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [u.id, u.email, u.name, u.passwordHash, u.color, u.avatarUrl, new Date(u.createdAt), u.emailVerified ? new Date(u.createdAt) : null],
    );
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

export async function setPasswordHash(id: string, hash: string): Promise<void> {
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
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  ip: string;
}

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  tokenHash: r.token_hash,
  createdAt: r.created_at.getTime(),
  lastSeenAt: r.last_seen_at.getTime(),
  userAgent: r.user_agent,
  ip: r.ip,
});

export async function insertSession(s: {
  id: string;
  tokenHash: string;
  userId: string;
  now: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
}): Promise<void> {
  await query(
    `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [s.id, s.tokenHash, s.userId, new Date(s.now), new Date(s.expiresAt), s.userAgent, s.ip],
  );
}

export async function findSessionUser(tokenHash: string, now: number): Promise<{ user: UserWithHash; sessionId: string } | null> {
  const row = await one<UserRow & { session_id: string }>(
    `SELECT u.*, s.id AS session_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash, new Date(now)],
  );
  return row ? { user: toUser(row), sessionId: row.session_id } : null;
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
