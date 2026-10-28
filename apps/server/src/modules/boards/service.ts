import { BOARD_REMOVED, DOWNLOADS_RESTRICTED, isGuestId, TRASH_RETENTION_DAYS, type BoardPermissions, type BoardSummary, type LinkAccess, type Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { runExclusive } from '../../platform/jobs';
import { log } from '../../platform/log';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getGuests, getUser, getUsers } from '../auth/index';
import { atLeast, getMemberRole, membershipsOf, ownershipTransferred, resolveGuestRole, resolveRole } from '../members/index';
import {
  closeBoardDoc,
  initBoardDoc,
  initBoardLayer,
  refreshBoardAccess,
  snapshotBoardDoc,
  snapshotBoardLayer,
  snapshotBoardLayers,
} from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import {
  boardAccess,
  boardAccessLoader,
  type BoardWorkspaceAccess,
  ensurePersonalWorkspace,
  getWorkspaceInfo,
  isFullMember,
  isManager,
  lockProjectForBoard,
  lockWorkspaceForNewBoard,
  mayDownload,
  mayShareExternally,
  retentionOverrides,
  workspaceRole,
  workspaceRolesOf,
} from '../workspaces/index';
import * as repo from './repo';
import type { Board } from './repo';

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent' | 'trash';
export const BOARD_FILTERS: BoardFilter[] = ['all', 'mine', 'shared', 'starred', 'recent', 'trash'];
const DAY_MS = 86_400_000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;
export const DEFAULT_TITLE = 'Untitled board';

/** A board as an audit event's target (its title as it is now). */
export const boardTarget = (b: { id: string; title: string }) => ({ type: 'board', id: b.id, label: b.title });

/** EXPORT_FORMATS a client may report (POST /boards/:id/exported). */
export const EXPORT_FORMATS = ['png', 'jpg', 'svg', 'pdf', 'csv', 'json', 'other'] as const;

/**
 * A client-side export (image / PDF made in the browser) reported by the web app: refused like
 * the export itself when the workspace's downloads policy forbids it, otherwise audited. The
 * server can't see a browser export, so this is as complete as the clients reporting it.
 */
export async function recordExport(boardId: string, userId: string, format: unknown): Promise<void> {
  const { board, access } = await requireAccess(boardId, userId);
  await requireDownload(board, userId, access, 'export');
  const f = (EXPORT_FORMATS as readonly unknown[]).includes(format) ? (format as string) : 'other';
  await recordAudit({ action: 'board.exported', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { format: f } });
}

/**
 * Someone downloading a file from a board (a file card, a video or audio item; modules/uploads
 * serves it): refused like an export when the workspace's downloads policy forbids it. Returns
 * their role (what of the board they may read) and how to audit the download once it is served.
 * `userId` may be a guest id (a visitor: no actor; the guest id is kept in the event).
 */
export async function authorizeFileDownload(
  boardId: string,
  userId: string,
): Promise<{ role: Role; record(file: { name: string; upload: string }): Promise<void> }> {
  const { board, role, access } = await requireAccess(boardId, userId);
  await requireDownload(board, userId, access, 'file');
  const guest = isGuestId(userId);
  return {
    role,
    record: (file) =>
      recordAudit({
        action: 'board.file_downloaded',
        workspaceId: board.workspaceId,
        actorId: guest ? null : userId,
        target: boardTarget(board),
        metadata: { file: file.name, upload: file.upload, ...(guest ? { guestId: userId } : {}) },
      }),
  };
}

/**
 * The role of `userId` on a board and what its workspace contributes (policies, team access).
 * `userId` may be a guest id: a guest gets only the board they joined, as resolveGuestRole allows
 * (never once their session expired).
 */
export async function describeAccess(board: Board, userId: string): Promise<{ role: Role | null; access: BoardWorkspaceAccess }> {
  if (isGuestId(userId)) {
    const [guest, access] = await Promise.all([getGuests([userId]), boardAccess(userId, board)]);
    const joined = guest.get(userId)?.boardId === board.id;
    return { role: joined ? resolveGuestRole(board, access) : null, access };
  }
  const [memberRole, access] = await Promise.all([getMemberRole(board.id, userId), boardAccess(userId, board)]);
  return { role: resolveRole(board, userId, memberRole, access), access };
}

