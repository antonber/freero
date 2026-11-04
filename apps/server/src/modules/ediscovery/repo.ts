// The only writer of legal_cases, legal_case_workspaces, legal_case_subjects and legal_case_exports [S4].
import type { LegalCaseExportInfo } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface CaseRecord {
  id: string;
  placeId: string;
  placeKind: 'team' | 'organisation';
  name: string;
  description: string;
  createdBy: string | null;
  createdAt: number;
  releasedAt: number | null;
  releasedBy: string | null;
  workspaceIds: string[];
  custodianIds: string[];
  boardIds: string[];
}

interface CaseRow {
  id: string;
  place_id: string;
  place_kind: 'team' | 'organisation';
  name: string;
  description: string;
  created_by: string | null;
  created_at: Date;
  released_at: Date | null;
  released_by: string | null;
}

async function withScope(rows: CaseRow[]): Promise<CaseRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [ws, subjects] = await Promise.all([
    query<{ case_id: string; workspace_id: string }>(`SELECT case_id, workspace_id FROM legal_case_workspaces WHERE case_id = ANY($1::text[]) ORDER BY workspace_id`, [ids]),
    query<{ case_id: string; kind: 'custodian' | 'board'; subject_id: string }>(
      `SELECT case_id, kind, subject_id FROM legal_case_subjects WHERE case_id = ANY($1::text[]) ORDER BY added_at, subject_id`,
      [ids],
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    placeId: r.place_id,
    placeKind: r.place_kind,
    name: r.name,
    description: r.description,
    createdBy: r.created_by,
    createdAt: r.created_at.getTime(),
    releasedAt: r.released_at?.getTime() ?? null,
    releasedBy: r.released_by,
    workspaceIds: ws.filter((w) => w.case_id === r.id).map((w) => w.workspace_id),
    custodianIds: subjects.filter((s) => s.case_id === r.id && s.kind === 'custodian').map((s) => s.subject_id),
    boardIds: subjects.filter((s) => s.case_id === r.id && s.kind === 'board').map((s) => s.subject_id),
  }));
}

