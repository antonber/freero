// The only writer of `boards`, `board_stars` and `board_opens` [S4].
import { randomUUID } from 'node:crypto';
import type { LinkAccess, ObjectKind } from '@freero/shared';
import { one, query, tx } from '../../platform/db';
import { appendOutbox } from '../../platform/outbox';
import { openCallUrl, sealCallUrl } from './call';

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
  /** Its owner lets other sites embed it live (#2); what the embed shows still follows its sharing. */
  embeddable: boolean;
  /** #123: editors may invite people (owners and co-owners always may). */
  editorsCanShare: boolean;
  /** #123: viewers and commenters may copy, duplicate, export and download it. */
  viewersCanExport: boolean;
  /** #97: guests on its "can edit" link may edit (while the link, the workspace and the operator allow it). */
  guestsCanEdit: boolean;
  /** #153: who moved it to the trash (null: before #153, or nobody — a retention rule). */
  deletedBy: string | null;
  /** #153: archived (read-only for everyone, out of the default lists) since, and by whom (null: a retention rule). */
  archivedAt: number | null;
  archivedBy: string | null;
  /** #158: its classification label (modules/workspaces' labels), or null. */
  labelId: string | null;
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
  embeddable: boolean | null;
  editors_can_share: boolean | null;
  viewers_can_export: boolean | null;
  guests_can_edit: boolean | null;
  deleted_by: string | null;
  archived_at: Date | null;
  archived_by: string | null;
  label_id?: string | null;
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
  callUrl: openCallUrl(r.call_url),
  callJitsi: r.call_jitsi,
  embeddable: r.embeddable === true,
  editorsCanShare: r.editors_can_share !== false,
  viewersCanExport: r.viewers_can_export !== false,
  guestsCanEdit: r.guests_can_edit === true,
  deletedBy: r.deleted_by ?? null,
  archivedAt: r.archived_at ? r.archived_at.getTime() : null,
  archivedBy: r.archived_by ?? null,
  labelId: r.label_id ?? null,
});

/** A board in service: not in the trash, not taken down by an operator. */
const LIVE = `deleted_at IS NULL AND removed_at IS NULL`;

/** The board (alias `b`) is under a legal hold (#157): picked by one, or owned by a custodian in its workspace. */
const HELD = `(EXISTS (SELECT 1 FROM board_legal_holds h WHERE h.board_id = b.id)
  OR EXISTS (SELECT 1 FROM board_owner_legal_holds h WHERE h.owner_id = b.owner_id AND h.workspace_id = b.workspace_id))`;

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
  /** Who did it; null: Freero itself (#154: a retention rule). */
  actorId: string | null;
  at: number;
  title: string;
  from?: string | null;
  to?: string | null;
  copyOf?: string;
  /** [additive, #124] board.moved into another workspace: the one it left (in the target's event) / went to (in the source's). */
  fromWorkspace?: string;
  toWorkspace?: string;
  /** [additive] 'doc' when the container is a doc (KAI-162); absent for boards. */
  kind?: 'doc';
}
/** Records a board event in the CALLER'S transaction (call it next to the change it describes). */
export async function appendBoardEvent(e: Omit<BoardEventRecord, 'at'>, at = Date.now()): Promise<void> {
  await appendOutbox(BOARD_EVENTS_TOPIC, `${e.boardId}:${randomUUID()}`, { ...e, at } satisfies BoardEventRecord);
}