/** May visitors without an account join this board by its link, and as what (null: no)? */
export async function guestRoleFor(board: Board): Promise<'viewer' | 'commenter' | null> {
  // The access a workspace gives someone who is in none of its lists (any id outside it will do).
  return resolveGuestRole(board, await boardAccess('', board));
}

export async function roleOn(board: Board, userId: string): Promise<Role | null> {
  return (await describeAccess(board, userId)).role;
}

/**
 * 451 for a board an operator took down — only to someone who could open it otherwise, so it
 * tells nobody else that the board exists.
 */
export async function removedFor(boardId: string, userId: string): Promise<boolean> {
  const board = await repo.getBoardAnyState(boardId);
  if (!board || board.removedAt === null || board.deletedAt !== null) return false;
  return (await describeAccess(board, userId)).role !== null;
}

export const boardRemoved = () =>
  new HttpError(451, 'This board was removed by Freero’s moderators while they review a report.', BOARD_REMOVED);

/** Loads a board and checks the user's role: 404 if missing, 451 if taken down, 403 if below `min`. */
export async function requireAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{ board: Board; role: Role; access: BoardWorkspaceAccess }> {
  const board = await repo.getBoard(boardId);
  if (!board) throw (await removedFor(boardId, userId)) ? boardRemoved() : notFound('Board not found');
  const { role, access } = await describeAccess(board, userId);
  if (!role) throw forbidden();
  if (!atLeast(role, min)) throw forbidden(min === 'owner' ? 'Only the board owner can do that' : `You need ${min} access to do that`);
  return { board, role, access };
}

/** What the user may do beyond their role, under the workspace's policies (each re-checked where it's done). */
export function permissionsFor(board: Board, userId: string, role: Role, access: BoardWorkspaceAccess): BoardPermissions {
  const isOwner = board.ownerId === userId;
  const admin = isManager(access.workspaceRole);
  return {
    canExport: mayDownload(access.workspaceRole, access.policies),
    canShareExternally: atLeast(role, 'editor') && mayShareExternally(access.workspaceRole, access.policies),
    maxLinkAccess: access.maxLink,
    canMove: isOwner || admin,
    canTransfer: isOwner || admin,
    guestLinks: access.anonymousLinks && !access.outsidersBlocked,
  };
}

/** How someone tried to take a board's content out (recorded with a refusal). */
export type DownloadVia = 'export' | 'duplicate' | 'template' | 'file' | 'outline' | 'api' | 'ai';

/**
 * The one check of the workspace's "downloads" policy, for everything that takes a board's content
 * out of the workspace's control: exports, duplicates, templates, and machine-readable reads (the
 * outline, the public API, later MCP and AI — KAI-197). Refusals answer 403 `downloads_restricted`
 * and are audited. Personal workspaces have no policies, so they always pass.
 */
export async function requireDownload(board: Board, userId: string, access: BoardWorkspaceAccess, via: DownloadVia): Promise<void> {
  if (mayDownload(access.workspaceRole, access.policies)) return;
  // A visitor without an account is no actor; their guest id is kept in the event.
  const guest = isGuestId(userId);
  await recordAuditQuietly({
    action: 'board.download_refused',
    workspaceId: board.workspaceId,
    actorId: guest ? null : userId,
    target: boardTarget(board),
    metadata: { via, ...(guest ? { guestId: userId } : {}) },
  });
  throw new HttpError(403, 'This workspace doesn’t allow you to export, download or copy its boards', DOWNLOADS_RESTRICTED);
}

export async function toSummary(
  board: Board,
  userId: string,
  role: Role,
  access: BoardWorkspaceAccess,
  extra?: { starred?: boolean; lastOpenedAt?: number | null; ownerName?: string; member?: boolean },
): Promise<BoardSummary> {
  const starred = extra?.starred ?? (await repo.isStarred(board.id, userId));
  const member = extra?.member ?? (await getMemberRole(board.id, userId)) !== null;
  const lastOpenedAt =
    extra && 'lastOpenedAt' in extra ? (extra.lastOpenedAt ?? null) : await repo.lastOpenedAt(board.id, userId);
  const ownerName = extra?.ownerName ?? (await getUser(board.ownerId))?.name ?? 'Unknown';
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    ownerId: board.ownerId,
    ownerName,
    role,
    starred,
    thumbnail: board.thumbnail,
    linkAccess: board.linkAccess,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    lastOpenedAt,
    workspaceId: board.workspaceId,
    projectId: board.projectId,
    team: access.team,
    member,
    permissions: permissionsFor(board, userId, role, access),
    ...(board.linkBlocked ? { linkBlocked: true } : {}),
    ...(board.deletedAt !== null ? { deletedAt: board.deletedAt, purgeAt: board.deletedAt + access.trashRetentionDays * DAY_MS } : {}),
  };
}

