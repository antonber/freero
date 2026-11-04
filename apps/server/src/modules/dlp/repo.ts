// The only writer of `dlp_settings`, `dlp_board_scans` and `dlp_findings` [S4].
import type { SensitiveDataAction, SensitiveDataKind, SensitiveDataSettings } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function getSettings(workspaceId: string): Promise<SensitiveDataSettings | null> {
  const r = await one<{ enabled: boolean; kinds: SensitiveDataKind[]; action: SensitiveDataAction; label_id: string | null }>(
    `SELECT enabled, kinds, action, label_id FROM dlp_settings WHERE workspace_id = $1`,
    [workspaceId],
  );
  return r ? { enabled: r.enabled, kinds: r.kinds, action: r.action, labelId: r.label_id } : null;
}

export async function putSettings(workspaceId: string, s: SensitiveDataSettings, userId: string, now: number): Promise<void> {
  await query(
    `INSERT INTO dlp_settings (workspace_id, enabled, kinds, action, label_id, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = $2, kinds = $3, action = $4, label_id = $5, updated_by = $6, updated_at = $7`,
    [workspaceId, s.enabled, s.kinds, s.action, s.labelId, userId, new Date(now)],
  );
}

export interface FindingRow {
  itemKey: string;
  elementId: string | null;
  kind: SensitiveDataKind;
  count: number;
}

/**
 * Replaces the board's findings with `findings`, derived at `version` for `workspaceId`, unless a
 * newer derivation is stored. Returns the kinds the board holds now that it didn't before (null:
 * stale, nothing written).
 */
export async function replaceFindings(boardId: string, workspaceId: string, version: number, findings: FindingRow[], now: number): Promise<SensitiveDataKind[] | null> {
  return tx(async () => {
    const at = new Date(now);
    const claimed = await one(
      `INSERT INTO dlp_board_scans (board_id, workspace_id, version, scanned_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id) DO UPDATE SET workspace_id = $2, version = $3, scanned_at = $4 WHERE dlp_board_scans.version < $3
       RETURNING 1`,
      [boardId, workspaceId, version, at],
    );
    if (!claimed) return null;
    const before = new Set(
      (await query<{ kind: SensitiveDataKind }>(`SELECT DISTINCT kind FROM dlp_findings WHERE board_id = $1`, [boardId])).map((r) => r.kind),
    );
    const firstSeen = new Map(
      (await query<{ item_key: string; kind: string; first_found_at: Date }>(`SELECT item_key, kind, first_found_at FROM dlp_findings WHERE board_id = $1`, [boardId])).map((r) => [
        `${r.item_key}\0${r.kind}`,
        r.first_found_at,
      ]),
    );
    await query(`DELETE FROM dlp_findings WHERE board_id = $1`, [boardId]);
    if (findings.length)
      await query(
        `INSERT INTO dlp_findings (board_id, item_key, element_id, kind, count, first_found_at)
         SELECT $1, f.item_key, f.element_id, f.kind, f.count, f.at
         FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::timestamptz[]) AS f(item_key, element_id, kind, count, at)`,
        [
          boardId,
          findings.map((f) => f.itemKey),
          findings.map((f) => f.elementId),
          findings.map((f) => f.kind),
          findings.map((f) => f.count),
          findings.map((f) => firstSeen.get(`${f.itemKey}\0${f.kind}`) ?? at),
        ],
      );
    return [...new Set(findings.map((f) => f.kind))].filter((k) => !before.has(k));
  });
}

/** A board no longer scanned (its workspace turned the scan off, or it is gone): nothing kept. */
export async function forgetBoard(boardId: string): Promise<void> {
  await query(`DELETE FROM dlp_board_scans WHERE board_id = $1`, [boardId]);
}

export async function forgetWorkspace(workspaceId: string): Promise<void> {
  await query(`DELETE FROM dlp_board_scans WHERE workspace_id = $1`, [workspaceId]);
}

/** The kinds the board holds now. */
export async function kindsOn(boardId: string): Promise<SensitiveDataKind[]> {
  return (await query<{ kind: SensitiveDataKind }>(`SELECT DISTINCT kind FROM dlp_findings WHERE board_id = $1 ORDER BY kind`, [boardId])).map((r) => r.kind);
}

export interface WorkspaceFinding extends FindingRow {
  boardId: string;
  foundAt: number;
}

/** The workspace's findings, newest first. */
export async function findingsIn(workspaceId: string, limit: number): Promise<WorkspaceFinding[]> {
  return (
    await query<{ board_id: string; item_key: string; element_id: string | null; kind: SensitiveDataKind; count: number; first_found_at: Date }>(
      `SELECT f.board_id, f.item_key, f.element_id, f.kind, f.count, f.first_found_at
       FROM dlp_findings f JOIN dlp_board_scans s ON s.board_id = f.board_id
       WHERE s.workspace_id = $1 ORDER BY f.first_found_at DESC, f.board_id, f.item_key, f.kind LIMIT $2`,
      [workspaceId, limit],
    )
  ).map((r) => ({ boardId: r.board_id, itemKey: r.item_key, elementId: r.element_id, kind: r.kind, count: Number(r.count), foundAt: r.first_found_at.getTime() }));
}
