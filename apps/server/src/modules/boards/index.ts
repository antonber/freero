// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
import { closeBoardDoc } from '../realtime/index';
import { deleteUpload, UPLOAD_REF_PATTERN } from '../uploads/index';
import { mayShareExternally, teamMembers, workspaceRole } from '../workspaces/index';
import * as repo from './repo';
import { describeAccess, listBoards, removedFor, requireAccess, requireDownload } from './service';

export { createBoard, deleteBoardRowsInWorkspace, cleanUpDeletedBoards } from './service';
// Operators (modules/moderation): take down / restore, block / unblock the link, and who may report.
export {
  boardForModeration,
  reportableBoard,
  takeDownBoard,
  restoreTakenDownBoard,
  deleteTakenDownBoard,
  countHeldBoards,
  liveBoardsOwnedBy,
  blockBoardLink,
  unblockBoardLink,
  type ModerationBoardState,
} from './moderation';

/**
 * The user's effective role on a board (`exists: false` when there is no such board, also while
 * it is trashed or taken down; `removed`: it was taken down and this user could open it otherwise).
 */
export async function getBoardAccess(
  boardId: string,
  userId: string,
): Promise<{ exists: boolean; role: Role | null; ownerId: string | null; removed: boolean }> {
  const board = await repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null, removed: await removedFor(boardId, userId) };
  return { exists: true, role: (await describeAccess(board, userId)).role, ownerId: board.ownerId, removed: false };
}

/** Throws a 404/403 HttpError unless the user has at least `min` on the board. */
export async function requireBoardAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{ role: Role; ownerId: string; title: string; workspaceId: string; canShareExternally: boolean; inWorkspace: (userId: string) => Promise<boolean> }> {
  const { board, role, access } = await requireAccess(boardId, userId, min);
  return {
    role,
    ownerId: board.ownerId,
    title: board.title,
    workspaceId: board.workspaceId,
    canShareExternally: mayShareExternally(access.workspaceRole, access.policies),
    inWorkspace: async (other) => (await workspaceRole(board.workspaceId, other)) !== null,
  };
}

/** People with access to the board through its team workspace (none for a personal workspace's board). */
export async function teamAccessUserIds(boardId: string): Promise<string[]> {
  return (await teamAccessMembers(boardId)).map((m) => m.userId);
}

/** The same, with the role the team gives each of them on this board. */
export async function teamAccessMembers(boardId: string): Promise<Array<{ userId: string; role: Role }>> {
  const board = await repo.getBoard(boardId);
  return board ? teamMembers(board) : [];
}

/** 403 unless the user may export / download the board's content (its workspace's "downloads" policy). */
export async function requireBoardDownload(boardId: string, userId: string): Promise<void> {
  const { access } = await requireAccess(boardId, userId);
  requireDownload(access);
}

/**
 * The boards of a workspace the user can open, with their role (in their personal workspace also
 * boards shared with them from outside, like the dashboard's "all"). 404 unless they are in it.
 */
export async function boardsOpenableIn(userId: string, workspaceId: string): Promise<Array<{ id: string; title: string; role: Role }>> {
  return (await listBoards(userId, 'all', '', { workspaceId })).map((b) => ({ id: b.id, title: b.title, role: b.role }));
}

/** Where a (live) board is and who owns it, or null if there is no such board. */
export async function boardPlace(
  boardId: string,
): Promise<{ id: string; title: string; ownerId: string; workspaceId: string; projectId: string | null } | null> {
  const b = await repo.getBoard(boardId);
  return b ? { id: b.id, title: b.title, ownerId: b.ownerId, workspaceId: b.workspaceId, projectId: b.projectId } : null;
}

/** The workspace a board (trashed or not) belongs to, or null if there is no such board. */
export async function boardWorkspaceId(boardId: string): Promise<string | null> {
  return (await repo.getBoardIncludingTrash(boardId))?.workspaceId ?? null;
}

/** The board's title, or null if there is no such board (invite previews). */
export async function getBoardTitle(boardId: string): Promise<string | null> {
  return (await repo.getBoard(boardId))?.title ?? null;
}

/**
 * Account purge: deletes every board the user still owns, like DELETE /boards/:id does (everyone
 * is disconnected first, then the row — members, stars, opens and doc cascade — then the
 * thumbnail). Boards in team workspaces were handed over before (workspaces.handOverTeamWorkspaces).
 * Taken-down boards are held for review and never deleted here (the purge waits for them, KAI-178).
 */
export async function deleteBoardsOwnedBy(userId: string): Promise<number> {
  for (const id of await repo.allBoardIdsOwnedBy(userId)) await closeBoardDoc(id);
  const thumbnails = await repo.deleteAllOwnedBy(userId); // trashed ones too
  for (const t of thumbnails) await deleteUpload(t);
  return thumbnails.length;
}

/** Boards the user ever opened (they may have commented there). */
export async function boardIdsOpenedBy(userId: string): Promise<string[]> {
  return [...(await repo.opensOf(userId)).keys()];
}

/** Records that the board's content changed (called by realtime, throttled). */
export async function touchBoard(boardId: string, at = Date.now()): Promise<void> {
  await repo.touch(boardId, at);
}

// ---- for modules/workspaces ----

/** Every board of a workspace (trash included): whose access to re-check when the workspace changes. */
export function boardIdsInWorkspace(workspaceId: string): Promise<string[]> {
  return repo.idsInWorkspace(workspaceId);
}

/** Board usage of a workspace for its admin console (trash counted apart; owners of live boards). */
export function workspaceBoardStats(workspaceId: string): ReturnType<typeof repo.workspaceStats> {
  return repo.workspaceStats(workspaceId, Date.now());
}

export function boardIdsInProject(projectId: string): Promise<string[]> {
  return repo.idsInProject(projectId);
}

export function countLiveBoardsInProject(projectId: string): Promise<number> {
  return repo.countLiveInProject(projectId);
}

/**
 * Every board `from` owns in the workspace (trash included) passes to `to` — someone leaving a
 * team. No quota check: the team's content must not be lost. Runs in the caller's transaction.
 */
export function transferBoardsOwnedIn(workspaceId: string, from: string, to: string): Promise<string[]> {
  return repo.transferOwnedIn(workspaceId, from, to);
}

/** Upload names used as board thumbnails (restricted to `among` when given): the uploads sweep keeps them. */
export function thumbnailUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInThumbnails(UPLOAD_REF_PATTERN, among ?? null);
}
