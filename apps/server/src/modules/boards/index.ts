// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
import { closeBoardDoc } from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import * as repo from './repo';
import { requireAccess, roleOn } from './service';

export { createBoard } from './service';

/** The user's effective role on a board (`exists: false` when there is no such board). */
export async function getBoardAccess(
  boardId: string,
  userId: string,
): Promise<{ exists: boolean; role: Role | null; ownerId: string | null }> {
  const board = await repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null };
  return { exists: true, role: await roleOn(board, userId), ownerId: board.ownerId };
}

/** Throws a 404/403 HttpError unless the user has at least `min` on the board. */
export async function requireBoardAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{ role: Role; ownerId: string; title: string }> {
  const { board, role } = await requireAccess(boardId, userId, min);
  return { role, ownerId: board.ownerId, title: board.title };
}

/** The board's title, or null if there is no such board (invite previews). */
export async function getBoardTitle(boardId: string): Promise<string | null> {
  return (await repo.getBoard(boardId))?.title ?? null;
}

/**
 * Account purge: deletes every board the user owns, like DELETE /boards/:id does (everyone is
 * disconnected first, then the row — members, stars, opens and doc cascade — then the thumbnail).
 */
export async function deleteBoardsOwnedBy(userId: string): Promise<number> {
  const boards = await repo.getBoards(await repo.boardIdsOwnedBy(userId));
  for (const board of boards) {
    await closeBoardDoc(board.id);
    await repo.deleteBoard(board.id);
    await deleteUpload(board.thumbnail);
  }
  return boards.length;
}

/** Boards the user ever opened (they may have commented there). */
export async function boardIdsOpenedBy(userId: string): Promise<string[]> {
  return [...(await repo.opensOf(userId)).keys()];
}

/** Records that the board's content changed (called by realtime, throttled). */
export async function touchBoard(boardId: string, at = Date.now()): Promise<void> {
  await repo.touch(boardId, at);
}
