// The only writer of `boards`, `board_stars` and `board_opens` [S4].
import { randomUUID } from 'node:crypto';
import type { LinkAccess, ObjectKind } from '@freero/shared';
import { one, query, tx } from '../../platform/db';
import { appendOutbox } from '../../platform/outbox';

export interface Board {
  id: string;
  /** What the container holds (KAI-162): the canvas, or a doc. Every access rule is the same. */
  kind: ObjectKind;
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
  /** Taken down by an operator (moderation); null for a board in service. */
  removedAt: number | null;
  /** An operator turned link sharing off: `linkAccess` reads 'none' meanwhile. */
  linkBlocked: boolean;
  /** The owner's link setting, kept while link sharing is blocked or expired (moderation views, the share dialog). */
  storedLinkAccess: LinkAccess;
  /** scrypt hash of the link's password (KAI-145), or null. Never leaves this module. */
  linkPasswordHash: string | null;
  /** Bumped on every password change: unlocks of an earlier revision no longer count. */
  linkPasswordRev: number;
  /** When the link stops granting anything, or null. `linkAccess` reads 'none' from then on. */
  linkExpiresAt: number | null;
  /** The call link its editors set (KAI-134), or null. */
  callUrl: string | null;
  /** Use the board's own room on the operator's Jitsi instead. */
  callJitsi: boolean;
}

interface Row {
  id: string;
  kind: ObjectKind;
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
  removed_at: Date | null;
  link_blocked_at: Date | null;
  link_password_hash: string | null;
  link_password_rev: number;
  link_expires_at: Date | null;
  call_url: string | null;
  call_jitsi: boolean;
}

// Link access is resolved here, once: everything that reads a board (roles, lists, sockets,
// summaries) sees 'none' while an operator blocks the link, and once the owner's expiry passed.
// (A link password depends on who asks: boards' service applies it per person.)
const toBoard = (r: Row, now = Date.now()): Board => ({
  id: r.id,
  kind: r.kind === 'doc' ? 'doc' : 'board',
  title: r.title,
  description: r.description,
  ownerId: r.owner_id,
  linkAccess: r.link_blocked_at || (r.link_expires_at && r.link_expires_at.getTime() <= now) ? 'none' : r.link_access,
  thumbnail: r.thumbnail,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
  deletedAt: r.deleted_at ? r.deleted_at.getTime() : null,
  workspaceId: r.workspace_id,
  projectId: r.project_id,
  removedAt: r.removed_at ? r.removed_at.getTime() : null,
  linkBlocked: r.link_blocked_at !== null,
  storedLinkAccess: r.link_access,
  linkPasswordHash: r.link_password_hash,
  linkPasswordRev: r.link_password_rev,
  linkExpiresAt: r.link_expires_at ? r.link_expires_at.getTime() : null,
  callUrl: r.call_url,
  callJitsi: r.call_jitsi,
});

/** A board in service: not in the trash, not taken down by an operator. */
const LIVE = `deleted_at IS NULL AND removed_at IS NULL`;

/**
 * Runs fn in one database transaction: every write made inside it — by this module or by other
 * modules' exported functions — commits together or not at all.
 */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

/**
 * Outbox topic of what happens to a board as a whole (KAI-150): created, renamed, moved, trashed,
 * restored — appended in the transaction that makes the change, so the event stream
 * (modules/events) and derived indexes (search: titles) never miss one. Unique key per event: a
 * consumer's batch coalesces per key, and two changes of one board in a batch are two events.
 */
export const BOARD_EVENTS_TOPIC = 'board.events';
export interface BoardEventRecord {
  type: 'board.created' | 'board.renamed' | 'board.moved' | 'board.trashed' | 'board.restored';
  boardId: string;
  workspaceId: string;
  actorId: string;
  at: number;
  title: string;
  from?: string | null;
  to?: string | null;
  copyOf?: string;
  /** [additive] 'doc' when the container is a doc (KAI-162); absent for boards. */
  kind?: 'doc';
}
/** Records a board event in the CALLER'S transaction (call it next to the change it describes). */
export async function appendBoardEvent(e: Omit<BoardEventRecord, 'at'>, at = Date.now()): Promise<void> {
  await appendOutbox(BOARD_EVENTS_TOPIC, `${e.boardId}:${randomUUID()}`, { ...e, at } satisfies BoardEventRecord);
}

export async function insertBoard(b: Board): Promise<void> {
  await query(
    `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at, workspace_id, project_id, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [b.id, b.title, b.description, b.ownerId, b.linkAccess, b.thumbnail, new Date(b.createdAt), new Date(b.updatedAt), b.workspaceId, b.projectId, b.kind],
  );
}

/** A live board (null when missing, in the trash or taken down). */
export async function getBoard(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1 AND ${LIVE}`, [id]);
  return r ? toBoard(r) : null;
}

