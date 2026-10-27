// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
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
export async function requireBoardAccess(boardId: string, userId: string, min: Role = 'viewer'): Promise<{ role: Role; ownerId: string }> {
  const { board, role } = await requireAccess(boardId, userId, min);
  return { role, ownerId: board.ownerId };
}

/** Records that the board's content changed (called by realtime, throttled). */
export async function touchBoard(boardId: string, at = Date.now()): Promise<void> {
  await repo.touch(boardId, at);
}
