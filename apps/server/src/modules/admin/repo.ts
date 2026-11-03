// The only writer of `workspace_usage_daily` [S4] (#65: the admin console's usage trends).
import type { UsageDay } from '@freero/shared';
import { query } from '../../platform/db';

/** Records (or, run again the same day, replaces) a workspace's counts for one UTC day. */
export async function upsertDay(workspaceId: string, d: UsageDay, now: number): Promise<void> {
  await query(
    `INSERT INTO workspace_usage_daily (workspace_id, day, active_7d, active_30d, boards_created, docs_created, members, guests, api_calls, recorded_at)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (workspace_id, day) DO UPDATE SET active_7d = excluded.active_7d, active_30d = excluded.active_30d,
       boards_created = excluded.boards_created, docs_created = excluded.docs_created, members = excluded.members,
       guests = excluded.guests, api_calls = excluded.api_calls, recorded_at = excluded.recorded_at`,
    [workspaceId, d.day, d.activeUsers7d, d.activeUsers30d, d.boardsCreated, d.docsCreated, d.members, d.guests, JSON.stringify(d.apiCalls), new Date(now)],
  );
}

/** A workspace's days from `since` (YYYY-MM-DD) on, oldest first. */
export async function daysOf(workspaceId: string, since: string): Promise<UsageDay[]> {
  const rows = await query<{
    day: string | Date;
    active_7d: number;
    active_30d: number;
    boards_created: number;
    docs_created: number;
    members: number;
    guests: number;
    api_calls: Record<string, number> | string;
  }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, active_7d, active_30d, boards_created, docs_created, members, guests, api_calls
     FROM workspace_usage_daily WHERE workspace_id = $1 AND day >= $2::date ORDER BY day`,
    [workspaceId, since],
  );
  return rows.map((r) => ({
    day: String(r.day),
    activeUsers7d: r.active_7d,
    activeUsers30d: r.active_30d,
    boardsCreated: r.boards_created,
    docsCreated: r.docs_created,
    members: r.members,
    guests: r.guests,
    apiCalls: typeof r.api_calls === 'string' ? (JSON.parse(r.api_calls) as Record<string, number>) : r.api_calls,
  }));
}

/** Drops days before `before` (YYYY-MM-DD); returns how many. */
export async function pruneBefore(before: string): Promise<number> {
  return (await query(`DELETE FROM workspace_usage_daily WHERE day < $1::date RETURNING 1`, [before])).length;
}
