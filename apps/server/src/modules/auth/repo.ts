// The only writer of `users` and `sessions` [S4].
import type { User } from '@freero/shared';
import { isUniqueViolation, one, query } from '../../platform/db';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  color: string;
  avatar_url: string | null;
  created_at: Date;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

const toUser = (r: UserRow): UserWithHash => ({
  id: r.id,
  email: r.email,
  name: r.name,
  color: r.color,
  avatarUrl: r.avatar_url,
  createdAt: r.created_at.getTime(),
  passwordHash: r.password_hash,
});

/** Thrown by insertUser when the email is taken (possibly by a concurrent signup). */
export class EmailTakenError extends Error {}

export async function insertUser(u: UserWithHash): Promise<void> {
  try {
    await query(
      `INSERT INTO users (id, email, name, password_hash, color, avatar_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u.id, u.email, u.name, u.passwordHash, u.color, u.avatarUrl, new Date(u.createdAt)],
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

export async function insertSession(tokenHash: string, userId: string, now: number, expiresAt: number): Promise<void> {
  await query(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`, [
    tokenHash,
    userId,
    new Date(now),
    new Date(expiresAt),
  ]);
}

export async function findSessionUser(tokenHash: string, now: number): Promise<UserWithHash | null> {
  const row = await one<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash, new Date(now)],
  );
  return row ? toUser(row) : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function deleteExpiredSessions(now: number): Promise<void> {
  await query(`DELETE FROM sessions WHERE expires_at <= $1`, [new Date(now)]);
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