export async function insertBoard(b: Board): Promise<void> {
  await query(
    `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at, workspace_id, project_id, kind, label_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [b.id, b.title, b.description, b.ownerId, b.linkAccess, b.thumbnail, new Date(b.createdAt), new Date(b.updatedAt), b.workspaceId, b.projectId, b.kind, b.labelId ?? null],
  );
}

/** #158: sets a live board's label (null: none); false when there is no such live board. */
export async function setLabel(id: string, labelId: string | null): Promise<boolean> {
  return (await query(`UPDATE boards SET label_id = $2 WHERE id = $1 AND ${LIVE} RETURNING 1`, [id, labelId])).length > 0;
}

/** #158: a workspace no longer sees these labels (it left their organisation): its boards carrying one get `to`. */
export async function replaceLabels(workspaceId: string, labelIds: string[], to: string | null): Promise<string[]> {
  if (!labelIds.length) return [];
  return (await query<{ id: string }>(`UPDATE boards SET label_id = $3 WHERE workspace_id = $1 AND label_id = ANY($2::text[]) RETURNING id`, [workspaceId, labelIds, to])).map(
    (r) => r.id,
  );
}

export async function idsWithLabel(labelId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE label_id = $1`, [labelId])).map((r) => r.id);
}

/** #158: how many boards carry each label. */
export async function labelUse(labelIds: string[]): Promise<Map<string, number>> {
  if (!labelIds.length) return new Map();
  const rows = await query<{ label_id: string; n: number }>(`SELECT label_id, count(*)::int AS n FROM boards WHERE label_id = ANY($1::text[]) GROUP BY label_id`, [labelIds]);
  return new Map(rows.map((r) => [r.label_id, r.n]));
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
  // A board its owner deleted forever while a legal hold kept it (#157) is gone as far as anyone can tell.
  const r = await one<Row>(`SELECT * FROM boards WHERE id = $1 AND discarded_at IS NULL`, [id]);
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
      `SELECT * FROM boards WHERE owner_id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL AND removed_at IS NULL AND discarded_at IS NULL ORDER BY deleted_at DESC`,
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

/** Every board (trash, discarded and taken-down ones too) after `after` by id, with its workspace: for jobs that sweep all boards a page at a time. */
export async function workspacesAfter(after: string, limit: number): Promise<Array<{ id: string; workspaceId: string }>> {
  const rows = await query<{ id: string; workspace_id: string }>(`SELECT id, workspace_id FROM boards WHERE id > $1 ORDER BY id LIMIT $2`, [after, limit]);
  return rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id }));
}

/** Usage of a workspace's boards (admin console): counts, live boards per owner, recent openers. */
export async function workspaceStats(
  workspaceId: string,
  now: number,
): Promise<{ live: number; trashed: number; archived: number; ownedBy: Map<string, number>; active7d: number; active30d: number }> {
  const DAY = 86_400_000;
  const [counts, owners, active] = await Promise.all([
    one<{ live: number; trashed: number; archived: number }>(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL AND archived_at IS NULL)::int AS live,
         count(*) FILTER (WHERE deleted_at IS NOT NULL AND discarded_at IS NULL)::int AS trashed,
         count(*) FILTER (WHERE deleted_at IS NULL AND archived_at IS NOT NULL)::int AS archived
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
    archived: counts?.archived ?? 0,
    ownedBy: new Map(owners.map((o) => [o.owner_id, o.n])),
    active7d: active?.d7 ?? 0,
    active30d: active?.d30 ?? 0,
  };
}

export async function idsInProject(projectId: string): Promise<string[]> {
  return (await query<{ id: string }>(`SELECT id FROM boards WHERE project_id = $1`, [projectId])).map((r) => r.id);
}

/** Every board of the project (trash included) moves to `to` (#129); returns their ids. */
export async function moveAllInProject(projectId: string, to: string | null): Promise<string[]> {
  return (await query<{ id: string }>(`UPDATE boards SET project_id = $2 WHERE project_id = $1 RETURNING id`, [projectId, to])).map((r) => r.id);
}

export async function countLiveInProject(projectId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM boards WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]);
  return r?.n ?? 0;
}

/** Deletes every board of a workspace, trash included; returns what was deleted (to close docs, delete files). */
export async function deleteAllInWorkspace(workspaceId: string): Promise<Array<{ id: string; thumbnail: string | null }>> {
  return query<{ id: string; thumbnail: string | null }>(`DELETE FROM boards WHERE workspace_id = $1 RETURNING id, thumbnail`, [workspaceId]);
}

