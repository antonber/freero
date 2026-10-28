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
export {
  onBoardShared,
  onInviteAccepted,
  onAccessRequested,
  onAccessDecided,
  type BoardSharedEvent,
  type InviteAcceptedEvent,
  type AccessRequestedEvent,
  type AccessDecidedEvent,
} from './events';
// Access requests (routes.ts serves them): filing and deciding one, and where the ones behind
// notifications stand (the inbox shows it).
export { requestAccess, decideRequest as decideAccessRequest, requestOutcomes as accessRequestOutcomes } from './accessRequests';
export { invitedEmails } from './invites';

/** The explicit membership role of a user on a board (not counting ownership or link access). */
export async function getMemberRole(boardId: string, userId: string): Promise<Role | null> {
  return (await repo.getMembership(boardId, userId))?.role ?? null;
}

/** boardId -> membership role for every board the user was invited to. */
export async function membershipsOf(userId: string): Promise<Map<string, Role>> {
  return new Map((await repo.listByUser(userId)).map((m) => [m.boardId, m.role]));
}
