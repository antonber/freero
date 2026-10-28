// Public API of modules/members [S2].
// Memberships of a deleted board (or user) are removed by the database (ON DELETE CASCADE).
import type { Role } from '@freero/shared';
import * as repo from './repo';

export { resolveRole, atLeast, isLinkAccess, ROLE_RANK, type WorkspaceAccess } from './roles';

/** Ends the user's direct memberships on these boards (removed from the boards' workspace). */
export async function removeBoardMemberships(boardIds: string[], userId: string): Promise<void> {
  await repo.removeMemberships(boardIds, userId);
}

/**
 * Board ownership changed hands (inside the caller's transaction): the new owner's membership row
 * goes (ownership is stored on the board), the previous owner keeps `previousOwnerRole` (or
 * nothing, when null).
 */
export async function ownershipTransferred(
  boardId: string,
  newOwnerId: string,
  previousOwnerId: string,
  previousOwnerRole: 'editor' | null,
): Promise<void> {
  await repo.removeMember(boardId, newOwnerId);
  if (previousOwnerRole) await repo.upsertMember(boardId, previousOwnerId, previousOwnerRole, Date.now());
}
export { onBoardShared, onInviteAccepted, type BoardSharedEvent, type InviteAcceptedEvent } from './events';
export { invitedEmails } from './invites';

/** The explicit membership role of a user on a board (not counting ownership or link access). */
export async function getMemberRole(boardId: string, userId: string): Promise<Role | null> {
  return (await repo.getMembership(boardId, userId))?.role ?? null;
}

/** User ids with a direct membership on the board (not the owner, not team or link access). */
export async function memberIdsOf(boardId: string): Promise<string[]> {
  return (await repo.listByBoard(boardId)).map((m) => m.userId);
}

/** boardId -> membership role for every board the user was invited to. */
export async function membershipsOf(userId: string): Promise<Map<string, Role>> {
  return new Map((await repo.listByUser(userId)).map((m) => [m.boardId, m.role]));
}