/**
 * Inside a transaction: holds the board's row until it ends (as changing its owner does), so
 * changes to who has it and who may share it run one at a time. Doesn't block reads, nor rows that
 * only reference the board. False if there is no such board.
 */
export async function lockBoardSharing(id: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM boards WHERE id = $1 FOR NO KEY UPDATE`, [id])) !== null;
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

/** Moves a live board to the trash (`by`: who; null: a retention rule); false if it was not live (already trashed or gone). */
export async function trashBoard(id: string, now: number, by: string | null = null): Promise<boolean> {
  return (await one(`UPDATE boards SET deleted_at = $2, deleted_by = $3 WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id, new Date(now), by])) !== null;
}

/**
 * Takes a board out of the trash; false if it was not in the trash. Restoring is activity, like
 * unarchiving (#154): a retention rule that trashed it starts over (idle for its period, a fresh notice).
 */
export async function restoreBoard(id: string, now = Date.now()): Promise<boolean> {
  return (
    (await one(
      `UPDATE boards SET deleted_at = NULL, deleted_by = NULL, updated_at = GREATEST(updated_at, $2)
       WHERE id = $1 AND deleted_at IS NOT NULL AND discarded_at IS NULL RETURNING id`,
      [id, new Date(now)],
    )) !== null
  );
}

/**
 * Archives (`at`, `by`: who; null: a retention rule) or unarchives (null) a LIVE board, in one
 * statement; false when that changed nothing (already so, trashed, taken down, gone).
 */
export async function setArchived(id: string, at: number | null, by: string | null, now = Date.now()): Promise<boolean> {
  // Either way it is activity (#154): an unarchived board starts its retention clock again.
  return (
    (await one(
      `UPDATE boards SET archived_at = $2, archived_by = CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE $3 END, updated_at = GREATEST(updated_at, $4)
       WHERE id = $1 AND ${LIVE} AND (archived_at IS NULL) = ($2::timestamptz IS NOT NULL) RETURNING id`,
      [id, at === null ? null : new Date(at), by, new Date(now)],
    )) !== null
  );
}

/** Boards and docs a workspace's people created in [from, to), trashed ones included (#65's daily rollup). */
export async function createdIn(workspaceId: string, from: number, to: number): Promise<{ boards: number; docs: number }> {
  const r = await one<{ boards: number; docs: number }>(
    `SELECT count(*) FILTER (WHERE kind = 'board')::int AS boards, count(*) FILTER (WHERE kind = 'doc')::int AS docs
     FROM boards WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3`,
    [workspaceId, new Date(from), new Date(to)],
  );
  return { boards: r?.boards ?? 0, docs: r?.docs ?? 0 };
}

// ---- the admin inventory (#152) ----

/** Every live board of a workspace (archived ones included) with its last activity. */
export async function inventoryOf(workspaceId: string): Promise<Array<Board & { lastActivityAt: number }>> {
  const rows = await query<Row & { last_at: Date }>(
    `SELECT b.*, ${LAST_ACTIVITY_OF('b')} AS last_at FROM boards b WHERE b.workspace_id = $1 AND b.deleted_at IS NULL AND b.removed_at IS NULL`,
    [workspaceId],
  );
  return rows.map((r) => ({ ...toBoard(r), lastActivityAt: new Date(r.last_at).getTime() }));
}

// ---- retention of inactive boards (#154) ----

/** A board's last activity: an edit or rename (updated_at), or anyone opening it. */
const LAST_ACTIVITY_OF = (b: string) => `GREATEST(${b}.updated_at, ${b}.created_at, COALESCE((SELECT max(o.opened_at) FROM board_opens o WHERE o.board_id = ${b}.id), ${b}.created_at))`;
const LAST_ACTIVITY = LAST_ACTIVITY_OF('b');
/** Live, not archived, and nothing happened since `$2`. */
const INACTIVE_SINCE = `b.deleted_at IS NULL AND b.removed_at IS NULL AND b.archived_at IS NULL AND ${LAST_ACTIVITY} <= $2`;

