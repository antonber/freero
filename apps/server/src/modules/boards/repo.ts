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
  /** When it was moved to the trash; null for a live board. */
  deletedAt: number | null;
  /** The workspace it belongs to (modules/workspaces) and its project there, if any. */
  workspaceId: string;
  projectId: string | null;
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
  deleted_at: Date | null;
  workspace_id: string;
  project_id: string | null;
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
  deletedAt: r.deleted_at ? r.deleted_at.getTime() : null,
  workspaceId: r.workspace_id,
  projectId: r.project_id,
});

/**
 * Runs fn in one database transaction: every write made inside it — by this module or by other
 * modules' exported functions — commits together or not at all.
 */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function insertBoard(b: Board): Promise<void> {
  await query(
    `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at, workspace_id, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [b.id, b.title, b.description, b.ownerId, b.linkAccess, b.thumbnail, new Date(b.createdAt), new Date(b.updatedAt), b.workspaceId, b.projectId],
  );
}

/** A live board (null when missing or in the trash). */
export async function getBoard(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return r ? toBoard(r) : null;
}

/** A board whether live or in the trash (restore, delete forever). */
export async function getBoardIncludingTrash(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1`, [id]);
  return r ? toBoard(r) : null;
}

/** The live boards among ids. */
export async function getBoards(ids: string[]): Promise<Board[]> {
  if (ids.length === 0) return [];
  return (await query<Row>(`SELECT * FROM boards WHERE id = ANY($1::text[]) AND deleted_at IS NULL`, [ids])).map(toBoard);
}

/** Ids of the user's live boards. */
export async function boardIdsOwnedBy(userId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE owner_id = $1 AND deleted_at IS NULL`, [userId])).map((r) => r.id);
}

/** How many live boards the user owns (the board quota; trashed boards don't count). */
export async function countLiveBoardsOwnedBy(userId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM boards WHERE owner_id = $1 AND deleted_at IS NULL`, [userId]);
  return r?.n ?? 0;
}

/**
 * Serializes quota-checked writes (create, duplicate, restore) of one owner: blocks until no other
 * transaction holds this owner's lock, and holds it until the CALLER'S transaction ends. Must run
 * inside `transaction()` (outside one, the lock would be released at once).
 */
export async function lockOwnerQuota(ownerId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('boards.quota'), hashtext($1))`, [ownerId]);
}

/** The user's trashed boards (in one workspace), most recently deleted first. */
export async function trashedBoardsOf(ownerId: string, workspaceId: string): Promise<Board[]> {
  return (
    await query<Row>(`SELECT * FROM boards WHERE owner_id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`, [
      ownerId,
      workspaceId,
    ])
  ).map(toBoard);
}

// ---- workspaces and projects ----

/** The live boards of a workspace. */
export async function boardsInWorkspace(workspaceId: string): Promise<Board[]> {
  return (await query<Row>(`SELECT * FROM boards WHERE workspace_id = $1 AND deleted_at IS NULL`, [workspaceId])).map(toBoard);
}

/** Every board of a workspace, trashed ones included. */
export async function idsInWorkspace(workspaceId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE workspace_id = $1`, [workspaceId])).map((r) => r.id);
}

export async function idsInProject(projectId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE project_id = $1`, [projectId])).map((r) => r.id);
}

export async function countLiveInProject(projectId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM boards WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]);
  return r?.n ?? 0;
}

/** Deletes every board of a workspace, trash included; returns what was deleted (to close docs, delete files). */
export async function deleteAllInWorkspace(workspaceId: string): Promise<Array<{ id: string; thumbnail: string | null }>> {
  return query<{ id: string; thumbnail: string | null }>(`DELETE FROM boards WHERE workspace_id = $1 RETURNING id, thumbnail`, [workspaceId]);
}

/** Hands a board to `ownerId`, possibly into another workspace / project. False if the board is gone. */
export async function setOwner(id: string, ownerId: string, workspaceId: string, projectId: string | null, now: number): Promise<boolean> {
  return (
    (await one(
      `UPDATE boards SET owner_id = $2, workspace_id = $3, project_id = $4, updated_at = GREATEST(updated_at, $5) WHERE id = $1 RETURNING id`,
      [id, ownerId, workspaceId, projectId, new Date(now)],
    )) !== null
  );
}

/** Every board (trash included) `from` owns in the workspace passes to `to`; returns their ids. */
export async function transferOwnedIn(workspaceId: string, from: string, to: string): Promise<string[]> {
  return (
    await query<{ id: string }>(`UPDATE boards SET owner_id = $3 WHERE workspace_id = $1 AND owner_id = $2 RETURNING id`, [workspaceId, from, to])
  ).map((r) => r.id);
}

/** Moves a live board into a project of its workspace (null: the root). False if it is not live. */
export async function setProject(id: string, projectId: string | null): Promise<boolean> {
  return (await one(`UPDATE boards SET project_id = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id, projectId])) !== null;
}

/** Moves a live board to the trash; false if it was not live (already trashed or gone). */
export async function trashBoard(id: string, now: number): Promise<boolean> {
  return (await one(`UPDATE boards SET deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id, new Date(now)])) !== null;
}

/** Takes a board out of the trash; false if it was not in the trash. */
export async function restoreBoard(id: string): Promise<boolean> {
  return (await one(`UPDATE boards SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`, [id])) !== null;
}

/** Every board the user owns, trashed ones included (account purge). */
export async function allBoardIdsOwnedBy(userId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE owner_id = $1`, [userId])).map((r) => r.id);
}

/** Deletes every board the user owns, trash included; returns their thumbnails (to delete the files). */
export async function deleteAllOwnedBy(userId: string): Promise<Array<string | null>> {
  return (await query<{ thumbnail: string | null }>(`DELETE FROM boards WHERE owner_id = $1 RETURNING thumbnail`, [userId])).map(
    (r) => r.thumbnail,
  );
}

/** Deletes up to `limit` boards trashed before `before` for good; returns what was deleted. */
export async function purgeTrashedBefore(before: number, limit: number): Promise<Array<{ id: string; thumbnail: string | null }>> {
  return query<{ id: string; thumbnail: string | null }>(
    `DELETE FROM boards WHERE id IN (
       SELECT id FROM boards WHERE deleted_at < $1 ORDER BY deleted_at LIMIT $2
     ) RETURNING id, thumbnail`,
    [new Date(before), limit],
  );
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

/**
 * Deletes a TRASHED board for good; stars, opens, members and the doc go with it (ON DELETE
 * CASCADE). Returns its thumbnail (to delete the file), or undefined if it was not in the trash.
 */
export async function deleteTrashedBoard(id: string): Promise<string | null | undefined> {
  const r = await one<{ thumbnail: string | null }>(
    `DELETE FROM boards WHERE id = $1 AND deleted_at IS NOT NULL RETURNING thumbnail`,
    [id],
  );
  return r ? r.thumbnail : undefined;
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
