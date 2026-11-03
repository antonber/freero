// The only writer of `board_activity` [S4].
import { isForeignKeyViolation, one, query } from '../../platform/db';

export type ActivityKind = 'edit' | 'comment' | 'share' | 'board';
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
  /** kind 'board' (KAI-188): what happened to it; renamed: from/to titles; moved: `to` project (null: none);
   * duplicated: `from` = the original's title; version_restored: the version's name (null: automatic). */
  action?:
    | 'created'
    | 'duplicated'
    | 'renamed'
    | 'moved'
    | 'trashed'
    | 'restored'
    | 'version_restored'
    | 'suggested'
    | 'tracker_sent'
    | 'tracker_imported'
    | 'tracker_synced'
    | 'tracker_failed'
    | 'tracker_unlinked';
  /** Tracker actions (KAI-153): the tracker's name, the issue key, items sent (by type) or issues imported, fields sent, why it failed. */
  tracker?: string;
  issue?: string | null;
  items?: Record<string, number>;
  count?: number;
  fields?: string[];
  reason?: string;
  /** action 'suggested' (KAI-169): how many changes the proposal holds (shown to owners and editors only). */
  suggestions?: number;
  from?: string | null;
  to?: string | null;
  version?: string | null;
  /** Done by an app or token for the actor (the public API, MCP; KAI-168): its name. */
  app?: string;
  /**
   * kind 'edit': which items (ids only, never content), at most MAX_ACTIVITY_ITEMS per list —
   * `more` when a list was cut. Removed ones keep their type (they are gone from the board).
   * Absent on rows stored before they were kept.
   */
  ids?: { added?: string[]; changed?: string[]; removed?: Record<string, string>; more?: boolean };
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

/**
 * Rows of `kinds` that ended after `since` on `boardIds` (editors-only rows only for
 * `editorBoardIds`), oldest first, at most `limit`. "Changes since your last visit" and the
 * "changes on your boards" email; the caller leaves out the reader's own.
 */
export async function since(
  boardIds: string[],
  editorBoardIds: string[],
  since: number,
  kinds: ActivityKind[],
  limit: number,
): Promise<ActivityRow[]> {
  if (boardIds.length === 0) return [];
  return (
    await query<Row>(
      `SELECT * FROM board_activity
       WHERE board_id = ANY($1::text[]) AND (audience = 'all' OR board_id = ANY($2::text[]))
         AND ended_at > $3 AND kind = ANY($4::text[])
       ORDER BY ended_at, id LIMIT $5`,
      [boardIds, editorBoardIds, new Date(since), kinds, limit],
    )
  ).map(toRow);
}

// ---- last visits (board_seen) ----

/** The account stopped looking at the board at `at` (an earlier moment never moves it back). */
export async function markSeen(boardId: string, userId: string, at: number): Promise<void> {
  try {
    await query(
      `INSERT INTO board_seen (board_id, user_id, seen_at) VALUES ($1, $2, $3)
       ON CONFLICT (board_id, user_id) DO UPDATE SET seen_at = GREATEST(board_seen.seen_at, excluded.seen_at)`,
      [boardId, userId, new Date(at)],
    );
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e; // the board or the account is gone
  }
}

export async function seenAt(boardId: string, userId: string): Promise<number | null> {
  const r = await one<{ seen_at: Date }>(`SELECT seen_at FROM board_seen WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);
  return r ? r.seen_at.getTime() : null;
}

/** Deletes rows that ended before `before` (retention); returns how many. */
export async function pruneBefore(before: number): Promise<number> {
  const r = await one<{ n: number }>(
    `WITH gone AS (DELETE FROM board_activity WHERE ended_at < $1 RETURNING 1) SELECT count(*)::int AS n FROM gone`,
    [new Date(before)],
  );
  return r?.n ?? 0;
}
