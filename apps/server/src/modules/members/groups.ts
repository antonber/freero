// Sharing a board with a group of its workspace (#63). Who may: whoever may invite people to the
// board (owners, co-owners, editors while "Editors can share" is on); a group with guests in it only
// as the workspace's guest-invite policy lets them invite guests — a group grant is never a way
// around it. Stopping it: owners and co-owners. Members of the group get at least the role
// (getMembership / membershipsOf take the highest of their direct membership and their groups'
// grants; resolveRole does the rest, `blocked` and the outside-sharing policy included).
import type { BoardGroupGrant } from '@freero/shared';
import { badRequest, forbidden } from '../../platform/http';
import { recordAudit } from '../audit/index';
import { requireBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import { groupOfWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { isMemberRole } from './roles';
import { requireMayInvite } from './service';

const toGrant = (g: repo.GrantRow): BoardGroupGrant => ({ groupId: g.groupId, name: g.name, role: g.role, memberCount: g.memberCount });

export async function listBoardGroups(boardId: string, userId: string): Promise<BoardGroupGrant[]> {
  await requireBoardAccess(boardId, userId);
  return (await repo.grantsOf(boardId)).map(toGrant);
}

export async function shareBoardWithGroup(boardId: string, userId: string, groupId: string, role: unknown): Promise<BoardGroupGrant[]> {
  if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
  const access = await requireBoardAccess(boardId, userId, 'editor');
  requireMayInvite(access);
  const group = await groupOfWorkspace(groupId, access.workspaceId);
  if (group.guestCount > 0 && !access.mayInviteGuests)
    throw forbidden(`${group.name} has guests in it, and in this workspace only owners and admins can invite guests`);
  const before = await repo.upsertGrant(boardId, groupId, role, userId, Date.now());
  if (before === false) throw badRequest('That board or group no longer exists');
  if (before !== role)
    await recordAudit({
      action: 'board.group_shared',
      workspaceId: access.workspaceId,
      actorId: userId,
      target: { type: access.kind, id: boardId, label: access.title },
      metadata: { groupId, group: group.name, role, from: before, members: group.memberCount },
    });
  await refreshBoardAccess(boardId);
  return (await repo.grantsOf(boardId)).map(toGrant);
}

export async function unshareBoardGroup(boardId: string, userId: string, groupId: string): Promise<BoardGroupGrant[]> {
  const access = await requireBoardAccess(boardId, userId);
  if (!access.manages) throw forbidden('Only the board’s owner and co-owners can stop sharing it with a group');
  const was = await repo.deleteGrant(boardId, groupId);
  if (was)
    await recordAudit({
      action: 'board.group_unshared',
      workspaceId: access.workspaceId,
      actorId: userId,
      target: { type: access.kind, id: boardId, label: access.title },
      metadata: { groupId, role: was },
    });
  await refreshBoardAccess(boardId);
  return (await repo.grantsOf(boardId)).map(toGrant);
}
