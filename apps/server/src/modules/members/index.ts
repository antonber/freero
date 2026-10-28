// Public API of modules/members [S2].
// Memberships of a deleted board (or user) are removed by the database (ON DELETE CASCADE).
import type { Role } from '@freero/shared';
import * as repo from './repo';

export { resolveRole, atLeast, isLinkAccess, ROLE_RANK } from './roles';
export { onBoardShared, onInviteAccepted, type BoardSharedEvent, type InviteAcceptedEvent } from './events';
export { invitedEmails } from './invites';

/** The explicit membership role of a user on a board (not counting ownership or link access). */
export async function getMemberRole(boardId: string, userId: string): Promise<Role | null> {
  return (await repo.getMembership(boardId, userId))?.role ?? null;
}

/** boardId -> membership role for every board the user was invited to. */
export async function membershipsOf(userId: string): Promise<Map<string, Role>> {
  return new Map((await repo.listByUser(userId)).map((m) => [m.boardId, m.role]));
}
