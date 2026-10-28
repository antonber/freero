// The only writer of `board_activity` [S4].
import { isForeignKeyViolation, one, query } from '../../platform/db';

export type ActivityKind = 'edit' | 'comment' | 'share';
export type Audience = 'all' | 'editors';

/** What a row says happened (worded when read: service.ts). */
export interface ActivitySummary {
  /** Element type -> how many (net over the burst). */
  added?: Record<string, number>;
  changed?: Record<string, number>;
  removed?: Record<string, number>;
  /** The frame every change was in, when there was exactly one. */
  frame?: string;
  /** How many frames the changes touched (when more than one). */
  frames?: number;
  /** kind 'comment': new messages, and in how many threads. */
  comments?: number;
  threads?: number;
  /** kind 'share': who got access, and as what ('request': by approving their request). */
  userId?: string;
  role?: string;
  via?: 'invite' | 'request';
}

export interface ActivityRow {
  id: string;
  boardId: string;
  actorId: string;
  actorName: string | null;
  kind: ActivityKind;
  audience: Audience;
  summary: ActivitySummary;
  startedAt: number;
  endedAt: number;
}

interface Row {
  id: string;
  board_id: string;
  actor_id: string;
  actor_name: string | null;
  kind: ActivityKind;
  audience: Audience;
  summary: ActivitySummary | string;
  started_at: Date;
  ended_at: Date;
}

const toRow = (r: Row): ActivityRow => ({
  id: r.id,
  boardId: r.board_id,
  actorId: r.actor_id,
  actorName: r.actor_name,
  kind: r.kind,
  audience: r.audience,
  summary: typeof r.summary === 'string' ? (JSON.parse(r.summary) as ActivitySummary) : r.summary,
  startedAt: r.started_at.getTime(),
  endedAt: r.ended_at.getTime(),
});

/** Stores rows; one whose board was deleted meanwhile is skipped. */
export async function insertMany(rows: ActivityRow[]): Promise<void> {
  for (const r of rows) {
    try {
      await query(
        `INSERT INTO board_activity (id, board_id, actor_id, actor_name, kind, audience, summary, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [r.id, r.boardId, r.actorId, r.actorName, r.kind, r.audience, JSON.stringify(r.summary), new Date(r.startedAt), new Date(r.endedAt)],
      );
    } catch (e) {
      if (!isForeignKeyViolation(e)) throw e;
    }
  }
}

/**
 * Newest first, across `boardIds`; rows for hidden frames' contents ('editors') only for the
 * boards in `editorBoardIds`. `before`: rows that ended before this instant (paging).
 */
export async function recent(boardIds: string[], editorBoardIds: string[], before: number | null, limit: number): Promise<ActivityRow[]> {
  if (boardIds.length === 0) return [];
  return (
    await query<Row>(
      `SELECT * FROM board_activity
       WHERE board_id = ANY($1::text[]) AND (audience = 'all' OR board_id = ANY($2::text[]))
         AND ($3::timestamptz IS NULL OR ended_at < $3)
       ORDER BY ended_at DESC, id DESC LIMIT $4`,
      [boardIds, editorBoardIds, before === null ? null : new Date(before), limit],
    )
  ).map(toRow);
}

/** Deletes rows that ended before `before` (retention); returns how many. */
export async function pruneBefore(before: number): Promise<number> {
  const r = await one<{ n: number }>(
    `WITH gone AS (DELETE FROM board_activity WHERE ended_at < $1 RETURNING 1) SELECT count(*)::int AS n FROM gone`,
    [new Date(before)],
  );
  return r?.n ?? 0;
}
