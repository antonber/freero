// The only writer of `boards`, `board_stars` and `board_opens` [S4].
import type { LinkAccess } from '@freero/shared';
import { sql, transaction } from '../../platform/db';

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
  created_at: number;
  updated_at: number;
}

const toBoard = (r: Row): Board => ({
  id: r.id,
  title: r.title,
  description: r.description,
  ownerId: r.owner_id,
  linkAccess: r.link_access,
  thumbnail: r.thumbnail,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export function insertBoard(b: Board): void {
  sql(
    `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(b.id, b.title, b.description, b.ownerId, b.linkAccess, b.thumbnail, b.createdAt, b.updatedAt);
}

export function getBoard(id: string): Board | null {
  const r = sql(`SELECT * FROM boards WHERE id = ?`).get(id) as Row | undefined;
  return r ? toBoard(r) : null;
}

export function getBoards(ids: string[]): Board[] {
  return ids.map(getBoard).filter((b): b is Board => b !== null);
}

export function boardIdsOwnedBy(userId: string): string[] {
  return (sql(`SELECT id FROM boards WHERE owner_id = ?`).all(userId) as Array<{ id: string }>).map((r) => r.id);
}

export function updateBoardFields(
  id: string,
  patch: { title?: string; description?: string; linkAccess?: LinkAccess },
  now: number,
): void {
  const cur = getBoard(id);
  if (!cur) return;
  sql(`UPDATE boards SET title = ?, description = ?, link_access = ?, updated_at = ? WHERE id = ?`).run(
    patch.title ?? cur.title,
    patch.description ?? cur.description,
    patch.linkAccess ?? cur.linkAccess,
    now,
    id,
  );
}

export function setThumbnail(id: string, url: string | null): void {
  sql(`UPDATE boards SET thumbnail = ? WHERE id = ?`).run(url, id);
}

export function touch(id: string, now: number): void {
  sql(`UPDATE boards SET updated_at = ? WHERE id = ? AND updated_at < ?`).run(now, id, now);
}

export function deleteBoardRows(id: string): void {
  transaction(() => {
    sql(`DELETE FROM board_stars WHERE board_id = ?`).run(id);
    sql(`DELETE FROM board_opens WHERE board_id = ?`).run(id);
    sql(`DELETE FROM boards WHERE id = ?`).run(id);
  });
}

// ---- stars ----
export function star(boardId: string, userId: string, now: number): void {
  sql(`INSERT OR IGNORE INTO board_stars (board_id, user_id, created_at) VALUES (?, ?, ?)`).run(boardId, userId, now);
}

export function unstar(boardId: string, userId: string): void {
  sql(`DELETE FROM board_stars WHERE board_id = ? AND user_id = ?`).run(boardId, userId);
}

export function starredBoardIds(userId: string): Set<string> {
  return new Set(
    (sql(`SELECT board_id FROM board_stars WHERE user_id = ?`).all(userId) as Array<{ board_id: string }>).map(
      (r) => r.board_id,
    ),
  );
}

// ---- opens ----
export function recordOpen(boardId: string, userId: string, now: number): void {
  sql(
    `INSERT INTO board_opens (board_id, user_id, opened_at) VALUES (?, ?, ?)
     ON CONFLICT (board_id, user_id) DO UPDATE SET opened_at = excluded.opened_at`,
  ).run(boardId, userId, now);
}

/** boardId -> lastOpenedAt for a user. */
export function opensOf(userId: string): Map<string, number> {
  return new Map(
    (sql(`SELECT board_id, opened_at FROM board_opens WHERE user_id = ?`).all(userId) as Array<{ board_id: string; opened_at: number }>).map(
      (r) => [r.board_id, Number(r.opened_at)],
    ),
  );
}