/** The summary of a board for the user (re-reads their role and the workspace context). */
export async function summarize(board: Board, userId: string, extra?: { starred?: boolean; lastOpenedAt?: number | null }): Promise<BoardSummary> {
  const { role, access } = await describeAccess(board, userId);
  if (!role) throw forbidden();
  return toSummary(board, userId, role, access, extra);
}

/**
 * The boards a user can open, scoped to one workspace (see the contract in @freero/shared api.ts):
 * the workspace's boards they can open, plus — for 'shared', 'starred', 'recent', and 'all' in the
 * personal workspace — boards shared with them directly from workspaces they are not in. A board of a workspace the user is
 * not in never appears unless they hold access to that board itself (a direct invite or its link).
 */
export async function listBoards(
  userId: string,
  filter: BoardFilter,
  q: string,
  scope: { workspaceId?: string; projectId?: string } = {},
): Promise<BoardSummary[]> {
  const workspaceId = scope.workspaceId || (await ensurePersonalWorkspace(userId));
  const myWorkspaces = await workspaceRolesOf(userId);
  if (!myWorkspaces.has(workspaceId)) throw notFound('Workspace not found');
  if (filter === 'trash') return listTrash(userId, workspaceId, q);

  const [memberships, opens, stars, ws] = await Promise.all([
    membershipsOf(userId),
    repo.opensOf(userId),
    repo.starredBoardIds(userId),
    getWorkspaceInfo(workspaceId),
  ]);
  const inWorkspace = filter === 'shared' ? [] : await repo.boardsInWorkspace(workspaceId);
  const seen = new Set(inWorkspace.map((b) => b.id));
  // Boards reached from outside — only ones in workspaces the user is not in. The personal
  // workspace's home shows them too: it is where "everything that isn't a team's" lives.
  const withOutside = filter === 'shared' || filter === 'starred' || filter === 'recent' || (filter === 'all' && ws?.kind === 'personal');
  const outsideIds = withOutside ? [...new Set([...memberships.keys(), ...opens.keys(), ...stars])].filter((id) => !seen.has(id)) : [];
  const outside = (await repo.getBoards(outsideIds)).filter((b) => !myWorkspaces.has(b.workspaceId));
  const boards = [...inWorkspace, ...outside];

  const accessOf = await boardAccessLoader(userId, [...new Set(boards.map((b) => b.workspaceId))]);
  const owners = await getUsers(boards.map((b) => b.ownerId));
  const needle = q.trim().toLowerCase();
  const out: BoardSummary[] = [];
  for (const board of boards) {
    if (scope.projectId && board.projectId !== scope.projectId) continue;
    const access = accessOf(board);
    const role = resolveRole(board, userId, memberships.get(board.id) ?? null, access);
    if (!role) continue; // e.g. a team board in a private project, or link access revoked
    if (filter === 'mine' && role !== 'owner') continue;
    if (filter === 'starred' && !stars.has(board.id)) continue;
    if (filter === 'recent' && !opens.has(board.id)) continue;
    if (needle && !board.title.toLowerCase().includes(needle)) continue;
    out.push(
      await toSummary(board, userId, role, access, {
        starred: stars.has(board.id),
        member: memberships.has(board.id),
        lastOpenedAt: opens.get(board.id) ?? null,
        ownerName: owners.get(board.ownerId)?.name ?? 'Unknown',
      }),
    );
  }
  if (filter === 'recent') out.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function cleanTitle(v: unknown, fallback = DEFAULT_TITLE): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw badRequest('title must be a string');
  const t = v.trim().slice(0, 200);
  return t || fallback;
}

export function cleanDescription(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be a string');
  return v.slice(0, 2000);
}

/**
 * Runs `write` (which adds one live board for `ownerId`) only if the owner is below the board
 * quota. The count and the write happen in one transaction under the owner's quota lock, so
 * concurrent creates/duplicates/restores of one user can never land over the limit (a plain
 * count-then-insert lets every parallel request pass the same count). Joins the caller's
 * transaction if there is one; the lock is then held until that one ends.
 */