/** A board whatever its state (moderation, and telling "taken down" from "no such board"). */
export async function getBoardAnyState(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1`, [id]);
  return r ? toBoard(r) : null;
}

/** Takes a board down (`at`) or restores it (null); false when that changed nothing. */
export async function setRemoved(id: string, at: number | null): Promise<boolean> {
  const rows =
    at === null
      ? await query(`UPDATE boards SET removed_at = NULL WHERE id = $1 AND removed_at IS NOT NULL RETURNING id`, [id])
      : await query(`UPDATE boards SET removed_at = $2 WHERE id = $1 AND removed_at IS NULL RETURNING id`, [id, new Date(at)]);
  return rows.length > 0;
}

/** Blocks the board's link sharing (`at`) or unblocks it (null); false when that changed nothing. */
export async function setLinkBlocked(id: string, at: number | null): Promise<boolean> {
  const rows =
    at === null
      ? await query(`UPDATE boards SET link_blocked_at = NULL WHERE id = $1 AND link_blocked_at IS NOT NULL RETURNING id`, [id])
      : await query(`UPDATE boards SET link_blocked_at = $2 WHERE id = $1 AND link_blocked_at IS NULL RETURNING id`, [id, new Date(at)]);
  return rows.length > 0;
}

/** A board whether live or in the trash (restore, delete forever). */
export async function getBoardIncludingTrash(id: string): Promise<Board | null> {
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1`, [id]);
  return r ? toBoard(r) : null;
}

/** The live boards among ids. */
export async function getBoards(ids: string[]): Promise<Board[]> {
  if (ids.length === 0) return [];
  return (await query<Row>(`SELECT * FROM boards WHERE id = ANY($1::text[]) AND ${LIVE}`, [ids])).map((r) => toBoard(r));
}

/** What each of these containers is (any state; missing ids are absent). One query. */
export async function kindsOf(ids: string[]): Promise<Map<string, ObjectKind>> {
  if (!ids.length) return new Map();
  const rows = await query<{ id: string; kind: ObjectKind }>(`SELECT id, kind FROM boards WHERE id = ANY($1::text[])`, [ids]);
  return new Map(rows.map((r) => [r.id, r.kind === 'doc' ? 'doc' : 'board']));
}

/** Every board id (trash included), for operator rebuilds of derived indexes. */
export async function allIds(): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards ORDER BY id`)).map((r) => r.id);
}

/** Ids of the user's live boards. */
/** The boards with these ids, trashed ones included (data exports). */
export async function getBoardsIncludingTrash(ids: string[]): Promise<Board[]> {
  if (!ids.length) return [];
  return (await query<Row>(`SELECT * FROM boards WHERE id = ANY($1::text[]) ORDER BY created_at, id`, [ids])).map((r) => toBoard(r));
}

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
    await query<Row>(
      `SELECT * FROM boards WHERE owner_id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL AND removed_at IS NULL ORDER BY deleted_at DESC`,
      [
      ownerId,
      workspaceId,
    ])
  ).map((r) => toBoard(r));
}

// ---- workspaces and projects ----

/** The live boards of a workspace. */
export async function boardsInWorkspace(workspaceId: string): Promise<Board[]> {
  return (await query<Row>(`SELECT * FROM boards WHERE workspace_id = $1 AND ${LIVE}`, [workspaceId])).map((r) => toBoard(r));
}

/**
 * Live boards that are in one of `workspaceIds` or are one of `ids`, optionally only those of
 * `onlyWorkspace` (ids and where they are; the caller decides access).
 */
export async function liveIdsAmong(workspaceIds: string[], ids: string[], onlyWorkspace: string | null): Promise<Array<{ id: string; workspaceId: string }>> {
  return (
    await query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM boards
       WHERE (workspace_id = ANY($1::text[]) OR id = ANY($2::text[])) AND ($3::text IS NULL OR workspace_id = $3) AND ${LIVE}`,
      [workspaceIds, ids, onlyWorkspace],
    )
  ).map((r) => ({ id: r.id, workspaceId: r.workspace_id }));
}

