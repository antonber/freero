// The only writer of `uploads` [S4].
import { one, query } from '../../platform/db';

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
     WHERE (SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE owner_id = $2) + $3::bigint <= $6::bigint
     RETURNING name`,
    [name, ownerId, bytes, contentType, new Date(now), quotaBytes],
  );
  return row !== null;
}

export async function deleteUploadRow(name: string): Promise<void> {
  await query(`DELETE FROM uploads WHERE name = $1`, [name]);
}

export async function bytesUsedBy(ownerId: string): Promise<number> {
  const row = await one<{ n: number | string }>(`SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM uploads WHERE owner_id = $1`, [ownerId]);
  return Number(row?.n ?? 0);
}