export async function insertCase(
  c: { id: string; placeId: string; placeKind: 'team' | 'organisation'; name: string; description: string; createdBy: string; workspaceIds: string[] },
  now: number,
): Promise<void> {
  await query(
    `INSERT INTO legal_cases (id, place_id, place_kind, name, description, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.id, c.placeId, c.placeKind, c.name, c.description, c.createdBy, new Date(now)],
  );
  await addWorkspaces(c.id, c.workspaceIds);
}

export async function addWorkspaces(caseId: string, workspaceIds: string[]): Promise<void> {
  if (!workspaceIds.length) return;
  await query(`INSERT INTO legal_case_workspaces (case_id, workspace_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [caseId, workspaceIds]);
}

export async function addSubjects(caseId: string, kind: 'custodian' | 'board', ids: string[], now: number): Promise<void> {
  if (!ids.length) return;
  await query(`INSERT INTO legal_case_subjects (case_id, kind, subject_id, added_at) SELECT $1, $2, unnest($3::text[]), $4 ON CONFLICT DO NOTHING`, [
    caseId,
    kind,
    ids,
    new Date(now),
  ]);
}

export async function removeSubjects(caseId: string, kind: 'custodian' | 'board', ids: string[]): Promise<void> {
  if (!ids.length) return;
  await query(`DELETE FROM legal_case_subjects WHERE case_id = $1 AND kind = $2 AND subject_id = ANY($3::text[])`, [caseId, kind, ids]);
}

export async function renameCase(caseId: string, patch: { name?: string; description?: string }): Promise<void> {
  await query(`UPDATE legal_cases SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1`, [caseId, patch.name ?? null, patch.description ?? null]);
}

/** Locks an open case for a change; null when it isn't open (released, or not this place's). */
export async function lockOpenCase(caseId: string, placeId: string): Promise<CaseRecord | null> {
  const r = await one<CaseRow>(`SELECT * FROM legal_cases WHERE id = $1 AND place_id = $2 AND released_at IS NULL FOR UPDATE`, [caseId, placeId]);
  return r ? (await withScope([r]))[0] : null;
}

export async function markReleased(caseId: string, by: string, now: number): Promise<boolean> {
  return (await query(`UPDATE legal_cases SET released_at = $2, released_by = $3 WHERE id = $1 AND released_at IS NULL RETURNING 1`, [caseId, new Date(now), by])).length > 0;
}

export async function getCase(caseId: string, placeId: string): Promise<CaseRecord | null> {
  const r = await one<CaseRow>(`SELECT * FROM legal_cases WHERE id = $1 AND place_id = $2`, [caseId, placeId]);
  return r ? (await withScope([r]))[0] : null;
}

export async function casesOf(placeId: string): Promise<CaseRecord[]> {
  return withScope(await query<CaseRow>(`SELECT * FROM legal_cases WHERE place_id = $1 ORDER BY released_at IS NOT NULL, created_at DESC`, [placeId]));
}

/** Every open case (the retention holds: few rows). */
export async function openCases(): Promise<CaseRecord[]> {
  return withScope(await query<CaseRow>(`SELECT * FROM legal_cases WHERE released_at IS NULL ORDER BY created_at`));
}

export async function hasOpenCaseAt(placeId: string, kind: 'team' | 'organisation'): Promise<boolean> {
  return (await one(`SELECT 1 FROM legal_cases WHERE place_id = $1 AND place_kind = $2 AND released_at IS NULL LIMIT 1`, [placeId, kind])) !== null;
}

export async function getCaseById(caseId: string): Promise<CaseRecord | null> {
  const r = await one<CaseRow>(`SELECT * FROM legal_cases WHERE id = $1`, [caseId]);
  return r ? (await withScope([r]))[0] : null;
}

// ---- exports ----

export interface ExportRecord extends Omit<LegalCaseExportInfo, 'requestedBy'> {
  caseId: string;
  requestedBy: string | null;
  fileKey: string | null;
  attempts: number;
}
interface ExportRow {
  id: string;
  case_id: string;
  requested_by: string | null;
  status: LegalCaseExportInfo['status'];
  attempts: number;
  file_key: string | null;
  bytes: number | string | null;
  created_at: Date;
  ready_at: Date | null;
  expires_at: Date | null;
}
const toExport = (r: ExportRow): ExportRecord => ({
  id: r.id,
  caseId: r.case_id,
  requestedBy: r.requested_by,
  status: r.status,
  attempts: r.attempts,
  fileKey: r.file_key,
  bytes: r.bytes === null ? null : Number(r.bytes),
  createdAt: r.created_at.getTime(),
  readyAt: r.ready_at?.getTime() ?? null,
  expiresAt: r.expires_at?.getTime() ?? null,
});

/** Queues an export unless one of the case is already pending or running (false). One statement. */
export async function insertExport(e: { id: string; caseId: string; requestedBy: string }, now: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO legal_case_exports (id, case_id, requested_by, status, created_at)
     SELECT $1, $2, $3, 'pending', $4
     WHERE NOT EXISTS (SELECT 1 FROM legal_case_exports WHERE case_id = $2 AND status IN ('pending', 'running'))
     RETURNING 1`,
    [e.id, e.caseId, e.requestedBy, new Date(now)],
  );
  return rows.length > 0;
}

export async function getExport(id: string): Promise<ExportRecord | null> {
  const r = await one<ExportRow>(`SELECT * FROM legal_case_exports WHERE id = $1`, [id]);
  return r ? toExport(r) : null;
}

export async function exportsOf(caseId: string): Promise<ExportRecord[]> {
  return (await query<ExportRow>(`SELECT * FROM legal_case_exports WHERE case_id = $1 ORDER BY created_at DESC LIMIT 20`, [caseId])).map(toExport);
}

/** Claims the oldest pending export (one statement: two instances never build the same one). */
export async function claimNext(now: number): Promise<ExportRecord | null> {
  const r = await one<ExportRow>(
    `UPDATE legal_case_exports SET status = 'running', started_at = $1, attempts = attempts + 1
     WHERE id = (SELECT id FROM legal_case_exports WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [new Date(now)],
  );
  return r ? toExport(r) : null;
}

export async function markReady(id: string, fileKey: string, bytes: number, now: number, expiresAt: number): Promise<boolean> {
  return (
    (
      await query(`UPDATE legal_case_exports SET status = 'ready', file_key = $2, bytes = $3, ready_at = $4, expires_at = $5 WHERE id = $1 AND status = 'running' RETURNING 1`, [
        id,
        fileKey,
        bytes,
        new Date(now),
        new Date(expiresAt),
      ])
    ).length > 0
  );
}

export async function markFailed(id: string, error: string, maxAttempts: number): Promise<void> {
  await query(`UPDATE legal_case_exports SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END, error = $2 WHERE id = $1`, [id, error.slice(0, 500), maxAttempts]);
}

export async function requeueStale(before: number): Promise<void> {
  await query(`UPDATE legal_case_exports SET status = 'pending' WHERE status = 'running' AND started_at < $1`, [new Date(before)]);
}

/** Ready exports past their expiry: their files go, the rows stay (expired) for the record. */
export async function expiredFiles(now: number): Promise<Array<{ id: string; fileKey: string | null }>> {
  return (
    await query<{ id: string; file_key: string | null }>(`SELECT id, file_key FROM legal_case_exports WHERE status = 'ready' AND expires_at <= $1`, [new Date(now)])
  ).map((r) => ({ id: r.id, fileKey: r.file_key }));
}

export async function markExpired(id: string): Promise<void> {
  await query(`UPDATE legal_case_exports SET status = 'expired', file_key = NULL WHERE id = $1`, [id]);
}
