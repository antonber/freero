// The only writer of `users` and `sessions` [S4].
import type { User } from '@freero/shared';
import { sql } from '../../platform/db';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  color: string;
  avatar_url: string | null;
  created_at: number;
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
  createdAt: Number(r.created_at),
  passwordHash: r.password_hash,
});

export function insertUser(u: UserWithHash): void {
  sql(
    `INSERT INTO users (id, email, name, password_hash, color, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(u.id, u.email, u.name, u.passwordHash, u.color, u.avatarUrl, u.createdAt);
}

export function findUserById(id: string): UserWithHash | null {
  const row = sql(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function findUserByEmail(email: string): UserWithHash | null {
  const row = sql(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function countUsers(): number {
  return Number((sql(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n);
}

export function updateUserProfile(id: string, patch: { name?: string; color?: string; avatarUrl?: string | null }): void {
  const cur = findUserById(id);
  if (!cur) return;
  sql(`UPDATE users SET name = ?, color = ?, avatar_url = ? WHERE id = ?`).run(
    patch.name ?? cur.name,
    patch.color ?? cur.color,
    patch.avatarUrl === undefined ? cur.avatarUrl : patch.avatarUrl,
    id,
  );
}

export function insertSession(tokenHash: string, userId: string, now: number, expiresAt: number): void {
  sql(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
    tokenHash,
    userId,
    now,
    expiresAt,
  );
}

export function findSessionUser(tokenHash: string, now: number): UserWithHash | null {
  const row = sql(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get(tokenHash, now) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function deleteSession(tokenHash: string): void {
  sql(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}

export function deleteExpiredSessions(now: number): void {
  sql(`DELETE FROM sessions WHERE expires_at <= ?`).run(now);
}