function withinBoardQuota<T>(ownerId: string, refusal: (max: number) => string, write: () => Promise<T>): Promise<T> {
  return repo.transaction(async () => {
    const max = getConfig().maxBoardsPerUser;
    await repo.lockOwnerQuota(ownerId);
    if ((await repo.countLiveBoardsOwnedBy(ownerId)) >= max) throw forbidden(refusal(max));
    return write();
  });
}

/** Where a new board goes: a workspace (default: the owner's personal one) and optionally a project. */
export interface BoardPlace {
  workspaceId?: string;
  projectId?: string | null;
}

export async function createBoard(
  ownerId: string,
  title: string,
  description: string,
  linkAccess: LinkAccess = 'none',
  place: BoardPlace = {},
): Promise<Board> {
  const workspaceId = place.workspaceId || (await ensurePersonalWorkspace(ownerId));
  const projectId = place.projectId || null;
  return withinBoardQuota(
    ownerId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to create new ones.`,
    async () => {
      // Holds the workspace (and project) until this transaction ends, so neither is deleted
      // underneath the new board.
      await lockWorkspaceForNewBoard(workspaceId, ownerId);
      if (projectId) await lockProjectForBoard(projectId, workspaceId, ownerId);
      const now = Date.now();
      const board: Board = {
        id: newId(10),
        title,
        description,
        ownerId,
        linkAccess,
        thumbnail: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        workspaceId,
        projectId,
        removedAt: null,
        linkBlocked: false,
        storedLinkAccess: linkAccess,
      };
      await repo.insertBoard(board);
      await recordAudit({ action: 'board.created', workspaceId, actorId: ownerId, target: boardTarget(board), metadata: { projectId } });
      return board;
    },
  );
}

/**
 * Moves a board into another project of its workspace (null: the workspace root). Its owner or the
 * workspace's owners/admins only: taking a board out of a private project opens it to the team.
 * Everyone connected is re-checked at once (moving into a private project can cut access).
 */
export async function moveToProject(board: Board, userId: string, projectId: string | null): Promise<void> {
  const role = await workspaceRole(board.workspaceId, userId);
  if (board.ownerId !== userId && !isManager(role)) throw forbidden('Only the board owner or a workspace admin can move it');
  await repo.transaction(async () => {
    if (projectId) await lockProjectForBoard(projectId, board.workspaceId, userId);
    if (!(await repo.setProject(board.id, projectId))) throw notFound('Board not found');
    await recordAudit({ action: 'board.moved', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { from: board.projectId, to: projectId } });
  });
  await refreshBoardAccess(board.id);
}

/**
 * Hands a board to another person, in one transaction (subject to their board quota):
 * - team workspace: to a member who is not a guest; it stays where it is;
 * - personal workspace: to someone already invited to the board; it moves to THEIR personal
 *   workspace (a personal workspace only ever holds its owner's boards).
 * The previous owner keeps editor access through a membership. The board owner or the
 * workspace's owners/admins may do it.
 */
export async function transferBoard(board: Board, actorId: string, targetId: unknown): Promise<Board> {
  if (typeof targetId !== 'string' || !targetId) throw badRequest('userId is required');
  if (targetId === board.ownerId) throw badRequest('They already own this board');
  const [actorWsRole, targetWsRole, ws, target] = await Promise.all([
    workspaceRole(board.workspaceId, actorId),
    workspaceRole(board.workspaceId, targetId),
    getWorkspaceInfo(board.workspaceId),
    getUser(targetId),
  ]);
  if (board.ownerId !== actorId && !isManager(actorWsRole)) throw forbidden('Only the board owner or a workspace admin can transfer it');
  if (!ws || !target) throw notFound('That person was not found');
  let workspaceId = board.workspaceId;
  let projectId = board.projectId;
  if (ws.kind === 'team') {
    if (!isFullMember(targetWsRole)) throw badRequest(`${target.name} must be a member (not a guest) of this workspace to own its boards`);
  } else {
    if (!(await getMemberRole(board.id, targetId))) throw badRequest(`Invite ${target.name} to the board first`);
    workspaceId = await ensurePersonalWorkspace(targetId);
    projectId = null;
  }
  const previousOwner = board.ownerId;
  await withinBoardQuota(
    targetId,
    (max) => `${target.name} has reached the limit of ${max} boards and can’t receive this one.`,
    async () => {
      if (!(await repo.setOwner(board.id, targetId, workspaceId, projectId, Date.now()))) throw notFound('Board not found');
      await ownershipTransferred(board.id, targetId, previousOwner, 'editor');
      await recordAudit({
        action: 'board.transferred',
        workspaceId: board.workspaceId,
        actorId,
        target: boardTarget(board),
        metadata: { from: previousOwner, to: targetId, toEmail: target.email, movedToWorkspace: workspaceId === board.workspaceId ? null : workspaceId },
      });
    },
  );
  await refreshBoardAccess(board.id);
  return { ...board, ownerId: targetId, workspaceId, projectId };
}

// ---- trash ----

async function listTrash(userId: string, workspaceId: string, q: string): Promise<BoardSummary[]> {
  const needle = q.trim().toLowerCase();
  const [boards, me] = await Promise.all([repo.trashedBoardsOf(userId, workspaceId), getUser(userId)]);
  const accessOf = await boardAccessLoader(userId, [workspaceId]);
  const out: BoardSummary[] = [];
  for (const b of boards) {
    if (needle && !b.title.toLowerCase().includes(needle)) continue;
    // Only owners see (and restore) trashed boards; stars/opens don't matter here.
    out.push(await toSummary(b, userId, 'owner', accessOf(b), { starred: false, lastOpenedAt: null, ownerName: me?.name ?? 'Unknown', member: false }));
  }
  return out;
}

/**
 * Moves a live board to the trash: it disappears from every list and stops resolving for access
 * (so new sockets are refused), and everyone connected is disconnected. Its content is kept
 * exactly as it was, including edits made in the last moments before the delete.
 */
export async function moveToTrash(board: Board, actorId: string, now = Date.now()): Promise<void> {
  const trashed = await repo.transaction(async () => {
    if (!(await repo.trashBoard(board.id, now))) return false; // trashed meanwhile by another request
    await recordAudit({ action: 'board.trashed', workspaceId: board.workspaceId, actorId, target: boardTarget(board) });
    return true;
  });
  if (!trashed) return;
  await closeKeepingContent(board.id, 'deleted');
}

/**
 * Disconnects everyone from a board that no longer resolves for access (trashed, taken down) on
 * every instance, keeping its content exactly as it was. The live doc may hold edits not saved
 * yet (saves are debounced) and closing the room drops them. Take the live state first, then
 * close (which also waits for a save in flight), then store that state last, so nothing older
 * lands after it. Nobody can rejoin in between: the board no longer resolves for access.
 * The same for its layers (hidden frames' contents, private drafts, sealed ballots): restoring
 * the board brings them back exactly as they were.
 */
export async function closeKeepingContent(boardId: string, why: 'deleted' | 'removed'): Promise<void> {
  const state = await snapshotBoardDoc(boardId);
  const layers = await snapshotBoardLayers(boardId);
  await closeBoardDoc(boardId, why);
  if (state) await initBoardDoc(boardId, state);
  for (const l of layers) await initBoardLayer(boardId, l.layer, l.state);
}

/** Owner only: takes a board out of the trash (subject to the board quota). */
export async function restoreFromTrash(boardId: string, userId: string): Promise<Board> {
  const board = await repo.getBoardIncludingTrash(boardId);
  // Not yours / not there: the same answer, so the trash leaks nothing about other people's boards.
  // A board taken down by an operator stays with them until they restore it.
  if (!board || board.deletedAt === null || board.ownerId !== userId || board.removedAt !== null) throw notFound('Board not found in your trash');
  await withinBoardQuota(
    userId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to restore this one.`,
    async () => {
      if (!(await repo.restoreBoard(board.id))) throw notFound('Board not found in your trash');
      await recordAudit({ action: 'board.restored', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board) });
    },
  );
  return { ...board, deletedAt: null };
}

