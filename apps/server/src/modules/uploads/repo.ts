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
  keyed: { workspaceId: string | null; sealedWith: string | null } = { workspaceId: null, sealedWith: null },
): Promise<boolean> {
  const row = await one(
    `INSERT INTO uploads (name, owner_id, bytes, content_type, created_at, workspace_id, sealed_with)
     SELECT $1, $2, $3::bigint, $4, $5, $7, $8
     WHERE (SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE owner_id = $2 AND removed_at IS NULL) + $3::bigint <= $6::bigint
     RETURNING name`,
    [name, ownerId, bytes, contentType, new Date(now), quotaBytes, keyed.workspaceId, keyed.sealedWith],
  );
  return row !== null;
}

/** A file of a workspace stored without an owner (no quota): its row says whose key governs it. */
export async function insertOwnerless(name: string, bytes: number, contentType: string, now: number, keyed: { workspaceId: string; sealedWith: string | null }): Promise<void> {
  await query(`INSERT INTO uploads (name, owner_id, bytes, content_type, created_at, workspace_id, sealed_with) VALUES ($1, NULL, $2, $3, $4, $5, $6)`, [
    name,
    bytes,
    contentType,
    new Date(now),
    keyed.workspaceId,
    keyed.sealedWith,
  ]);
}

// ---- files under a workspace's key (sealedFiles.ts, keyed.ts) ----

/**
 * Records that `name` is now stored sealed with `to` (null: as uploaded) for `workspaceId`, if its
 * row still says `from` (compare-and-swap: a concurrent reseal wins). False when it changed.
 */
export async function setSealing(name: string, from: string | null, to: string | null, workspaceId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE uploads SET sealed_with = $3, workspace_id = $4 WHERE name = $1 AND sealed_with IS NOT DISTINCT FROM $2 AND removed_at IS NULL RETURNING 1`,
    [name, from, to, workspaceId],
  );
  return rows.length > 0;
}

/** Hands these files of `from` to workspace `to` (a board moved); their bytes are sealed again after. */
export async function handFilesTo(names: readonly string[], from: string, to: string): Promise<string[]> {
  if (!names.length) return [];
  const rows = await query<{ name: string }>(`UPDATE uploads SET workspace_id = $3 WHERE name = ANY($1::text[]) AND workspace_id = $2 RETURNING name`, [names, from, to]);
  return rows.map((r) => r.name);
}

/** Which of these names are files of `workspaceId`. */
export async function filesOfWorkspaceAmong(names: readonly string[], workspaceId: string): Promise<string[]> {
  if (!names.length) return [];
  const rows = await query<{ name: string }>(`SELECT name FROM uploads WHERE name = ANY($1::text[]) AND workspace_id = $2`, [names, workspaceId]);
  return rows.map((r) => r.name);
}

export interface KeyedFile {
  name: string;
  workspaceId: string;
  sealedWith: string | null;
}

/**
 * Up to `limit` files not stored the way their workspace seals now: files of a workspace in
 * `refs` (its current data key) under anything else, and files sealed under another workspace's
 * key than the one now governing them (handed over by a move, to a workspace with or without a key).
 * Files of `unusable` workspaces (a key that can't seal now) wait.
 */
export async function filesToReseal(refs: ReadonlyMap<string, string>, unusable: readonly string[], limit: number): Promise<KeyedFile[]> {
  const ws = [...refs.keys()];
  const rows = await query<{ name: string; workspace_id: string; sealed_with: string | null }>(
    `SELECT name, workspace_id, sealed_with FROM uploads
     WHERE workspace_id IS NOT NULL AND removed_at IS NULL AND NOT (workspace_id = ANY($4::text[])) AND (
       (workspace_id = ANY($1::text[]) AND sealed_with IS DISTINCT FROM ($2::text[])[array_position($1::text[], workspace_id)])
       OR (sealed_with IS NOT NULL AND NOT starts_with(sealed_with, workspace_id || ':'))
     )
     ORDER BY name LIMIT $3`,
    [ws, ws.map((w) => refs.get(w)!), limit, unusable],
  );
  return rows.map((r) => ({ name: r.name, workspaceId: r.workspace_id, sealedWith: r.sealed_with }));
}

/** Deletes the row of a file being deleted. A removed file's tombstone stays (its URL keeps answering 410). */
export async function deleteUploadRow(name: string): Promise<void> {
  await query(`DELETE FROM uploads WHERE name = $1 AND removed_at IS NULL`, [name]);
}

/** The person's uploads, oldest first (data exports); files an operator removed are not theirs to take. */
export async function ownedBy(ownerId: string): Promise<Array<{ name: string; bytes: number; contentType: string; createdAt: number }>> {
  return (
    await query<{ name: string; bytes: number | string; content_type: string; created_at: Date }>(
      `SELECT name, bytes, content_type, created_at FROM uploads WHERE owner_id = $1 AND removed_at IS NULL ORDER BY created_at, name`,
      [ownerId],
    )
  ).map((r) => ({ name: r.name, bytes: Number(r.bytes), contentType: r.content_type, createdAt: r.created_at.getTime() }));
}

export async function bytesUsedBy(ownerId: string): Promise<number> {
  const row = await one<{ n: number | string }>(
    `SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM uploads WHERE owner_id = $1 AND removed_at IS NULL`,
    [ownerId],
  );
  return Number(row?.n ?? 0);
}

/** Total size of these uploads (names without a row count as 0). */
export async function bytesOf(names: readonly string[]): Promise<number> {
  if (!names.length) return 0;
  const row = await one<{ n: number | string }>(`SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM uploads WHERE name = ANY($1::text[])`, [names]);
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
  /** #159: the workspace whose key governs it, and the data key its stored bytes are sealed with. */
  workspaceId: string | null;
  sealedWith: string | null;
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
    workspace_id: string | null;
    sealed_with: string | null;
  }>(`SELECT name, owner_id, bytes, content_type, created_at, removed_at, quarantine_key, workspace_id, sealed_with FROM uploads WHERE name = $1`, [name]);
  return r
    ? {
        name: r.name,
        ownerId: r.owner_id,
        bytes: Number(r.bytes),
        contentType: r.content_type,
        createdAt: r.created_at.getTime(),
        removedAt: r.removed_at?.getTime() ?? null,
        quarantineKey: r.quarantine_key,
        workspaceId: r.workspace_id,
        sealedWith: r.sealed_with,
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

/**
 * Detaches the user's REMOVED files from their account before it is deleted (KAI-178): their rows
 * would otherwise cascade with it, losing the tombstone (410) and the record of the kept copy.
 */
export async function detachRemovedOf(userId: string): Promise<number> {
  return (await query(`UPDATE uploads SET owner_id = NULL WHERE owner_id = $1 AND (removed_at IS NOT NULL OR sealed_with IS NOT NULL) RETURNING 1`, [userId])).length;
}

/** Removed files whose kept copy still exists and that were removed before `before`, oldest first. */
export async function keptCopiesRemovedBefore(before: number, limit: number): Promise<Array<{ name: string; removedAt: number }>> {
  return (
    await query<{ name: string; removed_at: Date }>(
      `SELECT name, removed_at FROM uploads WHERE removed_at < $1 AND quarantine_key IS NOT NULL ORDER BY removed_at LIMIT $2`,
      [new Date(before), limit],
    )
  ).map((r) => ({ name: r.name, removedAt: r.removed_at.getTime() }));
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
