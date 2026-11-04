// User groups made in Freero (#63): a team workspace's members admins make groups of its members;
// boards (members' board_group_grants) and projects (project_groups) are shared with a group, and
// access follows its membership — joining or leaving re-resolves every board the group reaches, on
// every instance, live sockets included. A group holds only members of its workspace (leaving the
// workspace leaves its groups: repo.removeMember), and its grants count only on that workspace's
// boards. Directory (SCIM) groups are shown beside them, read-only.
import type { DirectoryGroup, WorkspaceGroup, WorkspaceMember } from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { getUser, getUsers } from '../auth/index';
import { boardIdsUnderProject } from './projects';
import { boardIdsGrantedTo } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { GroupRow } from './repo';
import { requireWorkspace } from './service';

const MAX_NAME = 60;
const MAX_GROUPS = 200;

const toGroup = (g: GroupRow): WorkspaceGroup => ({ ...g });
const groupTarget = (g: { id: string; name: string }) => ({ type: 'group', id: g.id, label: g.name });

function cleanGroupName(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest('Give the group a name');
  return v.trim().slice(0, MAX_NAME);
}

/** Directory groups the workspace's SCIM keeps, shown read-only (modules/scim registers the reader). */
type DirectoryReader = (workspaceId: string) => Promise<DirectoryGroup[]>;
let directoryReader: DirectoryReader = async () => [];
export function setDirectoryGroupReader(fn: DirectoryReader): void {
  directoryReader = fn;
}

/** The workspace's groups (its members, not guests, see them: they share with them). */
export async function listGroups(workspaceId: string, userId: string): Promise<{ groups: WorkspaceGroup[]; directory: DirectoryGroup[] }> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'member');
  if (workspace.kind !== 'team') return { groups: [], directory: [] };
  const [groups, directory] = await Promise.all([repo.groupsIn(workspaceId), directoryReader(workspaceId)]);
  return { groups: groups.map(toGroup), directory };
}

/** A group and its workspace, the caller being at least `min` there (members admins for changes). */
async function groupFor(groupId: string, userId: string, manage: boolean): Promise<GroupRow> {
  const g = await repo.getGroup(groupId);
  if (!g) throw notFound('Group not found');
  await requireWorkspace(g.workspaceId, userId, manage ? 'admin' : 'member', manage ? { scope: 'members' } : {});
  return g;
}

export async function createGroup(workspaceId: string, userId: string, body: { name?: unknown }): Promise<WorkspaceGroup> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin', { scope: 'members' });
  if (workspace.kind !== 'team') throw badRequest('Groups belong to a team workspace');
  const name = cleanGroupName(body.name);
  const id = newId(12);
  await repo.transaction(async () => {
    if ((await repo.groupsIn(workspaceId)).length >= MAX_GROUPS) throw badRequest(`A workspace can have at most ${MAX_GROUPS} groups`);
    if (!(await repo.insertGroup(id, workspaceId, name, userId, Date.now()))) throw new HttpError(409, `There already is a group called “${name}”`);
    await recordAudit({ action: 'group.created', workspaceId, actorId: userId, target: groupTarget({ id, name }) });
  });
  return toGroup((await repo.getGroup(id))!);
}

export async function renameGroup(groupId: string, userId: string, body: { name?: unknown }): Promise<WorkspaceGroup> {
  const g = await groupFor(groupId, userId, true);
  const name = cleanGroupName(body.name);
  const done = await repo.renameGroup(groupId, name);
  if (done === 'taken') throw new HttpError(409, `There already is a group called “${name}”`);
  if (!done) throw notFound('Group not found');
  if (name !== g.name) await recordAudit({ action: 'group.renamed', workspaceId: g.workspaceId, actorId: userId, target: groupTarget({ id: g.id, name }), metadata: { from: g.name } });
  return toGroup((await repo.getGroup(groupId))!);
}

/** Every board the group reaches: shared with it directly, or in a project shared with it. */
async function boardsOfGroup(groupId: string): Promise<string[]> {
  const [direct, projects] = await Promise.all([boardIdsGrantedTo(groupId), repo.projectIdsOfGroup(groupId)]);
  // A project's sub-projects too (#129): their boards are reached through it.
  const inProjects = (await Promise.all(projects.map((p) => boardIdsUnderProject(p)))).flat();
  return [...new Set([...direct, ...inProjects])];
}

async function refreshBoards(ids: string[]): Promise<void> {
  for (const id of ids) await refreshBoardAccess(id);
}

/** Deletes a group: everything shared with it stops reaching its members (grants go with it). */
export async function deleteGroup(groupId: string, userId: string): Promise<void> {
  const g = await groupFor(groupId, userId, true);
  const boards = await boardsOfGroup(groupId);
  await repo.transaction(async () => {
    if (!(await repo.deleteGroup(groupId))) throw notFound('Group not found');
    await recordAudit({ action: 'group.deleted', workspaceId: g.workspaceId, actorId: userId, target: groupTarget(g), metadata: { members: g.memberCount, boards: boards.length } });
  });
  await refreshBoards(boards);
}

export async function listGroupMembers(groupId: string, userId: string): Promise<WorkspaceMember[]> {
  const g = await groupFor(groupId, userId, false);
  const ids = await repo.groupMemberIds(groupId);
  const [users, roles] = await Promise.all([getUsers(ids), repo.listMembers(g.workspaceId)]);
  const roleOf = new Map(roles.map((m) => [m.userId, m]));
  return ids.flatMap((id) => {
    const u = users.get(id);
    const m = roleOf.get(id);
    return u && m ? [{ userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role: m.role, joinedAt: m.createdAt }] : [];
  });
}

/**
 * Adds someone to a group or takes them out (members admins). Only a member of the group's
 * workspace can be in it. Every board the group reaches is re-resolved at once, on every instance:
 * someone taken out loses a board shared only with the group on their next request and their open socket.
 */
export async function setGroupMember(groupId: string, userId: string, targetId: string, member: boolean): Promise<WorkspaceGroup> {
  const g = await groupFor(groupId, userId, true);
  if (member && !(await repo.getRole(g.workspaceId, targetId))) throw badRequest('Add them to the workspace first');
  const changed = await repo.transaction(async () => {
    const done = member ? await repo.addGroupMember(groupId, targetId, Date.now()) : await repo.removeGroupMember(groupId, targetId);
    if (!done) {
      if (!member) throw notFound('That person is not in this group');
      return false;
    }
    await recordAudit({
      action: member ? 'group.member_added' : 'group.member_removed',
      workspaceId: g.workspaceId,
      actorId: userId,
      target: groupTarget(g),
      metadata: { userId: targetId, email: (await getUser(targetId))?.email ?? null },
    });
    return true;
  });
  if (changed) await refreshBoards(await boardsOfGroup(groupId));
  return toGroup((await repo.getGroup(groupId))!);
}

/** A group of the workspace (for a board or project being shared with it), or 404. */
export async function groupOfWorkspace(groupId: string, workspaceId: string): Promise<GroupRow> {
  const g = await repo.getGroup(groupId);
  if (!g || g.workspaceId !== workspaceId) throw notFound('That group is not in this workspace');
  return g;
}
