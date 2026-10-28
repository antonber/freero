// The only writer of `data_exports` [S4].
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

/** Claims the oldest pending export (running, attempts + 1); null when none. */
export async function claimNext(now: number): Promise<ExportRecord | null> {
  const r = await one<Row>(
    `UPDATE data_exports SET status = 'running', started_at = $1, attempts = attempts + 1
     WHERE id = (SELECT id FROM data_exports WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [new Date(now)],
  );
  return r ? toExport(r) : null;
}

export async function markReady(id: string, fileKey: string, bytes: number, now: number, expiresAt: number): Promise<boolean> {
  return (
    await query(
      `UPDATE data_exports SET status = 'ready', file_key = $2, bytes = $3, ready_at = $4, expires_at = $5, error = NULL
       WHERE id = $1 AND status = 'running' RETURNING 1`,
      [id, fileKey, bytes, new Date(now), new Date(expiresAt)],
    )
  ).length > 0;
}

/** A failed attempt: back to pending, or failed after `maxAttempts`. */
export async function markFailed(id: string, error: string, maxAttempts: number): Promise<void> {
  await query(
    `UPDATE data_exports SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END, error = $2 WHERE id = $1 AND status = 'running'`,
    [id, error.slice(0, 500), maxAttempts],
  );
}

/** Exports left running by an instance that died (started before `before`) are retried. */
export async function requeueStale(before: number): Promise<void> {
  await query(`UPDATE data_exports SET status = 'pending' WHERE status = 'running' AND started_at < $1`, [new Date(before)]);
}

/**
 * Files to delete: exports past their expiry (they become 'expired'), and exports whose person or
 * workspace is gone (their rows go). Returns the file keys; the caller deletes them first.
 */
export async function filesToDrop(now: number): Promise<Array<{ id: string; fileKey: string | null; orphan: boolean }>> {
  return (
    await query<{ id: string; file_key: string | null; orphan: boolean }>(
      `SELECT id, file_key, (requested_by IS NULL OR (kind = 'workspace' AND workspace_id IS NULL)) AS orphan FROM data_exports
       WHERE requested_by IS NULL OR (kind = 'workspace' AND workspace_id IS NULL) OR (status = 'ready' AND expires_at <= $1)
       LIMIT 200`,
      [new Date(now)],
    )
  ).map((r) => ({ id: r.id, fileKey: r.file_key, orphan: r.orphan }));
}

export async function markExpired(id: string): Promise<void> {
  await query(`UPDATE data_exports SET status = 'expired', file_key = NULL WHERE id = $1`, [id]);
}

export async function deleteExport(id: string): Promise<void> {
  await query(`DELETE FROM data_exports WHERE id = $1`, [id]);
}

/** For a person's export: their earlier exports (metadata only). */
export async function exportsRequestedBy(userId: string): Promise<ExportRecord[]> {
  return (await query<Row>(`SELECT * FROM data_exports WHERE requested_by = $1 ORDER BY created_at`, [userId])).map(toExport);
}