/** Every board of a workspace, trashed ones included. */
export async function idsInWorkspace(workspaceId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE workspace_id = $1`, [workspaceId])).map((r) => r.id);
}

/** Usage of a workspace's boards (admin console): counts, live boards per owner, recent openers. */
export async function workspaceStats(
  workspaceId: string,
  now: number,
): Promise<{ live: number; trashed: number; ownedBy: Map<string, number>; active7d: number; active30d: number }> {
  const DAY = 86_400_000;
  const [counts, owners, active] = await Promise.all([
    one<{ live: number; trashed: number }>(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trashed
       FROM boards WHERE workspace_id = $1`,
      [workspaceId],
    ),
    query<{ owner_id: string; n: number }>(
      `SELECT owner_id, count(*)::int AS n FROM boards WHERE workspace_id = $1 AND deleted_at IS NULL GROUP BY owner_id`,
      [workspaceId],
    ),
    one<{ d7: number; d30: number }>(
      `SELECT count(DISTINCT o.user_id) FILTER (WHERE o.opened_at > $2)::int AS d7, count(DISTINCT o.user_id) FILTER (WHERE o.opened_at > $3)::int AS d30
       FROM board_opens o JOIN boards b ON b.id = o.board_id WHERE b.workspace_id = $1`,
      [workspaceId, new Date(now - 7 * DAY), new Date(now - 30 * DAY)],
    ),
  ]);
  return {
    live: counts?.live ?? 0,
    trashed: counts?.trashed ?? 0,
    ownedBy: new Map(owners.map((o) => [o.owner_id, o.n])),
    active7d: active?.d7 ?? 0,
    active30d: active?.d30 ?? 0,
  };
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

