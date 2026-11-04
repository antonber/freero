// The only writer of `figma_accounts`, `figma_oauth_flows`, `figma_recent_files` and
// `figma_plugin_codes` [S4] (#171, #172).
import { one, query } from '../../platform/db';

// ---- connected accounts (tokens arrive and leave sealed: service.ts seals them) ----

export interface FigmaAccountRow {
  userId: string;
  figmaUserId: string;
  handle: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

export async function account(userId: string): Promise<FigmaAccountRow | null> {
  const r = await one<{
    user_id: string;
    figma_user_id: string;
    handle: string;
    email: string | null;
    access_token: string;
    refresh_token: string | null;
    expires_at: Date | null;
  }>(`SELECT user_id, figma_user_id, handle, email, access_token, refresh_token, expires_at FROM figma_accounts WHERE user_id = $1`, [userId]);
  return r
    ? {
        userId: r.user_id,
        figmaUserId: r.figma_user_id,
        handle: r.handle,
        email: r.email,
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        expiresAt: r.expires_at ? r.expires_at.getTime() : null,
      }
    : null;
}

export async function setAccount(a: FigmaAccountRow, now: number): Promise<void> {
  await query(
    `INSERT INTO figma_accounts (user_id, figma_user_id, handle, email, access_token, refresh_token, expires_at, linked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET figma_user_id = EXCLUDED.figma_user_id, handle = EXCLUDED.handle, email = EXCLUDED.email,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, linked_at = EXCLUDED.linked_at`,
    [a.userId, a.figmaUserId, a.handle, a.email, a.accessToken, a.refreshToken, a.expiresAt === null ? null : new Date(a.expiresAt), new Date(now)],
  );
}

/** New tokens after a refresh; only while the account is still connected (a disconnect wins). */
export async function setTokens(userId: string, accessToken: string, refreshToken: string | null, expiresAt: number | null): Promise<void> {
  await query(`UPDATE figma_accounts SET access_token = $2, refresh_token = COALESCE($3, refresh_token), expires_at = $4 WHERE user_id = $1`, [
    userId,
    accessToken,
    refreshToken,
    expiresAt === null ? null : new Date(expiresAt),
  ]);
}

/** Disconnects: the tokens and the recent files go. True when something was connected. */
export async function deleteAccount(userId: string): Promise<boolean> {
  await query(`DELETE FROM figma_recent_files WHERE user_id = $1`, [userId]);
  return (await query(`DELETE FROM figma_accounts WHERE user_id = $1 RETURNING 1`, [userId])).length > 0;
}

// ---- consents in progress ----

export async function insertFlow(stateHash: string, f: { userId: string; browserHash: string; returnPath: string }, expiresAt: number): Promise<void> {
  await query(`DELETE FROM figma_oauth_flows WHERE expires_at < now()`);
  await query(`INSERT INTO figma_oauth_flows (state_hash, user_id, browser_hash, return_path, expires_at) VALUES ($1, $2, $3, $4, $5)`, [
    stateHash,
    f.userId,
    f.browserHash,
    f.returnPath,
    new Date(expiresAt),
  ]);
}

/** Takes a flow (single use: deleted in the same statement), unless expired. */
export async function takeFlow(stateHash: string): Promise<{ userId: string; browserHash: string; returnPath: string } | null> {
  const r = await one<{ user_id: string; browser_hash: string; return_path: string }>(
    `DELETE FROM figma_oauth_flows WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, browser_hash, return_path`,
    [stateHash],
  );
  return r ? { userId: r.user_id, browserHash: r.browser_hash, returnPath: r.return_path } : null;
}

// ---- recent files ----

const RECENT_KEPT = 20;

export async function touchFile(userId: string, f: { key: string; name: string; thumbnail: string | null }, now: number): Promise<void> {
  await query(
    `INSERT INTO figma_recent_files (user_id, file_key, name, thumbnail, used_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, file_key) DO UPDATE SET name = EXCLUDED.name, thumbnail = EXCLUDED.thumbnail, used_at = EXCLUDED.used_at`,
    [userId, f.key, f.name, f.thumbnail, new Date(now)],
  );
  await query(
    `DELETE FROM figma_recent_files WHERE user_id = $1 AND file_key NOT IN
       (SELECT file_key FROM figma_recent_files WHERE user_id = $1 ORDER BY used_at DESC LIMIT ${RECENT_KEPT})`,
    [userId],
  );
}

export async function recentFiles(userId: string): Promise<Array<{ key: string; name: string; thumbnail: string | null; usedAt: number }>> {
  const rows = await query<{ file_key: string; name: string; thumbnail: string | null; used_at: Date }>(
    `SELECT file_key, name, thumbnail, used_at FROM figma_recent_files WHERE user_id = $1 ORDER BY used_at DESC LIMIT ${RECENT_KEPT}`,
    [userId],
  );
  return rows.map((r) => ({ key: r.file_key, name: r.name, thumbnail: r.thumbnail, usedAt: r.used_at.getTime() }));
}

// ---- the plugin's sign-in codes (#172) ----

export async function keepPluginCode(stateHash: string, sealedCode: string, expiresAt: number): Promise<void> {
  await query(`DELETE FROM figma_plugin_codes WHERE expires_at < now()`);
  await query(
    `INSERT INTO figma_plugin_codes (state_hash, code, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (state_hash) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [stateHash, sealedCode, new Date(expiresAt)],
  );
}

/** Takes a kept code (single use: deleted in the same statement), unless expired. */
export async function takePluginCode(stateHash: string): Promise<string | null> {
  return (await one<{ code: string }>(`DELETE FROM figma_plugin_codes WHERE state_hash = $1 AND expires_at > now() RETURNING code`, [stateHash]))?.code ?? null;
}
