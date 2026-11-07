// The only writer of `problem_reports` ("Report a problem") and `problem_screenshot_deletions`.
import type { ProblemDiagnostics, ProblemStatus } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface ProblemRow {
  id: string;
  userId: string;
  note: string;
  contactOk: boolean;
  diagnostics: ProblemDiagnostics;
  screenshotKey: string | null;
  status: ProblemStatus;
  operatorNote: string;
  issueUrl: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

interface Raw {
  id: string;
  user_id: string;
  note: string;
  contact_ok: boolean;
  diagnostics: ProblemDiagnostics | string;
  screenshot_key: string | null;
  status: ProblemStatus;
  operator_note: string;
  issue_url: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const COLUMNS = 'id, user_id, note, contact_ok, diagnostics, screenshot_key, status, operator_note, issue_url, created_at, updated_at, closed_at';
const ms = (d: Date | null) => (d === null ? null : new Date(d).getTime());
const toRow = (r: Raw): ProblemRow => ({
  id: r.id,
  userId: r.user_id,
  note: r.note,
  contactOk: r.contact_ok,
  diagnostics: typeof r.diagnostics === 'string' ? (JSON.parse(r.diagnostics) as ProblemDiagnostics) : r.diagnostics,
  screenshotKey: r.screenshot_key,
  status: r.status,
  operatorNote: r.operator_note,
  issueUrl: r.issue_url,
  createdAt: new Date(r.created_at).getTime(),
  updatedAt: new Date(r.updated_at).getTime(),
  closedAt: ms(r.closed_at),
});

export async function insert(p: Pick<ProblemRow, 'id' | 'userId' | 'note' | 'contactOk' | 'diagnostics' | 'createdAt'>): Promise<ProblemRow> {
  const r = await one<Raw>(
    `INSERT INTO problem_reports (id, user_id, note, contact_ok, diagnostics, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6) RETURNING ${COLUMNS}`,
    [p.id, p.userId, p.note, p.contactOk, JSON.stringify(p.diagnostics), new Date(p.createdAt)],
  );
  return toRow(r!);
}

export async function get(id: string): Promise<ProblemRow | null> {
  const r = await one<Raw>(`SELECT ${COLUMNS} FROM problem_reports WHERE id = $1`, [id]);
  return r ? toRow(r) : null;
}

/** The person's reports, newest first. */
export async function ofUser(userId: string, limit: number): Promise<ProblemRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM problem_reports WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [userId, limit])).map(toRow);
}

/** Reports newest first, optionally of one status, older than the report `before` (a cursor). */
export async function list(f: { status: ProblemStatus | null; before: string | null; limit: number }): Promise<ProblemRow[]> {
  const rows = await query<Raw>(
    `SELECT ${COLUMNS} FROM problem_reports p
     WHERE ($1::text IS NULL OR p.status = $1)
       AND ($2::text IS NULL OR (p.created_at, p.id) < (SELECT created_at, id FROM problem_reports WHERE id = $2))
     ORDER BY p.created_at DESC, p.id DESC LIMIT $3`,
    [f.status, f.before, f.limit],
  );
  return rows.map(toRow);
}

/**
 * Attaches the screenshot to the reporter's own report: once, and only while the report is
 * younger than `madeAfter`. False when any of that doesn't hold (the caller deletes the file).
 */
export async function attachScreenshot(id: string, userId: string, key: string, madeAfter: number): Promise<boolean> {
  const r = await one(
    `UPDATE problem_reports SET screenshot_key = $3
     WHERE id = $1 AND user_id = $2 AND screenshot_key IS NULL AND created_at > $4 RETURNING id`,
    [id, userId, key, new Date(madeAfter)],
  );
  return r !== null;
}

/**
 * An operator's change. `closed_at` starts when the report moves to a closed status and is
 * cleared when it is reopened. Returns the report before and after, or null when it is gone.
 */
