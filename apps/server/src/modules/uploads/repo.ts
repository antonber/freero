// The only writer of `uploads` [S4].
import { one, query, tx } from '../../platform/db';

/**
 * Records an upload if it keeps the owner within `quotaBytes`; false (nothing written) otherwise.
 * Check and insert are one statement; concurrent uploads by one user may overshoot the quota by
 * at most one file each, which is fine for a storage quota.
 */
export async function reserveUpload(
  name: string,
  ownerId: string,
  bytes: number,
  contentType: string,
  quotaBytes: number,
  now: number,
): Promise<boolean> {
  const row = await one(
    `INSERT INTO uploads (name, owner_id, bytes, content_type, created_at)
     SELECT $1, $2, $3::bigint, $4, $5
     WHERE (SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE owner_id = $2 AND removed_at IS NULL) + $3::bigint <= $6::bigint
     RETURNING name`,
    [name, ownerId, bytes, contentType, new Date(now), quotaBytes],
  );
  return row !== null;
}

/** Deletes the row of a file being deleted. A removed file's tombstone stays (its URL keeps answering 410). */
export async function deleteUploadRow(name: string): Promise<void> {
  await query(`DELETE FROM uploads WHERE name = $1 AND removed_at IS NULL`, [name]);
}

export async function bytesUsedBy(ownerId: string): Promise<number> {
  const row = await one<{ n: number | string }>(
    `SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM uploads WHERE owner_id = $1 AND removed_at IS NULL`,
    [ownerId],
  );
  return Number(row?.n ?? 0);
}

// ---- removal by operators (moderation.ts) ----

export interface UploadRow {
  name: string;
  ownerId: string | null;
  bytes: number;
  contentType: string;
  createdAt: number;
  removedAt: number | null;
  quarantineKey: string | null;
}

export async function getUploadRow(name: string): Promise<UploadRow | null> {
  const r = await one<{
    name: string;
    owner_id: string | null;
    bytes: number | string;
    content_type: string;
    created_at: Date;
    removed_at: Date | null;
    quarantine_key: string | null;
  }>(`SELECT name, owner_id, bytes, content_type, created_at, removed_at, quarantine_key FROM uploads WHERE name = $1`, [name]);
  return r
    ? {
        name: r.name,
        ownerId: r.owner_id,
        bytes: Number(r.bytes),
        contentType: r.content_type,
        createdAt: r.created_at.getTime(),
        removedAt: r.removed_at?.getTime() ?? null,
        quarantineKey: r.quarantine_key,
      }
    : null;
}

/** Whether an operator removed this file (GET answers 410). */
export async function isRemoved(name: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM uploads WHERE name = $1 AND removed_at IS NOT NULL`, [name])) !== null;
}

/**
 * Marks a file removed (a row is created for files that had none: thumbnails, files not adopted
 * yet). False when it already was removed (nothing written).
 */
export async function markRemoved(
  f: { name: string; bytes: number; contentType: string; quarantineKey: string | null },
  now: number,
): Promise<boolean> {
  const row = await one(
    `INSERT INTO uploads (name, owner_id, bytes, content_type, created_at, removed_at, quarantine_key)
     VALUES ($1, NULL, $2, $3, $4, $4, $5)
     ON CONFLICT (name) DO UPDATE SET removed_at = $4, quarantine_key = $5 WHERE uploads.removed_at IS NULL
     RETURNING name`,
    [f.name, f.bytes, f.contentType, new Date(now), f.quarantineKey],
  );
  return row !== null;
}

/**
 * Clears a removal whose kept copy is `quarantineKey` (the bytes were just put back). Counts as
 * referenced now, so the sweep gives it the usual grace period. False when it changed meanwhile.
 */
export async function clearRemoved(name: string, quarantineKey: string, now: number): Promise<boolean> {
  const rows = await query(
    `UPDATE uploads SET removed_at = NULL, quarantine_key = NULL, last_referenced_at = $3
     WHERE name = $1 AND removed_at IS NOT NULL AND quarantine_key = $2 RETURNING 1`,
    [name, quarantineKey, new Date(now)],
  );
  return rows.length > 0;
}

/** Forgets a removed file's kept copy; returns its key (to delete it), or null if there was none. */
export async function takeQuarantineKey(name: string): Promise<string | null> {
  const r = await one<{ key: string }>(
    `UPDATE uploads u SET quarantine_key = NULL FROM (SELECT quarantine_key FROM uploads WHERE name = $1 FOR UPDATE) old
     WHERE u.name = $1 AND u.removed_at IS NOT NULL AND old.quarantine_key IS NOT NULL RETURNING old.quarantine_key AS key`,
    [name],
  );
  return r?.key ?? null;
}

// ---- mark-and-sweep (sweep.ts) ----

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

/** Records that a sweep round found these uploads referenced at `now`. */
export async function markReferenced(names: readonly string[], now: number): Promise<void> {
  if (!names.length) return;
  await query(`UPDATE uploads SET last_referenced_at = $2 WHERE name = ANY($1::text[])`, [names, new Date(now)]);
}

/** Up to `limit` uploads that no round has seen referenced since `before`, nor were created since. */
export async function idleSince(before: number, limit: number): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM uploads WHERE COALESCE(last_referenced_at, created_at) < $1 AND removed_at IS NULL ORDER BY name LIMIT $2`,
    [new Date(before), limit],
  );
  return rows.map((r) => r.name);
}

/**
 * Gives stored files that have no row one (no owner, so no quota), created `now`: board and
 * template thumbnails, files from before this table, rows lost to a crash. From then on the sweep
 * treats them like any upload. Names that already have a row are left alone.
 */
export async function adoptFiles(files: ReadonlyArray<{ name: string; bytes: number; contentType: string }>, now: number): Promise<void> {
  if (!files.length) return;
  await query(
    `INSERT INTO uploads (name, owner_id, bytes, content_type, created_at)
     SELECT f.name, NULL, f.bytes, f.content_type, $4
     FROM unnest($1::text[], $2::bigint[], $3::text[]) AS f(name, bytes, content_type)
     ON CONFLICT (name) DO NOTHING`,
    [files.map((f) => f.name), files.map((f) => f.bytes), files.map((f) => f.contentType), new Date(now)],
  );
}

/**
 * Deletes the rows of those `names` that are STILL idle since `before` (a mark by another round
 * in between wins) and returns the ones it deleted: only those files may be removed.
 */
export async function deleteIdle(names: readonly string[], before: number): Promise<string[]> {
  if (!names.length) return [];
  const rows = await query<{ name: string }>(
    `DELETE FROM uploads WHERE name = ANY($1::text[]) AND COALESCE(last_referenced_at, created_at) < $2 AND removed_at IS NULL RETURNING name`,
    [names, new Date(before)],
  );
  return rows.map((r) => r.name);
}