/** Owner only: deletes a trashed board and everything on it for good. */
export async function deleteForever(boardId: string, userId: string): Promise<void> {
  const board = await repo.getBoardIncludingTrash(boardId);
  if (!board || board.deletedAt === null || board.ownerId !== userId || board.removedAt !== null) throw notFound('Board not found in your trash');
  const thumbnail = await repo.transaction(async () => {
    const t = await repo.deleteTrashedBoard(board.id);
    if (t === undefined) throw notFound('Board not found in your trash'); // restored or purged meanwhile
    await recordAudit({ action: 'board.deleted', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board) });
    return t;
  });
  await closeBoardDoc(board.id); // nobody should be connected; make sure nothing saves after the delete
  await deleteUpload(thumbnail);
}

const PURGE_BATCH = 200;

/** Advisory lock key of the trash purge (platform/jobs). */
export const TRASH_PURGE_LOCK_KEY = 7_202_610_282; // arbitrary, constant across releases

/**
 * Deletes for good every board that has been in the trash longer than its workspace's trash
 * retention (TRASH_RETENTION_DAYS unless the workspace sets its own). Idempotent and safe to run on
 * every server instance at once: one instance purges (advisory lock), the others skip this round
 * (0). Returns how many boards this call removed.
 */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  return (await runExclusive(TRASH_PURGE_LOCK_KEY, () => purgeExpiredTrashLocked(now))) ?? 0;
}

