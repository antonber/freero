// The only writer of `notifications` and `notification_prefs` [S4].
import { isForeignKeyViolation, one, query } from '../../platform/db';
import type { NotificationData } from './types';

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  actorId: string | null;
  boardId: string | null;
  data: NotificationData;
  createdAt: number;
  readAt: number | null;
}

interface Row {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  board_id: string | null;
  data: NotificationData | string;
  created_at: Date;
  read_at: Date | null;
}

const COLUMNS = 'id, user_id, type, actor_id, board_id, data, created_at, read_at';

const toRow = (r: Row): NotificationRow => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  actorId: r.actor_id,
  boardId: r.board_id,
  data: typeof r.data === 'string' ? (JSON.parse(r.data) as NotificationData) : r.data,
  createdAt: r.created_at.getTime(),
  readAt: r.read_at ? r.read_at.getTime() : null,
});

/** False when it already exists (same dedupe key) or its recipient / board is gone. */
export async function insert(n: Omit<NotificationRow, 'readAt'> & { dedupeKey: string | null }): Promise<boolean> {
  try {
    const rows = await query(
      `INSERT INTO notifications (id, user_id, type, actor_id, board_id, data, dedupe_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT ON CONSTRAINT notifications_dedupe_key DO NOTHING RETURNING 1`,
      [n.id, n.userId, n.type, n.actorId, n.boardId, JSON.stringify(n.data), n.dedupeKey, new Date(n.createdAt)],
    );
    return rows.length > 0;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

/** Newest first; `before` (ms) pages back. Returns one more than `limit` when there are more. */
export async function list(userId: string, limit: number, before: number | null): Promise<NotificationRow[]> {
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM notifications
     WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [userId, before === null ? null : new Date(before), limit + 1],
  );
  return rows.map(toRow);
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await one<{ n: number | string }>(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return Number(r?.n ?? 0);
}

/** Marks the user's notifications read (`ids` null: all of them). Returns how many changed. */
export async function markRead(userId: string, ids: string[] | null, now: number): Promise<number> {
  const rows = ids
    ? await query(`UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND id = ANY($2::text[]) AND read_at IS NULL RETURNING 1`, [userId, ids, new Date(now)])
    : await query(`UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL RETURNING 1`, [userId, new Date(now)]);
  return rows.length;
}

// ---- email digests ----

/** People with notifications not yet dealt with by the digest job that are older than `cutoff`. */
export async function usersWithEmailDue(cutoff: number, limit: number): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM notifications WHERE emailed_at IS NULL AND created_at <= $1 LIMIT $2`,
    [new Date(cutoff), limit],
  );
  return rows.map((r) => r.user_id);
}

/** Claims every notification of the user the digest job has not dealt with yet (oldest first). */
export async function claimForEmail(userId: string, now: number): Promise<NotificationRow[]> {
  const rows = await query<Row>(
    `UPDATE notifications SET emailed_at = $2 WHERE user_id = $1 AND emailed_at IS NULL RETURNING ${COLUMNS}`,
    [userId, new Date(now)],
  );
  return rows.map(toRow).sort((a, b) => a.createdAt - b.createdAt);
}

/** Hands claimed notifications back to the next run (the mail could not be sent). */
export async function unclaim(ids: string[]): Promise<void> {
  if (ids.length) await query(`UPDATE notifications SET emailed_at = NULL WHERE id = ANY($1::text[])`, [ids]);
}

// ---- preferences ----

/** type ('*' = all emails) -> email on/off, for the rows the user changed from the default. */
export async function prefs(userId: string): Promise<Map<string, boolean>> {
  const rows = await query<{ type: string; email: boolean }>(`SELECT type, email FROM notification_prefs WHERE user_id = $1`, [userId]);
  return new Map(rows.map((r) => [r.type, r.email]));
}

export async function setPref(userId: string, type: string, email: boolean): Promise<void> {
  try {
    await query(
      `INSERT INTO notification_prefs (user_id, type, email) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, type) DO UPDATE SET email = excluded.email`,
      [userId, type, email],
    );
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e; // the account was deleted meanwhile
  }
}