/** Every board the user owns, trashed ones included, except taken-down ones (account purge). */
export async function allBoardIdsOwnedBy(userId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE owner_id = $1 AND removed_at IS NULL`, [userId])).map((r) => r.id);
}

/**
 * Deletes every board the user owns, trash included, except taken-down ones (held for review);
 * returns their thumbnails (to delete the files).
 */
export async function deleteAllOwnedBy(userId: string): Promise<Array<string | null>> {
  return (
    await query<{ thumbnail: string | null }>(`DELETE FROM boards WHERE owner_id = $1 AND removed_at IS NULL RETURNING thumbnail`, [userId])
  ).map((r) => r.thumbnail);
}

/** How many taken-down boards (held for review) the user owns / the workspace holds. */
export async function countHeld(by: { ownerId: string } | { workspaceId: string }): Promise<number> {
  const r =
    'ownerId' in by
      ? await one<{ n: number }>(`SELECT count(*)::int AS n FROM boards WHERE owner_id = $1 AND removed_at IS NOT NULL`, [by.ownerId])
      : await one<{ n: number }>(`SELECT count(*)::int AS n FROM boards WHERE workspace_id = $1 AND removed_at IS NOT NULL`, [by.workspaceId]);
  return r?.n ?? 0;
}

/** Deletes a TAKEN-DOWN board for good (an operator's decision); its thumbnail, or undefined if it isn't taken down. */
export async function deleteTakenDown(id: string): Promise<string | null | undefined> {
  const r = await one<{ thumbnail: string | null }>(`DELETE FROM boards WHERE id = $1 AND removed_at IS NOT NULL RETURNING thumbnail`, [id]);
  return r ? r.thumbnail : undefined;
}

/** The user's boards in service (not trashed, not taken down): what a suspension may take down with it. */
export async function liveOwnedBy(userId: string): Promise<Array<{ id: string; title: string; linkShared: boolean }>> {
  return (
    await query<{ id: string; title: string; link_shared: boolean }>(
      `SELECT id, title, (link_access <> 'none' AND link_blocked_at IS NULL) AS link_shared FROM boards
       WHERE owner_id = $1 AND deleted_at IS NULL AND removed_at IS NULL ORDER BY created_at`,
      [userId],
    )
  ).map((r) => ({ id: r.id, title: r.title, linkShared: r.link_shared }));
}

/** Deletes up to `limit` boards trashed before `before` for good; returns what was deleted. */
/**
 * Deletes (up to `limit`) trashed boards deleted before their workspace's cutoff: `before` by
 * default, the `byWorkspace` cutoff for the workspaces listed there.
 */
export async function purgeTrashedBefore(
  before: number,
  limit: number,
  byWorkspace: Array<{ workspaceId: string; before: number }> = [],
): Promise<Array<{ id: string; thumbnail: string | null; title: string; workspaceId: string; ownerId: string; deletedAt: number }>> {
  const rows = await query<{ id: string; thumbnail: string | null; title: string; workspace_id: string; owner_id: string; deleted_at: Date }>(
    `DELETE FROM boards WHERE id IN (
       SELECT b.id FROM boards b
       LEFT JOIN unnest($3::text[], $4::timestamptz[]) AS o(workspace_id, before) ON o.workspace_id = b.workspace_id
       WHERE b.deleted_at < COALESCE(o.before, $1) AND b.removed_at IS NULL ORDER BY b.deleted_at LIMIT $2
     ) RETURNING id, thumbnail, title, workspace_id, owner_id, deleted_at`,
    [new Date(before), limit, byWorkspace.map((w) => w.workspaceId), byWorkspace.map((w) => new Date(w.before))],
  );
  return rows.map((r) => ({
    id: r.id,
    thumbnail: r.thumbnail,
    title: r.title,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    deletedAt: new Date(r.deleted_at).getTime(),
  }));
}

/** Changes only the given fields, in one statement (concurrent PATCHes of different fields both stick). */
export async function updateBoardFields(
  id: string,
  patch: { title?: string; description?: string; linkAccess?: LinkAccess },
  now: number,
): Promise<void> {
  await query(
    `UPDATE boards SET title = COALESCE($2, title), description = COALESCE($3, description),
       link_access = CASE WHEN link_blocked_at IS NULL THEN COALESCE($4, link_access) ELSE link_access END,
       updated_at = GREATEST(updated_at, $5)
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
    `DELETE FROM boards WHERE id = $1 AND deleted_at IS NOT NULL AND removed_at IS NULL RETURNING thumbnail`,
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

/** Every match of `pattern`'s first group in a board thumbnail, trashed boards included (restricted to `among` when given). */
export async function matchesInThumbnails(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name
     FROM (SELECT regexp_matches(thumbnail, $1, 'g') AS m FROM boards WHERE thumbnail IS NOT NULL) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}

// ---- share-link protection (KAI-145) ----

/**
 * Sets the link's password (a hash; null removes it) and/or its expiry, in one statement. A
 * password change bumps the revision (earlier unlocks stop counting) and drops the old unlocks.
 * Returns false if the board is gone.
 */
export async function setLinkProtection(
  id: string,
  patch: { passwordHash?: string | null; expiresAt?: number | null },
): Promise<boolean> {
  const pw = patch.passwordHash !== undefined;
  const ex = patch.expiresAt !== undefined;
  const r = await one(
    `UPDATE boards SET
       link_password_hash = CASE WHEN $2 THEN $3 ELSE link_password_hash END,
       link_password_rev = CASE WHEN $2 THEN link_password_rev + 1 ELSE link_password_rev END,
       link_expires_at = CASE WHEN $4 THEN $5::timestamptz ELSE link_expires_at END,
       link_expiry_applied_at = CASE WHEN $4 THEN NULL ELSE link_expiry_applied_at END
     WHERE id = $1 RETURNING id`,
    [id, pw, patch.passwordHash ?? null, ex, patch.expiresAt ? new Date(patch.expiresAt) : null],
  );
  if (r && pw) await query(`DELETE FROM board_link_unlocks WHERE board_id = $1`, [id]);
  return r !== null;
}

/** A deleted account: the record of which board links it unlocked goes. */
export async function forgetUnlocksOf(principalId: string): Promise<void> {
  await query(`DELETE FROM board_link_unlocks WHERE principal_id = $1`, [principalId]);
}

/** Someone gave the link's password (revision `rev`). */
export async function recordUnlock(boardId: string, principalId: string, rev: number, now: number): Promise<void> {
  await query(
    `INSERT INTO board_link_unlocks (board_id, principal_id, password_rev, unlocked_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (board_id, principal_id) DO UPDATE SET password_rev = excluded.password_rev, unlocked_at = excluded.unlocked_at`,
    [boardId, principalId, rev, new Date(now)],
  );
}

/** boardId -> password revision this person unlocked (among `boardIds`, or all of theirs). */
export async function unlocksOf(principalId: string, boardIds?: string[]): Promise<Map<string, number>> {
  const rows = await query<{ board_id: string; password_rev: number }>(
    `SELECT board_id, password_rev FROM board_link_unlocks WHERE principal_id = $1 AND ($2::text[] IS NULL OR board_id = ANY($2::text[]))`,
    [principalId, boardIds ?? null],
  );
  return new Map(rows.map((r) => [r.board_id, r.password_rev]));
}

/** Links that expired at or before `now` whose live sockets were not re-checked since (the expiry job). */
export async function expiredLinksToApply(now: number, limit: number): Promise<string[]> {
  return (
    await query<{ id: string }>(
      `SELECT id FROM boards WHERE link_expires_at <= $1 AND (link_expiry_applied_at IS NULL OR link_expiry_applied_at < link_expires_at)
       ORDER BY link_expires_at LIMIT $2`,
      [new Date(now), limit],
    )
  ).map((r) => r.id);
}

export async function markExpiryApplied(id: string, now: number): Promise<void> {
  await query(`UPDATE boards SET link_expiry_applied_at = $2 WHERE id = $1`, [id, new Date(now)]);
}

// ---- call link (KAI-134) ----

/** Sets the board's call: a meeting link, its Jitsi room, or nothing. False if the board is gone. */
export async function setCall(id: string, call: { url: string | null; jitsi: boolean }): Promise<boolean> {
  return (await one(`UPDATE boards SET call_url = $2, call_jitsi = $3 WHERE id = $1 RETURNING id`, [id, call.url, call.jitsi])) !== null;
}
