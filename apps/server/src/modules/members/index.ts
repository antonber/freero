// Public API of modules/members [S2].
// Memberships of a deleted board (or user) are removed by the database (ON DELETE CASCADE).
import type { Role } from '@freero/shared';
import { recordAuditQuietly } from '../audit/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Membership } from './roles';

export { resolveRole, resolveGuestRole, resolveCoOwner, managesSharing, atLeast, isLinkAccess, ROLE_RANK, type WorkspaceAccess, type Membership } from './roles';

const RANK = { viewer: 1, commenter: 2, editor: 3 } as const;
const higher = <R extends keyof typeof RANK>(a: R | undefined, b: R | undefined): R | undefined => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

/**
 * The user's membership on a board — the highest of their direct membership and what their groups
 * were given there (#63) — and whether it is a co-owner's (#122: only ever a direct one), or null.
 */
export async function getMembership(boardId: string, userId: string): Promise<Membership | null> {
  const [m, groups] = await Promise.all([repo.getMembership(boardId, userId), repo.groupRolesOf(userId, boardId)]);
  const role = higher(m?.role, groups.get(boardId));
  return role ? { role, coOwner: !!m?.coOwner && role === 'editor' } : null;
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
export { listBoardGroups, shareBoardWithGroup, unshareBoardGroup } from './groups';
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

/** boardId -> membership role for every board the user was invited to, or (#63) one of their groups was. */
export async function membershipsOf(userId: string): Promise<Map<string, Role>> {
  const [direct, groups] = await Promise.all([repo.listByUser(userId), repo.groupRolesOf(userId)]);
  const out = new Map<string, 'editor' | 'commenter' | 'viewer'>(groups);
  for (const m of direct) out.set(m.boardId, higher(m.role, out.get(m.boardId))!);
  return out;
}

/** Boards shared with a group (#63: its membership changes re-resolve them). */
export function boardIdsGrantedTo(groupId: string): Promise<string[]> {
  return repo.boardIdsGrantedTo(groupId);
}