/** The purge itself; the caller holds TRASH_PURGE_LOCK_KEY (purgeExpiredTrash or the scheduled job). */
export async function purgeExpiredTrashLocked(now = Date.now()): Promise<number> {
  const before = now - TRASH_RETENTION_MS;
  const byWorkspace = (await retentionOverrides())
    .filter((o) => o.trashDays !== TRASH_RETENTION_DAYS)
    .map((o) => ({ workspaceId: o.id, before: now - o.trashDays * DAY_MS }));
  let total = 0;
  for (;;) {
    const purged = await repo.transaction(async () => {
      const rows = await repo.purgeTrashedBefore(before, PURGE_BATCH, byWorkspace);
      for (const b of rows)
        await recordAudit({
          action: 'board.purged',
          workspaceId: b.workspaceId,
          actorId: null,
          target: { type: 'board', id: b.id, label: b.title },
          metadata: { owner: b.ownerId, trashedAt: new Date(b.deletedAt).toISOString() },
        });
      return rows;
    });
    for (const b of purged) {
      await closeBoardDoc(b.id);
      await deleteUpload(b.thumbnail);
    }
    total += purged.length;
    if (purged.length < PURGE_BATCH) break;
  }
  return total;
}

/**
 * A copy of `source` owned by `userId`, with the source's current content: in the same workspace
 * and project when the user may create boards there, else in their personal workspace. The new
 * board row and its content are written in one transaction: if saving the content fails there is
 * no empty copy. Hidden frames' contents (the 'editors' layer) are copied only for someone who may
 * see them (`role` owner/editor); nobody's private layer (drafts, sealed ballots) is ever copied.
 */
export async function duplicateBoard(source: Board, userId: string, role: Role): Promise<Board> {
  const wsRole = await workspaceRole(source.workspaceId, userId);
  const place: BoardPlace = isFullMember(wsRole) ? { workspaceId: source.workspaceId, projectId: source.projectId } : {};
  // Read the content BEFORE the transaction: it may wait for the live doc to finish loading,
  // which queries the database outside this transaction.
  const state = await snapshotBoardDoc(source.id);
  // Pending suggestions stay with the board they were proposed for (KAI-169).
  const editors = atLeast(role, 'editor') ? await snapshotBoardLayer(source.id, 'editors', { withoutSuggestions: true }) : null;
  return repo.transaction(async () => {
    const copy = await createBoard(userId, `Copy of ${source.title}`.slice(0, 200), source.description, 'none', place);
    await recordAudit({
      action: 'board.duplicated',
      workspaceId: source.workspaceId,
      actorId: userId,
      target: boardTarget(source),
      metadata: { copy: copy.id, copyWorkspace: copy.workspaceId },
    });
    if (state) await initBoardDoc(copy.id, state);
    if (editors) await initBoardLayer(copy.id, 'editors', editors);
    return copy;
  });
}

// ---- workspaces (called by modules/workspaces through index.ts) ----

/** Deletes every board of a workspace (inside the caller's transaction); then call cleanUpDeletedBoards. */
export function deleteBoardRowsInWorkspace(workspaceId: string): Promise<Array<{ id: string; thumbnail: string | null }>> {
  return repo.deleteAllInWorkspace(workspaceId);
}

/** After board rows were deleted: disconnect everyone, make sure nothing saves after, delete thumbnails. */
export async function cleanUpDeletedBoards(gone: Array<{ id: string; thumbnail: string | null }>): Promise<void> {
  for (const b of gone) {
    await closeBoardDoc(b.id);
    await deleteUpload(b.thumbnail);
  }
}
