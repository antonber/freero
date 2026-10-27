// Public API of modules/members [S2].
import type { Role } from '@freero/shared';
import * as repo from './repo';

export { resolveRole, atLeast, isLinkAccess, ROLE_RANK } from './roles';

/** The explicit membership role of a user on a board (not counting ownership or link access). */
export function getMemberRole(boardId: string, userId: string): Role | null {
  return repo.getMembership(boardId, userId)?.role ?? null;
}

/** boardId -> membership role for every board the user was invited to. */
export function membershipsOf(userId: string): Map<string, Role> {
  return new Map(repo.listByUser(userId).map((m) => [m.boardId, m.role]));
}

/** Removes every membership of a board (used when the board is deleted). */
export function deleteBoardMembers(boardId: string): void {
  repo.removeAllForBoard(boardId);
}
