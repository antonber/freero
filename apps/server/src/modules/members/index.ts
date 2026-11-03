// Public API of modules/members [S2].
// Memberships of a deleted board (or user) are removed by the database (ON DELETE CASCADE).
import type { Role } from '@freero/shared';
import { recordAuditQuietly } from '../audit/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Membership } from './roles';

export { resolveRole, resolveGuestRole, resolveCoOwner, managesSharing, atLeast, isLinkAccess, ROLE_RANK, type WorkspaceAccess, type Membership } from './roles';

/** The user's direct membership on a board — its role and whether it is a co-owner's (#122) — or null. */
export async function getMembership(boardId: string, userId: string): Promise<Membership | null> {
  const m = await repo.getMembership(boardId, userId);
  return m ? { role: m.role, coOwner: m.coOwner } : null;
}

/** The boards the user co-owns through a membership (#122; the resolver still decides whether it counts). */
export async function coOwnedBoardIds(userId: string): Promise<Set<string>> {
  return new Set((await repo.listByUser(userId)).filter((m) => m.coOwner).map((m) => m.boardId));
}

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
// Sharing a board (its routes and the public API use the same rules).
export { listBoardMembers, inviteBoardMember, setBoardMemberRole, removeBoardMember } from './service';
// Membership changes, appended to the outbox with the change (the event stream, modules/events; KAI-150).
export { MEMBER_EVENTS_TOPIC, type MemberEventRecord } from './repo';

/** The explicit membership role of a user on a board (not counting ownership or link access). */
export async function getMemberRole(boardId: string, userId: string): Promise<Role | null> {
  return (await repo.getMembership(boardId, userId))?.role ?? null;
}

/** boardId -> the user ids with a direct membership on it (the admin inventory, #152). */
export async function memberIdsOfBoards(boardIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const m of await repo.listByBoards(boardIds)) out.set(m.boardId, [...(out.get(m.boardId) ?? []), m.userId]);
  return out;
}

/**
 * A content admin ends the memberships of everyone on the board who isn't in its workspace (#152;
 * the caller checked the scope and that the board is the workspace's). Each removal is audited;
 * live sockets are re-resolved. Returns how many went.
 */
export async function removeOutsideMembers(
  board: { id: string; title: string; kind: 'board' | 'doc' },
  workspaceId: string,
  inWorkspace: Set<string>,
  actorId: string,
): Promise<number> {
  let removed = 0;
  for (const m of await repo.listByBoard(board.id)) {
    if (inWorkspace.has(m.userId)) continue;
    if (!(await repo.removeMember(board.id, m.userId, { actorId }))) continue;
    removed++;
    await recordAuditQuietly({
      action: 'board.member_removed',
      workspaceId,
      actorId,
      target: { type: board.kind, id: board.id, label: board.title },
      metadata: { userId: m.userId, left: false, by: 'admin', reason: 'outside_workspace' },
    });
  }
  if (removed) await refreshBoardAccess(board.id);
  return removed;
}

/** User ids with a direct membership on the board (not the owner, not team or link access). */
export async function memberIdsOf(boardId: string): Promise<string[]> {
  return (await repo.listByBoard(boardId)).map((m) => m.userId);
}

/** boardId -> membership role for every board the user was invited to. */
export async function membershipsOf(userId: string): Promise<Map<string, Role>> {
  return new Map((await repo.listByUser(userId)).map((m) => [m.boardId, m.role]));
}