export interface InactiveBoard {
  id: string;
  kind: ObjectKind;
  title: string;
  ownerId: string;
  lastActivityAt: number;
  noticeAt: number | null;
}

/**
 * Up to `limit` live, unarchived boards of ONE workspace with no activity since `before`, the least
 * recently active first, after `after` (the last of the previous page).
 */
export async function inactiveBoardsIn(workspaceId: string, before: number, limit: number, after: InactiveBoard | null = null): Promise<InactiveBoard[]> {
  const rows = await query<{ id: string; kind: ObjectKind; title: string; owner_id: string; last_at: Date; retention_notice_at: Date | null }>(
    `SELECT * FROM (
       SELECT b.id, b.kind, b.title, b.owner_id, ${LAST_ACTIVITY} AS last_at, b.retention_notice_at FROM boards b
       WHERE b.workspace_id = $1 AND ${INACTIVE_SINCE}
     ) x WHERE $4::timestamptz IS NULL OR (x.last_at, x.id) > ($4::timestamptz, $5::text)
     ORDER BY x.last_at, x.id LIMIT $3`,
    [workspaceId, new Date(before), limit, after ? new Date(after.lastActivityAt) : null, after?.id ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === 'doc' ? 'doc' : 'board',
    title: r.title,
    ownerId: r.owner_id,
    lastActivityAt: new Date(r.last_at).getTime(),
    noticeAt: r.retention_notice_at ? new Date(r.retention_notice_at).getTime() : null,
  }));
}

/** Records that the owner was told (now); only for boards still inactive since `before`. Returns the ids marked. */
export async function markRetentionNoticed(workspaceId: string, ids: string[], before: number, now: number): Promise<string[]> {
  if (!ids.length) return [];
  return (
    await query<{ id: string }>(
      `UPDATE boards b SET retention_notice_at = $4 WHERE b.workspace_id = $1 AND ${INACTIVE_SINCE} AND b.id = ANY($3::text[]) RETURNING b.id`,
      [workspaceId, new Date(before), ids, new Date(now)],
    )
  ).map((r) => r.id);
}

/**
 * Applies a rule to one board in ONE statement, only if it is still in that workspace, live,
 * unarchived and inactive since `before`, and its owner was told at least by `noticedBy` (and after
 * its last activity): a board someone opened a second ago, or moved elsewhere, is left alone.
 */
export async function applyInactiveRule(workspaceId: string, id: string, action: 'archive' | 'trash', before: number, noticedBy: number, now: number): Promise<boolean> {
  const set = action === 'archive' ? `archived_at = $5, archived_by = NULL, updated_at = GREATEST(updated_at, $5)` : `deleted_at = $5, deleted_by = NULL`;
  return (
    (await one(
      `UPDATE boards b SET ${set} WHERE b.id = $3 AND b.workspace_id = $1 AND ${INACTIVE_SINCE}
         AND b.retention_notice_at IS NOT NULL AND b.retention_notice_at <= $4 AND b.retention_notice_at > ${LAST_ACTIVITY}
       RETURNING b.id`,
      [workspaceId, new Date(before), id, new Date(noticedBy), new Date(now)],
    )) !== null
  );
}

