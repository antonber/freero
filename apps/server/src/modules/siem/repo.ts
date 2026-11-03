// The only writer of `siem_sinks` [S4].
import type { SiemKind, SiemSettings } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface SinkRow {
  id: string;
  workspaceId: string;
  kind: SiemKind;
  name: string;
  settings: SiemSettings;
  /** Sealed JSON of the kind's secrets. */
  secretsSealed: string;
  enabled: boolean;
  cursorSeq: number;
  anchoredSeq: number;
  anchoredAt: number | null;
  consecutiveFailures: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  lastAttemptAt: number | null;
  lastDeliveredAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}
interface Row {
  id: string;
  workspace_id: string;
  kind: SiemKind;
  name: string;
  settings: SiemSettings | string;
  secrets_sealed: string;
  enabled: boolean;
  cursor_seq: string | number;
  anchored_seq: string | number;
  anchored_at: Date | null;
  consecutive_failures: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  last_attempt_at: Date | null;
  last_delivered_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}
const ms = (d: Date | null) => d?.getTime() ?? null;
const toSink = (r: Row): SinkRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  name: r.name,
  settings: typeof r.settings === 'string' ? (JSON.parse(r.settings) as SiemSettings) : r.settings,
  secretsSealed: r.secrets_sealed,
  enabled: r.enabled,
  cursorSeq: Number(r.cursor_seq),
  anchoredSeq: Number(r.anchored_seq),
  anchoredAt: ms(r.anchored_at),
  consecutiveFailures: r.consecutive_failures,
  nextAttemptAt: ms(r.next_attempt_at),
  lastError: r.last_error,
  lastAttemptAt: ms(r.last_attempt_at),
  lastDeliveredAt: ms(r.last_delivered_at),
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/** Serialises adding sinks to one workspace (the per-workspace cap). */
export async function lockWorkspaceSinks(workspaceId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('siem.sinks'), hashtext($1))`, [workspaceId]);
}

export async function countSinks(workspaceId: string): Promise<number> {
  return Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM siem_sinks WHERE workspace_id = $1`, [workspaceId]))?.n ?? 0);
}

export async function insertSink(s: SinkRow): Promise<void> {
  await query(
    `INSERT INTO siem_sinks (id, workspace_id, kind, name, settings, secrets_sealed, enabled, cursor_seq, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $10)`,
    [s.id, s.workspaceId, s.kind, s.name, JSON.stringify(s.settings), s.secretsSealed, s.enabled, s.cursorSeq, s.createdBy, new Date(s.createdAt)],
  );
}

export async function sinksOf(workspaceId: string): Promise<SinkRow[]> {
  return (await query<Row>(`SELECT * FROM siem_sinks WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toSink);
}

export async function getSink(workspaceId: string, id: string): Promise<SinkRow | null> {
  const r = await one<Row>(`SELECT * FROM siem_sinks WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
  return r ? toSink(r) : null;
}

/** Settings, secrets, name or the switch changed; turning it (back) on retries at once. */
export async function updateSink(
  id: string,
  p: { name?: string; settings?: SiemSettings; secretsSealed?: string; enabled?: boolean },
  now: number,
): Promise<SinkRow | null> {
  const r = await one<Row>(
    `UPDATE siem_sinks SET
       name = COALESCE($2, name),
       settings = COALESCE($3::jsonb, settings),
       secrets_sealed = COALESCE($4, secrets_sealed),
       enabled = COALESCE($5, enabled),
       next_attempt_at = CASE WHEN $3::jsonb IS NOT NULL OR $4 IS NOT NULL OR $5 THEN NULL ELSE next_attempt_at END,
       updated_at = $6
     WHERE id = $1 RETURNING *`,
    [id, p.name ?? null, p.settings ? JSON.stringify(p.settings) : null, p.secretsSealed ?? null, p.enabled ?? null, new Date(now)],
  );
  return r ? toSink(r) : null;
}

export async function resealSecrets(id: string, sealed: string, resealed: string): Promise<void> {
  await query(`UPDATE siem_sinks SET secrets_sealed = $3 WHERE id = $1 AND secrets_sealed = $2`, [id, sealed, resealed]);
}

export async function deleteSink(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM siem_sinks WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, id])).length > 0;
}

/** Enabled sinks due for an attempt. */
export async function dueSinks(now: number, limit: number): Promise<SinkRow[]> {
  return (
    await query<Row>(
      `SELECT * FROM siem_sinks WHERE enabled AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY next_attempt_at NULLS FIRST, id LIMIT $2`,
      [new Date(now), limit],
    )
  ).map(toSink);
}

/**
 * A batch arrived: the cursor moves to `seq` — only forward, and only from where this attempt
 * started (a concurrent edit that reset nothing can't be overtaken twice).
 */
export async function markDelivered(id: string, fromSeq: number, seq: number, anchor: { seq: number } | null, now: number): Promise<void> {
  await query(
    `UPDATE siem_sinks SET cursor_seq = GREATEST(cursor_seq, $3), consecutive_failures = 0, next_attempt_at = NULL, last_error = NULL,
       last_attempt_at = $5, last_delivered_at = $5,
       anchored_seq = CASE WHEN $4::bigint IS NULL THEN anchored_seq ELSE GREATEST(anchored_seq, $4::bigint) END,
       anchored_at = CASE WHEN $4::bigint IS NULL THEN anchored_at ELSE $5 END
     WHERE id = $1 AND cursor_seq = $2`,
    [id, fromSeq, seq, anchor?.seq ?? null, new Date(now)],
  );
}

export async function markFailed(id: string, error: string, retryAt: number, now: number): Promise<void> {
  await query(
    `UPDATE siem_sinks SET consecutive_failures = consecutive_failures + 1, next_attempt_at = $3, last_error = $2, last_attempt_at = $4 WHERE id = $1`,
    [id, error.slice(0, 500), new Date(retryAt), new Date(now)],
  );
}
