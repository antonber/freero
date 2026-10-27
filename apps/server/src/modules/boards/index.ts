// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
import * as repo from './repo';
import { requireAccess, roleOn } from './service';

/** The user's effective role on a board (`exists: false` when there is no such board). */
export function getBoardAccess(boardId: string, userId: string): { exists: boolean; role: Role | null; ownerId: string | null } {
  const board = repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null };
  return { exists: true, role: roleOn(board, userId), ownerId: board.ownerId };
}

/** Throws a 404/403 HttpError unless the user has at least `min` on the board. */
export function requireBoardAccess(boardId: string, userId: string, min: Role = 'viewer'): { role: Role; ownerId: string } {
  const { board, role } = requireAccess(boardId, userId, min);
  return { role, ownerId: board.ownerId };
}

/** Records that the board's content changed (called by realtime, throttled). */
export function touchBoard(boardId: string, at = Date.now()): void {
  repo.touch(boardId, at);
}