/** Every board in a workspace's trash (its content admins, #153), most recently deleted first; taken-down ones stay with the operators. */
export async function trashedInWorkspace(workspaceId: string): Promise<Board[]> {
  return (
    await query<Row>(`SELECT * FROM boards WHERE workspace_id = $1 AND deleted_at IS NOT NULL AND removed_at IS NULL AND discarded_at IS NULL ORDER BY deleted_at DESC, id`, [workspaceId])
  ).map((r) => toBoard(r));
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
    await query<{ thumbnail: string | null }>(`DELETE FROM boards b WHERE owner_id = $1 AND removed_at IS NULL AND NOT ${HELD} RETURNING thumbnail`, [userId])
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
  const r = await one<{ thumbnail: string | null }>(`DELETE FROM boards b WHERE id = $1 AND removed_at IS NOT NULL AND NOT ${HELD} RETURNING thumbnail`, [id]);
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

/**
 * Deletes (up to `limit`) trashed boards deleted before their workspace's cutoff: `before` by
 * default, the `byWorkspace` cutoff for the workspaces listed there — and boards deleted forever
 * while a legal hold kept them, once none does (#157). A held board is never deleted (the trigger
 * re-reads the holds per row). The target row repeats the state conditions so that Postgres re-checks
 * them on the row's latest version once it holds the row lock: a board restored (or re-trashed, or
 * taken down) while the purge waited for it is left alone; the sub-select alone is never re-run.
 */
export async function purgeTrashedBefore(
  before: number,
  limit: number,
  byWorkspace: Array<{ workspaceId: string; before: number }> = [],
): Promise<Array<{ id: string; thumbnail: string | null; title: string; workspaceId: string; ownerId: string; deletedAt: number; discarded: boolean }>> {
  const rows = await query<{ id: string; thumbnail: string | null; title: string; workspace_id: string; owner_id: string; deleted_at: Date; discarded_at: Date | null }>(
    `DELETE FROM boards d USING (
       SELECT b.id, COALESCE(o.before, $1) AS cutoff FROM boards b
       LEFT JOIN unnest($3::text[], $4::timestamptz[]) AS o(workspace_id, before) ON o.workspace_id = b.workspace_id
       WHERE (b.deleted_at < COALESCE(o.before, $1) OR b.discarded_at IS NOT NULL) AND b.removed_at IS NULL AND NOT ${HELD}
       ORDER BY b.deleted_at LIMIT $2
     ) c
     WHERE d.id = c.id AND (d.deleted_at < c.cutoff OR d.discarded_at IS NOT NULL) AND d.removed_at IS NULL
     RETURNING d.id, d.thumbnail, d.title, d.workspace_id, d.owner_id, d.deleted_at, d.discarded_at`,
    [new Date(before), limit, byWorkspace.map((w) => w.workspaceId), byWorkspace.map((w) => new Date(w.before))],
  );
  return rows.map((r) => ({
    id: r.id,
    thumbnail: r.thumbnail,
    title: r.title,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id,
    deletedAt: new Date(r.deleted_at).getTime(),
    discarded: r.discarded_at !== null,
  }));
}

/**
 * A held board whose trash retention ran out leaves the trash as if it had been purged (the hold is
 * silent, #157) but is kept: it is marked discarded. Returns how many. As in purgeTrashedBefore, the
 * target row repeats the state conditions: a board restored while this waited for its row is not
 * marked (a live board marked discarded would be purged once its hold ends).
 */
export async function discardHeldExpired(before: number, byWorkspace: Array<{ workspaceId: string; before: number }>, now: number): Promise<number> {
  const rows = await query(
    `UPDATE boards d SET discarded_at = $4 FROM (
       SELECT b.id, COALESCE(o.before, $1) AS cutoff FROM boards b
       LEFT JOIN unnest($2::text[], $3::timestamptz[]) AS o(workspace_id, before) ON o.workspace_id = b.workspace_id
       WHERE b.deleted_at < COALESCE(o.before, $1) AND b.discarded_at IS NULL AND b.removed_at IS NULL AND ${HELD}
     ) c
     WHERE d.id = c.id AND d.deleted_at < c.cutoff AND d.discarded_at IS NULL AND d.removed_at IS NULL RETURNING 1`,
    [new Date(before), byWorkspace.map((w) => w.workspaceId), byWorkspace.map((w) => new Date(w.before)), new Date(now)],
  );
  return rows.length;
}

// ---- legal holds (#157): the only writer of board_legal_holds and board_owner_legal_holds ----

/** Postgres error code of the trigger that refuses to delete a held board (migration 202611301005). */
export const LEGAL_HOLD_ERROR = 'FH001';
export const isLegalHoldViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === LEGAL_HOLD_ERROR;

/** The ids among `ids` under any legal hold. */
export async function heldAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await query<{ id: string }>(`SELECT b.id FROM boards b WHERE b.id = ANY($1::text[]) AND ${HELD}`, [ids]);
  return new Set(rows.map((r) => r.id));
}

