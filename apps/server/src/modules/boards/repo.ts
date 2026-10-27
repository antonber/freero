// The only writer of `boards`, `board_stars` and `board_opens` [S4].
import type { LinkAccess } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface Board {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  linkAccess: LinkAccess;
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  link_access: LinkAccess;
  thumbnail: string | null;
  created_at: Date;
  updated_at: Date;
}

const toBoard = (r: Row): Board => ({
  id: r.id,
  title: r.title,
  description: r.description,
  ownerId: r.owner_id,
  linkAccess: r.link_access,
  thumbnail: r.thumbnail,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/**
 * Runs fn in one database transaction: every write made inside it — by this module or by other
 * modules' exported functions — commits together or not at all.
 */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function insertBoard(b: Board): Promise<void> {
  await query(
    `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [b.id, b.title, b.description, b.ownerId, b.linkAccess, b.thumbnail, new Date(b.createdAt), new Date(b.updatedAt)],
  );
}

export async function getBoard(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1`, [id]);
  return r ? toBoard(r) : null;
}

export async function getBoards(ids: string[]): Promise<Board[]> {
  if (ids.length === 0) return [];
  return (await query<Row>(`SELECT * FROM boards WHERE id = ANY($1::text[])`, [ids])).map(toBoard);
}

export async function boardIdsOwnedBy(userId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE owner_id = $1`, [userId])).map((r) => r.id);
}

/** Changes only the given fields, in one statement (concurrent PATCHes of different fields both stick). */
export async function updateBoardFields(
  id: string,
  patch: { title?: string; description?: string; linkAccess?: LinkAccess },
  now: number,
): Promise<void> {
  await query(
    `UPDATE boards SET title = COALESCE($2, title), description = COALESCE($3, description),
       link_access = COALESCE($4, link_access), updated_at = GREATEST(updated_at, $5)
     WHERE id = $1`,
    [id, patch.title ?? null, patch.description ?? null, patch.linkAccess ?? null, new Date(now)],
  );
}

/** Sets the thumbnail; returns the previous one (to delete its file), or undefined if no such board. */
export async function setThumbnail(id: string, url: string | null): Promise<string | null | undefined> {
  const r = await one<{ previous: string | null }>(
    `UPDATE boards b SET thumbnail = $2 FROM (SELECT thumbnail FROM boards WHERE id = $1 FOR UPDATE) old
     WHERE b.id = $1 RETURNING old.thumbnail AS previous`,
    [id, url],
  );
  return r ? r.previous : undefined;
}

export async function touch(id: string, now: number): Promise<void> {
  await query(`UPDATE boards SET updated_at = $2 WHERE id = $1 AND updated_at < $2`, [id, new Date(now)]);
}

/** Deletes the board; stars, opens, members and the doc go with it (ON DELETE CASCADE). */
export async function deleteBoard(id: string): Promise<void> {
  await query(`DELETE FROM boards WHERE id = $1`, [id]);
}

// ---- stars ----
export async function star(boardId: string, userId: string, now: number): Promise<void> {
  await query(`INSERT INTO board_stars (board_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
    boardId,
    userId,
    new Date(now),
  ]);
}

export async function unstar(boardId: string, userId: string): Promise<void> {
  await query(`DELETE FROM board_stars WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);
}

export async function starredBoardIds(userId: string): Promise<Set<string>> {
  return new Set(
    (await query<{ board_id: string }>(`SELECT board_id FROM board_stars WHERE user_id = $1`, [userId])).map((r) => r.board_id),
  );
}

export async function isStarred(boardId: string, userId: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM board_stars WHERE board_id = $1 AND user_id = $2`, [boardId, userId])) !== null;
}

// ---- opens ----
export async function recordOpen(boardId: string, userId: string, now: number): Promise<void> {
  await query(
    `INSERT INTO board_opens (board_id, user_id, opened_at) VALUES ($1, $2, $3)
     ON CONFLICT (board_id, user_id) DO UPDATE SET opened_at = excluded.opened_at`,
    [boardId, userId, new Date(now)],
  );
}

/** boardId -> lastOpenedAt for a user. */
export async function opensOf(userId: string): Promise<Map<string, number>> {
  const rows = await query<{ board_id: string; opened_at: Date }>(
    `SELECT board_id, opened_at FROM board_opens WHERE user_id = $1`,
    [userId],
  );
  return new Map(rows.map((r) => [r.board_id, r.opened_at.getTime()]));
}

export async function lastOpenedAt(boardId: string, userId: string): Promise<number | null> {
  const r = await one<{ opened_at: Date }>(`SELECT opened_at FROM board_opens WHERE board_id = $1 AND user_id = $2`, [
    boardId,
    userId,
  ]);
  return r ? r.opened_at.getTime() : null;
}
