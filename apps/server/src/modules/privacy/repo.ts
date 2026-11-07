// The only writer of `data_exports` [S4]. The job's lifecycle is the same as modules/ediscovery's
// case exports (pending → running → ready → expired, running → pending | failed): keep the two in step.
import type { DataExportInfo } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

/** Runs fn in one transaction (a change and its audit record commit together). */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface ExportRecord extends DataExportInfo {
  requestedBy: string | null;
  workspaceId: string | null;
  fileKey: string | null;
  attempts: number;
}
interface Row {
  id: string;
  kind: 'user' | 'workspace';
  requested_by: string | null;
  workspace_id: string | null;
  status: DataExportInfo['status'];
  attempts: number;
  file_key: string | null;
  bytes: number | string | null;
  created_at: Date;
  ready_at: Date | null;
  expires_at: Date | null;
}
const toExport = (r: Row): ExportRecord => ({
  id: r.id,
  kind: r.kind,
  requestedBy: r.requested_by,
  workspaceId: r.workspace_id,
  status: r.status,
  attempts: r.attempts,
  fileKey: r.file_key,
  bytes: r.bytes === null ? null : Number(r.bytes),
  createdAt: r.created_at.getTime(),
  readyAt: r.ready_at?.getTime() ?? null,
  expiresAt: r.expires_at?.getTime() ?? null,
});

/**
 * Queues an export unless one for the same subject is already pending or running (then false).
 * One statement, so two clicks can't queue two.
 */
export async function insertExport(e: { id: string; kind: 'user' | 'workspace'; requestedBy: string; workspaceId: string | null }, now: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO data_exports (id, kind, requested_by, workspace_id, status, created_at)
     SELECT $1, $2, $3, $4, 'pending', $5
     WHERE NOT EXISTS (
       SELECT 1 FROM data_exports WHERE kind = $2 AND status IN ('pending', 'running')
         AND (CASE WHEN $2 = 'user' THEN requested_by = $3 ELSE workspace_id = $4 END))
     RETURNING 1`,
    [e.id, e.kind, e.requestedBy, e.workspaceId, new Date(now)],
  );
  return rows.length > 0;
}

export async function getExport(id: string): Promise<ExportRecord | null> {
  const r = await one<Row>(`SELECT * FROM data_exports WHERE id = $1`, [id]);
  return r ? toExport(r) : null;
}

export async function listExports(by: { requestedBy: string; kind: 'user' } | { workspaceId: string; kind: 'workspace' }): Promise<ExportRecord[]> {
  const rows =
    by.kind === 'user'
      ? await query<Row>(`SELECT * FROM data_exports WHERE kind = 'user' AND requested_by = $1 ORDER BY created_at DESC LIMIT 20`, [by.requestedBy])
      : await query<Row>(`SELECT * FROM data_exports WHERE kind = 'workspace' AND workspace_id = $1 ORDER BY created_at DESC LIMIT 20`, [by.workspaceId]);
  return rows.map(toExport);
}

/**
 * How many times an export is built before it fails for good, whether its build threw (markFailed)
 * or took its instance down (requeueStale). A failed export no longer blocks a new request.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Claims the oldest pending export (running, attempts + 1); null when none. The archive's key is
 * recorded here, before anything is written: the first claim takes `fileKey`, later attempts keep
 * the recorded one (and overwrite its file). So every archive in storage is named by its row, and
 * filesToDrop finds it whatever happened to the build.
 */
export async function claimNext(now: number, fileKey: string): Promise<ExportRecord | null> {
  const r = await one<Row>(
    `UPDATE data_exports SET status = 'running', started_at = $1, attempts = attempts + 1, file_key = COALESCE(file_key, $2)
     WHERE id = (SELECT id FROM data_exports WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [new Date(now), fileKey],
  );
  return r ? toExport(r) : null;
}

/** The claimed attempt stored its archive: ready. False when that attempt no longer owns the row. */
export async function markReady(id: string, attempt: number, bytes: number, now: number, expiresAt: number): Promise<boolean> {
  return (
    await query(
      `UPDATE data_exports SET status = 'ready', bytes = $3, ready_at = $4, expires_at = $5, error = NULL
       WHERE id = $1 AND status = 'running' AND attempts = $2 RETURNING 1`,
      [id, attempt, bytes, new Date(now), new Date(expiresAt)],
    )
  ).length > 0;
}

/** The claimed attempt threw: back to pending, or failed after MAX_ATTEMPTS. */
export async function markFailed(id: string, attempt: number, error: string): Promise<void> {
  await query(
    `UPDATE data_exports SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END, error = $4
     WHERE id = $1 AND status = 'running' AND attempts = $2`,
    [id, attempt, MAX_ATTEMPTS, error.slice(0, 500)],
  );
}

/**
 * Exports left running by an instance that died (started before `before`): retried, or failed once
 * they have had MAX_ATTEMPTS (a build that takes its instance down must not do so forever).
 */
export async function requeueStale(before: number): Promise<void> {
  await query(
    `UPDATE data_exports SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
       error = CASE WHEN attempts >= $2 THEN 'the build stopped before it finished' ELSE error END
     WHERE status = 'running' AND started_at < $1`,
    [new Date(before), MAX_ATTEMPTS],
  );
}

/**
 * Files to delete: exports past their expiry (they become 'expired'), failed exports whose build may
 * have stored an archive, and exports whose person or workspace is gone (their rows go; not while
 * one is being built). Returns the file keys; the caller deletes them first.
 */
export async function filesToDrop(now: number): Promise<Array<{ id: string; fileKey: string | null; orphan: boolean }>> {
  return (
    await query<{ id: string; file_key: string | null; orphan: boolean }>(
      `SELECT id, file_key, (requested_by IS NULL OR (kind = 'workspace' AND workspace_id IS NULL)) AS orphan FROM data_exports
       WHERE ((requested_by IS NULL OR (kind = 'workspace' AND workspace_id IS NULL)) AND status <> 'running')
          OR (status = 'ready' AND expires_at <= $1)
          OR (status = 'failed' AND file_key IS NOT NULL)
       LIMIT 200`,
      [new Date(now)],
    )
  ).map((r) => ({ id: r.id, fileKey: r.file_key, orphan: r.orphan }));
}

/** Its file is deleted: a ready export becomes expired, a failed one stays failed. */
export async function fileDropped(id: string): Promise<void> {
  await query(
    `UPDATE data_exports SET status = CASE WHEN status = 'ready' THEN 'expired' ELSE status END, file_key = NULL
     WHERE id = $1 AND status IN ('ready', 'failed')`,
    [id],
  );
}

/** Whether the export still names this archive (if not, the run that wrote it deletes it). */
export async function namesFile(id: string, fileKey: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM data_exports WHERE id = $1 AND file_key = $2`, [id, fileKey])) !== null;
}

export async function deleteExport(id: string): Promise<void> {
  await query(`DELETE FROM data_exports WHERE id = $1`, [id]);
}

/** For a person's export: their earlier exports (metadata only). */
export async function exportsRequestedBy(userId: string): Promise<ExportRecord[]> {
  return (await query<Row>(`SELECT * FROM data_exports WHERE requested_by = $1 ORDER BY created_at`, [userId])).map(toExport);
}