/**
 * Taken by every hold placement and by whatever destroys held content that isn't a board row (a
 * workspace's key), each in its transaction: one waits for the other to commit, so a destroy never
 * misses a hold placed at the same moment. One lock for every hold: both are rare.
 */
async function lockLegalHolds(): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('boards.legal_holds'), 0)`);
}

/** In the caller's transaction: waits for holds being placed, then counts what `legalHoldCount` counts; no hold is placed until that transaction ends. */
export async function legalHoldCountLocked(by: { workspaceId: string }): Promise<number> {
  return tx(async () => {
    await lockLegalHolds();
    return legalHoldCount(by);
  });
}

/** Puts boards (that still exist) and custodians — every board a person owns in a workspace — under hold `holdId`. */
export async function placeLegalHold(
  holdId: string,
  scope: { boardIds: string[]; custodians: Array<{ workspaceId: string; ownerId: string }> },
  now: number,
): Promise<void> {
  if (!scope.boardIds.length && !scope.custodians.length) return;
  await tx(() => placeLegalHoldLocked(holdId, scope, now));
}

async function placeLegalHoldLocked(
  holdId: string,
  scope: { boardIds: string[]; custodians: Array<{ workspaceId: string; ownerId: string }> },
  now: number,
): Promise<void> {
  await lockLegalHolds();
  if (scope.boardIds.length)
    await query(
      `INSERT INTO board_legal_holds (hold_id, board_id, via_owner, created_at)
       SELECT $1, id, NULL, $3 FROM boards WHERE id = ANY($2::text[])
       ON CONFLICT (hold_id, board_id) DO UPDATE SET via_owner = NULL`,
      [holdId, scope.boardIds, new Date(now)],
    );
  if (scope.custodians.length)
    await query(
      `INSERT INTO board_owner_legal_holds (hold_id, workspace_id, owner_id, created_at)
       SELECT $1, c.workspace_id, c.owner_id, $4 FROM unnest($2::text[], $3::text[]) AS c(workspace_id, owner_id)
       ON CONFLICT DO NOTHING`,
      [holdId, scope.custodians.map((c) => c.workspaceId), scope.custodians.map((c) => c.ownerId), new Date(now)],
    );
}

/** Takes boards and custodians out of hold `holdId` (other holds keep theirs); a custodian's boards that left them while held go with them. */
export async function narrowLegalHold(holdId: string, scope: { boardIds: string[]; ownerIds: string[] }): Promise<void> {
  if (scope.boardIds.length) await query(`DELETE FROM board_legal_holds WHERE hold_id = $1 AND board_id = ANY($2::text[]) AND via_owner IS NULL`, [holdId, scope.boardIds]);
  if (scope.ownerIds.length) {
    await query(`DELETE FROM board_legal_holds WHERE hold_id = $1 AND via_owner = ANY($2::text[])`, [holdId, scope.ownerIds]);
    await query(`DELETE FROM board_owner_legal_holds WHERE hold_id = $1 AND owner_id = ANY($2::text[])`, [holdId, scope.ownerIds]);
  }
}

/** Ends hold `holdId` entirely. */
export async function releaseLegalHold(holdId: string): Promise<void> {
  await query(`DELETE FROM board_legal_holds WHERE hold_id = $1`, [holdId]);
  await query(`DELETE FROM board_owner_legal_holds WHERE hold_id = $1`, [holdId]);
}

/** What hold `holdId` names: its explicit boards and its custodians (per workspace). */
export async function legalHoldScope(holdId: string): Promise<{ boardIds: string[]; custodians: Array<{ workspaceId: string; ownerId: string }> }> {
  const [boards, owners] = await Promise.all([
    query<{ board_id: string }>(`SELECT board_id FROM board_legal_holds WHERE hold_id = $1 AND via_owner IS NULL ORDER BY created_at, board_id`, [holdId]),
    query<{ workspace_id: string; owner_id: string }>(`SELECT workspace_id, owner_id FROM board_owner_legal_holds WHERE hold_id = $1 ORDER BY created_at, owner_id, workspace_id`, [holdId]),
  ]);
  return { boardIds: boards.map((r) => r.board_id), custodians: owners.map((r) => ({ workspaceId: r.workspace_id, ownerId: r.owner_id })) };
}

/** Every board hold `holdId` keeps right now, in any state (trashed, discarded, archived, taken down), oldest first. */
export async function boardsUnderLegalHold(holdId: string): Promise<Array<Board & { discarded: boolean }>> {
  const rows = await query<Row & { discarded_at: Date | null }>(
    `SELECT b.* FROM boards b WHERE EXISTS (SELECT 1 FROM board_legal_holds h WHERE h.hold_id = $1 AND h.board_id = b.id)
       OR EXISTS (SELECT 1 FROM board_owner_legal_holds h WHERE h.hold_id = $1 AND h.owner_id = b.owner_id AND h.workspace_id = b.workspace_id)
     ORDER BY b.created_at, b.id`,
    [holdId],
  );
  return rows.map((r) => ({ ...toBoard(r), discarded: r.discarded_at !== null }));
}

/** How many legal-hold rows touch a person (as a custodian, or owner of a held board) or a workspace (custodians there, held boards in it). */
export async function legalHoldCount(by: { ownerId: string } | { workspaceId: string }): Promise<number> {
  const [col, holdCol] = 'ownerId' in by ? ['owner_id', 'owner_id'] : ['workspace_id', 'workspace_id'];
  const r = await one<{ n: number }>(
    `SELECT ((SELECT count(*) FROM board_owner_legal_holds WHERE ${holdCol} = $1)
       + (SELECT count(*) FROM boards b WHERE b.${col} = $1 AND EXISTS (SELECT 1 FROM board_legal_holds h WHERE h.board_id = b.id)))::int AS n`,
    ['ownerId' in by ? by.ownerId : by.workspaceId],
  );
  return r?.n ?? 0;
}

/** "Deleted forever" while held: out of the trash for everyone, kept for the hold. False if it isn't in the trash. */
export async function discardTrashedBoard(id: string, now: number): Promise<boolean> {
  return (
    (await one(`UPDATE boards SET discarded_at = $2 WHERE id = $1 AND deleted_at IS NOT NULL AND discarded_at IS NULL AND removed_at IS NULL RETURNING 1`, [id, new Date(now)])) !== null
  );
}

/** Changes only the given fields, in one statement (concurrent PATCHes of different fields both stick). */
export async function updateBoardFields(
  id: string,
  patch: {
    title?: string;
    description?: string;
    linkAccess?: LinkAccess;
    embeddable?: boolean;
    editorsCanShare?: boolean;
    viewersCanExport?: boolean;
    guestsCanEdit?: boolean;
  },
  now: number,
): Promise<void> {
  await query(
    `UPDATE boards SET title = COALESCE($2, title), description = COALESCE($3, description),
       link_access = CASE WHEN link_blocked_at IS NULL THEN COALESCE($4, link_access) ELSE link_access END,
       updated_at = GREATEST(updated_at, $5), embeddable = COALESCE($6, embeddable),
       editors_can_share = COALESCE($7, editors_can_share), viewers_can_export = COALESCE($8, viewers_can_export),
       guests_can_edit = COALESCE($9, guests_can_edit)
     WHERE id = $1`,
    [
      id,
      patch.title ?? null,
      patch.description ?? null,
      patch.linkAccess ?? null,
      new Date(now),
      patch.embeddable ?? null,
      patch.editorsCanShare ?? null,
      patch.viewersCanExport ?? null,
      patch.guestsCanEdit ?? null,
    ],
  );
}

/**
 * Moves a live board into another workspace (#124) — and project there, or none — in the caller's
 * transaction, with what the target's policies turned off: its stored link (`linkAccess`, when
 * given) and embedding (`embeddable: false`). False when there is no such live board.
 */
export async function moveToWorkspace(
  id: string,
  to: { workspaceId: string; projectId: string | null; labelId: string | null; linkAccess?: LinkAccess; embeddable?: false },
  now: number,
): Promise<boolean> {
  const rows = await query(
    `UPDATE boards SET workspace_id = $2, project_id = $3, link_access = COALESCE($4, link_access),
       embeddable = COALESCE($5, embeddable), updated_at = GREATEST(updated_at, $6), label_id = $7
     WHERE id = $1 AND ${LIVE} RETURNING 1`,
    [id, to.workspaceId, to.projectId, to.linkAccess ?? null, to.embeddable ?? null, new Date(now), to.labelId],
  );
  return rows.length > 0;
}

/**
 * Live boards of a workspace whose link is on (as stored, expiry or not; not blocked by an
 * operator): what the admin console checks against the workspace's link policy (#39).
 */
export async function linkedBoardsIn(workspaceId: string): Promise<Board[]> {
  return (
    await query<Row>(`SELECT * FROM boards WHERE workspace_id = $1 AND ${LIVE} AND link_access <> 'none' AND link_blocked_at IS NULL ORDER BY updated_at DESC`, [
      workspaceId,
    ])
  ).map((r) => toBoard(r));
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

/** Everyone who starred the board. */
export async function starrerIds(boardId: string): Promise<string[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM board_stars WHERE board_id = $1`, [boardId])).map((r) => r.user_id);
}

