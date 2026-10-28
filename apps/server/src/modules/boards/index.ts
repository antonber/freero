// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
import { closeBoardDoc } from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import { mayShareExternally, workspaceRole } from '../workspaces/index';
import * as repo from './repo';
import { describeAccess, requireAccess, requireDownload } from './service';

export { createBoard, deleteBoardRowsInWorkspace, cleanUpDeletedBoards } from './service';

/** The user's effective role on a board (`exists: false` when there is no such board). */
export async function getBoardAccess(
  boardId: string,
  userId: string,
): Promise<{ exists: boolean; role: Role | null; ownerId: string | null }> {
  const board = await repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null };
  return { exists: true, role: (await describeAccess(board, userId)).role, ownerId: board.ownerId };
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

/** 403 unless the user may export / download the board's content (its workspace's "downloads" policy). */
export async function requireBoardDownload(boardId: string, userId: string): Promise<void> {
  const { access } = await requireAccess(boardId, userId);
  requireDownload(access);
}

/** The board's title, or null if there is no such board (invite previews). */
export async function getBoardTitle(boardId: string): Promise<string | null> {
  return (await repo.getBoard(boardId))?.title ?? null;
}

/**
 * Account purge: deletes every board the user still owns, like DELETE /boards/:id does (everyone
 * is disconnected first, then the row — members, stars, opens and doc cascade — then the
 * thumbnail). Boards in team workspaces were handed over before (workspaces.handOverTeamWorkspaces).
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
