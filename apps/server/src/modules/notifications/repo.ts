// The only writer of `notifications`, `notification_prefs`, `pending_mentions` and `card_due_watch` [S4].
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

// ---- mentions of invited addresses (pending_mentions) ----

export interface PendingMention {
  boardId: string;
  email: string;
  actorId: string | null;
  data: NotificationData;
  dedupeKey: string;
  createdAt: number;
}

export async function addPendingMention(p: PendingMention & { id: string }): Promise<void> {
  try {
    await query(
      `INSERT INTO pending_mentions (id, board_id, email, actor_id, data, dedupe_key, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT ON CONSTRAINT pending_mentions_once DO NOTHING`,
      [p.id, p.boardId, p.email, p.actorId, JSON.stringify(p.data), p.dedupeKey, new Date(p.createdAt)],
    );
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e; // the board (or author) was deleted meanwhile
  }
}

/** Takes (deletes and returns) the board's pending mentions of `email` newer than `since`. */
export async function takePendingMentions(boardId: string, email: string, since: number): Promise<PendingMention[]> {
  const rows = await query<{ board_id: string; email: string; actor_id: string | null; data: NotificationData | string; dedupe_key: string; created_at: Date }>(
    `DELETE FROM pending_mentions WHERE board_id = $1 AND email = $2 RETURNING board_id, email, actor_id, data, dedupe_key, created_at`,
    [boardId, email],
  );
  return rows
    .map((r) => ({
      boardId: r.board_id,
      email: r.email,
      actorId: r.actor_id,
      data: typeof r.data === 'string' ? (JSON.parse(r.data) as NotificationData) : r.data,
      dedupeKey: r.dedupe_key,
      createdAt: r.created_at.getTime(),
    }))
    .filter((p) => p.createdAt >= since)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Drops pending mentions older than `before` (their invite has expired by then). */
export async function sweepPendingMentions(before: number): Promise<void> {
  await query(`DELETE FROM pending_mentions WHERE created_at < $1`, [new Date(before)]);
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

// ---- due-date reminders (KAI-135) ----

export interface CardDueWatch {
  boardId: string;
  elementId: string;
  assigneeId: string;
  /** YYYY-MM-DD */
  dueDate: string;
  title: string;
}

/**
 * Watches a card assigned to `assigneeId` and due on `dueDate` (null for either: stops watching
 * it). A changed due date may be reminded of again. An assignee that is no account is ignored.
 */
export async function setCardDueWatch(boardId: string, elementId: string, w: { assigneeId: string | null; dueDate: string | null; title: string }): Promise<void> {
  if (!w.assigneeId || !w.dueDate) {
    await query(`DELETE FROM card_due_watch WHERE board_id = $1 AND element_id = $2`, [boardId, elementId]);
    return;
  }
  try {
    await query(
      `INSERT INTO card_due_watch (board_id, element_id, assignee_id, due_date, title) VALUES ($1, $2, $3, $4::date, $5)
       ON CONFLICT (board_id, element_id) DO UPDATE SET assignee_id = excluded.assignee_id, due_date = excluded.due_date, title = excluded.title,
         reminded_for = CASE WHEN card_due_watch.due_date = excluded.due_date AND card_due_watch.assignee_id = excluded.assignee_id
                             THEN card_due_watch.reminded_for ELSE NULL END`,
      [boardId, elementId, w.assigneeId, w.dueDate, w.title],
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) return; // the board is gone, or the assignee is no account
    throw e;
  }
}

/** Cards due between `firstDay` and `lastDay` (YYYY-MM-DD, inclusive) not yet reminded of for that date. */
export async function cardsDueBetween(firstDay: string, lastDay: string, limit: number): Promise<CardDueWatch[]> {
  const rows = await query<{ board_id: string; element_id: string; assignee_id: string; due: string; title: string }>(
    `SELECT board_id, element_id, assignee_id, to_char(due_date, 'YYYY-MM-DD') AS due, title FROM card_due_watch
     WHERE due_date BETWEEN $1::date AND $2::date AND (reminded_for IS NULL OR reminded_for <> due_date)
     ORDER BY due_date LIMIT $3`,
    [firstDay, lastDay, limit],
  );
  return rows.map((r) => ({ boardId: r.board_id, elementId: r.element_id, assigneeId: r.assignee_id, dueDate: r.due, title: r.title }));
}

/** The reminder for this due date went out (or there is nothing to remind of for it). */
export async function markCardReminded(boardId: string, elementId: string, dueDate: string): Promise<void> {
  await query(`UPDATE card_due_watch SET reminded_for = $3::date WHERE board_id = $1 AND element_id = $2 AND due_date = $3::date`, [boardId, elementId, dueDate]);
}