export async function isStarred(boardId: string, userId: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM board_stars WHERE board_id = $1 AND user_id = $2`, [boardId, userId])) !== null;
}

// ---- opens ----
/**
 * Records that the user opened the board: `first` when it is the first time they did, `firstToday`
 * when it is their first open of the UTC day `now` falls on (product analytics' board_opened).
 * Exactly one of several concurrent opens, on any instance, gets either: the day's first is the
 * one whose update still found the previous open before today (the row is locked meanwhile).
 */
export async function recordOpen(boardId: string, userId: string, now: number): Promise<{ first: boolean; firstToday: boolean }> {
  const dayStart = new Date(Math.floor(now / 86_400_000) * 86_400_000);
  const newDay = await one(`UPDATE board_opens SET opened_at = $3 WHERE board_id = $1 AND user_id = $2 AND opened_at < $4 RETURNING 1`, [boardId, userId, new Date(now), dayStart]);
  const r = await one<{ first: boolean }>(
    `INSERT INTO board_opens (board_id, user_id, opened_at) VALUES ($1, $2, $3)
     ON CONFLICT (board_id, user_id) DO UPDATE SET opened_at = excluded.opened_at
     RETURNING (xmax = 0) AS first`,
    [boardId, userId, new Date(now)],
  );
  const first = r?.first === true;
  return { first, firstToday: first || newDay !== null };
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

/** Stored call links after `after` (by board id), as stored (sealed or legacy plain text). */
export async function storedCallUrls(after: string, limit: number): Promise<Array<{ id: string; stored: string }>> {
  return (
    await query<{ id: string; call_url: string }>(`SELECT id, call_url FROM boards WHERE call_url IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`, [after, limit])
  ).map((r) => ({ id: r.id, stored: r.call_url }));
}

/** Replaces a stored call link only if the row still holds what was read (no lost update). */
export async function replaceStoredCallUrl(id: string, was: string, now: string): Promise<boolean> {
  return (await one(`UPDATE boards SET call_url = $3 WHERE id = $1 AND call_url = $2 RETURNING id`, [id, was, now])) !== null;
}

/** Sets the board's call: a meeting link, its Jitsi room, or nothing. False if the board is gone. */
export async function setCall(id: string, call: { url: string | null; jitsi: boolean }): Promise<boolean> {
  return (await one(`UPDATE boards SET call_url = $2, call_jitsi = $3 WHERE id = $1 RETURNING id`, [id, sealCallUrl(call.url), call.jitsi])) !== null;
}