export async function update(
  id: string,
  patch: { status?: ProblemStatus; operatorNote?: string; issueUrl?: string | null },
  isClosed: (s: ProblemStatus) => boolean,
  now: number,
): Promise<{ before: ProblemRow; after: ProblemRow } | null> {
  return tx(async () => {
    const b = await one<Raw>(`SELECT ${COLUMNS} FROM problem_reports WHERE id = $1 FOR UPDATE`, [id]);
    if (!b) return null;
    const before = toRow(b);
    const status = patch.status ?? before.status;
    const closedAt = isClosed(status) ? (isClosed(before.status) ? before.closedAt : now) : null;
    const a = await one<Raw>(
      `UPDATE problem_reports SET status = $2, operator_note = $3, issue_url = $4, closed_at = $5,
         updated_at = CASE WHEN $2 <> status THEN $6 ELSE updated_at END
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [
        id,
        status,
        patch.operatorNote ?? before.operatorNote,
        patch.issueUrl === undefined ? before.issueUrl : patch.issueUrl,
        closedAt === null ? null : new Date(closedAt),
        new Date(now),
      ],
    );
    return { before, after: toRow(a!) };
  });
}

/**
 * Deletes every report of the person and, in the same statement, lists their screenshots as files
 * to delete (`problem_screenshot_deletions`); returns those keys (the caller deletes the files).
 */
export async function deleteOfUser(userId: string, now: number): Promise<string[]> {
  const rows = await query<{ key: string }>(
    `WITH gone AS (DELETE FROM problem_reports WHERE user_id = $1 RETURNING screenshot_key)
     INSERT INTO problem_screenshot_deletions (key, since)
     SELECT screenshot_key, $2 FROM gone WHERE screenshot_key IS NOT NULL
     ON CONFLICT (key) DO UPDATE SET since = problem_screenshot_deletions.since
     RETURNING key`,
    [userId, new Date(now)],
  );
  return rows.map((r) => r.key);
}

/** Closed reports closed before `closedBefore` (the oldest first). */
export async function closedBefore(closedBefore: number, limit: number): Promise<Array<{ id: string; screenshotKey: string | null }>> {
  const rows = await query<{ id: string; screenshot_key: string | null }>(
    `SELECT id, screenshot_key FROM problem_reports WHERE closed_at IS NOT NULL AND closed_at < $1 ORDER BY closed_at LIMIT $2`,
    [new Date(closedBefore), limit],
  );
  return rows.map((r) => ({ id: r.id, screenshotKey: r.screenshot_key }));
}

/**
 * Deletes a report if it is still closed since before `closedBefore` (a reopened one stays) and, in
 * the same statement, lists its screenshot as a file to delete. Returns whether it was deleted and
 * that screenshot's key (the caller deletes the file).
 */
export async function deleteIfStillDue(id: string, closedBefore: number, now: number): Promise<{ screenshotKey: string | null } | null> {
  const r = await one<{ screenshot_key: string | null }>(
    `WITH gone AS (DELETE FROM problem_reports WHERE id = $1 AND closed_at IS NOT NULL AND closed_at < $2 RETURNING screenshot_key),
     listed AS (
       INSERT INTO problem_screenshot_deletions (key, since)
       SELECT screenshot_key, $3 FROM gone WHERE screenshot_key IS NOT NULL ON CONFLICT (key) DO NOTHING
     )
     SELECT screenshot_key FROM gone`,
    [id, new Date(closedBefore), new Date(now)],
  );
  return r ? { screenshotKey: r.screenshot_key } : null;
}

/** Lists screenshot files to delete that no report holds (an attach that lost its race). */
export async function listScreenshotsToDelete(keys: string[], now: number): Promise<void> {
  if (!keys.length) return;
  await query(`INSERT INTO problem_screenshot_deletions (key, since) SELECT unnest($1::text[]), $2 ON CONFLICT (key) DO NOTHING`, [keys, new Date(now)]);
}

/** Screenshot files still to delete, the oldest first. */
export async function screenshotsToDelete(limit: number): Promise<string[]> {
  return (await query<{ key: string }>(`SELECT key FROM problem_screenshot_deletions ORDER BY since, key LIMIT $1`, [limit])).map((r) => r.key);
}

/** The screenshot's file is deleted: nothing is left to do for it. */
export async function screenshotDeleted(key: string): Promise<void> {
  await query(`DELETE FROM problem_screenshot_deletions WHERE key = $1`, [key]);
}
