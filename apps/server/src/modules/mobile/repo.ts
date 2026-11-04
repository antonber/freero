// The only writer of `push_devices` [S4] (#177).
import { query } from '../../platform/db';

export type PushPlatform = 'ios' | 'android';

export interface PushDevice {
  token: string;
  userId: string;
  sessionKey: string;
  platform: PushPlatform;
  offTypes: string[];
}

export async function upsertDevice(d: PushDevice, now: number): Promise<void> {
  await query(
    `INSERT INTO push_devices (token, user_id, session_key, platform, off_types, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, session_key = EXCLUDED.session_key, platform = EXCLUDED.platform,
       off_types = EXCLUDED.off_types, updated_at = EXCLUDED.updated_at`,
    [d.token, d.userId, d.sessionKey, d.platform, JSON.stringify(d.offTypes), new Date(now)],
  );
}

/** A person's own device (someone else's token is never theirs to remove). */
export async function deleteDevice(userId: string, token: string): Promise<boolean> {
  return (await query(`DELETE FROM push_devices WHERE user_id = $1 AND token = $2 RETURNING 1`, [userId, token])).length > 0;
}

export async function deleteBySession(sessionKey: string): Promise<number> {
  return (await query(`DELETE FROM push_devices WHERE session_key = $1 RETURNING 1`, [sessionKey])).length;
}

/** Tokens the push service said are no longer valid (the app was removed, or the token rotated). */
export async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length) await query(`DELETE FROM push_devices WHERE token = ANY($1::text[])`, [tokens]);
}

export async function devicesOf(userId: string): Promise<PushDevice[]> {
  const rows = await query<{ token: string; user_id: string; session_key: string; platform: PushPlatform; off_types: unknown }>(
    `SELECT token, user_id, session_key, platform, off_types FROM push_devices WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => ({
    token: r.token,
    userId: r.user_id,
    sessionKey: r.session_key,
    platform: r.platform,
    offTypes: Array.isArray(r.off_types) ? r.off_types.filter((t): t is string => typeof t === 'string') : [],
  }));
}

export async function countOf(userId: string): Promise<number> {
  return (await query(`SELECT 1 FROM push_devices WHERE user_id = $1`, [userId])).length;
}
