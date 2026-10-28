// Workspaces: personal + team, members and roles, sharing policies, ownership transfer, and what
// a workspace grants on its boards (asked by modules/boards for every access decision).
import type { LinkAccess, Role, TeamAccess, WorkspaceMember, WorkspacePolicies, WorkspaceRole, WorkspaceSummary } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { getUser, getUsers } from '../auth/index';
import {
  boardIdsInWorkspace,
  cleanUpDeletedBoards,
  deleteBoardRowsInWorkspace,
  transferBoardsOwnedIn,
} from '../boards/index';
import { removeBoardMemberships } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import { membershipChanged } from './events';
import * as repo from './repo';
import type { Workspace } from './repo';
import {
  DEFAULT_POLICIES,
  isFullMember,
  isManager,
  isWorkspaceRole,
  LINK_VALUES,
  mayChangeRole,
  mayRemove,
  teamAccessOf,
  TEAM_ACCESS_VALUES,
  teamRole,
} from './roles';

const MAX_NAME = 80;

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name is required');
  const t = v.trim().slice(0, MAX_NAME);
  if (!t) throw badRequest('Give the workspace a name');
  return t;
}

/** The user's personal workspace (created on first use: at signup nothing else has to know). */
export function ensurePersonalWorkspace(userId: string): Promise<string> {
  return repo.ensurePersonal(userId, newId(12), Date.now());
}

const toSummary = (w: Workspace, role: WorkspaceRole, memberCount: number): WorkspaceSummary => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  role,
  memberCount,
  policies: w.policies,
  createdAt: w.createdAt,
});

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  await ensurePersonalWorkspace(userId);
  return (await repo.workspacesOf(userId)).map((r) => toSummary(r.workspace, r.role, r.memberCount));
}

export async function workspaceSummary(workspaceId: string, userId: string): Promise<WorkspaceSummary> {
  const row = (await repo.workspacesOf(userId)).find((r) => r.workspace.id === workspaceId);
  if (!row) throw notFound('Workspace not found');
  return toSummary(row.workspace, row.role, row.memberCount);
}

const ROLE_RANK: Record<WorkspaceRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

/**
 * The workspace and the user's role there: 404 unless they are in it (a workspace you're not in
 * doesn't exist for you), 403 below `min`.
 */
export async function requireWorkspace(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'guest',
): Promise<{ workspace: Workspace; role: WorkspaceRole }> {
  const [workspace, role] = await Promise.all([repo.getWorkspace(workspaceId), repo.getRole(workspaceId, userId)]);
  if (!workspace || !role) throw notFound('Workspace not found');
  if (ROLE_RANK[role] < ROLE_RANK[min])
    throw forbidden(min === 'owner' ? 'Only a workspace owner can do that' : min === 'admin' ? 'Only workspace owners and admins can do that' : 'Guests can’t do that');
  return { workspace, role };
}

const teamOnly = (w: Workspace) => {
  if (w.kind !== 'team') throw badRequest('Your personal workspace has no members or policies. Create a team workspace to collaborate.');
};

export async function createTeamWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
  const id = newId(12);
  await repo.transaction(async () => {
    const max = getConfig().maxWorkspacesPerUser;
    await repo.lockCreateQuota(userId);
    if ((await repo.countOwnedTeams(userId)) >= max) throw forbidden(`You can own at most ${max} team workspaces.`);
    await repo.insertTeam(id, name, userId, Date.now());
  });
  return workspaceSummary(id, userId);
}

/** Re-resolves everyone connected to the workspace's boards (on every instance). */
export async function refreshWorkspaceBoards(workspaceId: string): Promise<void> {
  for (const id of await boardIdsInWorkspace(workspaceId)) await refreshBoardAccess(id);
}

function cleanPolicies(v: unknown): Partial<WorkspacePolicies> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('policies must be an object');
  const p = v as Record<string, unknown>;
  const out: Partial<WorkspacePolicies> = {};
  const pick = <K extends keyof WorkspacePolicies>(k: K, allowed: readonly WorkspacePolicies[K][]) => {
    if (p[k] === undefined) return;
    if (!allowed.includes(p[k] as WorkspacePolicies[K])) throw badRequest(`policies.${k} must be one of ${allowed.join(', ')}`);
    out[k] = p[k] as WorkspacePolicies[K];
  };
  pick('externalSharing', ['anyone', 'admins', 'none']);
  pick('linkSharing', LINK_VALUES);
  pick('guestInvites', ['admins', 'members']);
  pick('downloads', ['anyone', 'members', 'admins']);
  pick('teamAccess', TEAM_ACCESS_VALUES);
  pick('publicLinks', ['anyone', 'signedIn']);
  return out;
}

/** Rename and/or change policies (owners/admins of a team workspace). Policy changes apply to live sessions at once. */
export async function updateWorkspace(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceSummary> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  teamOnly(workspace);
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    policies: cleanPolicies(body.policies),
  };
  await repo.updateWorkspace(workspaceId, patch, Date.now());
  if (Object.keys(patch.policies).length > 0) await refreshWorkspaceBoards(workspaceId);
  return workspaceSummary(workspaceId, userId);
}

/**
 * Deletes a team workspace with every board in it (trash included), after the caller typed its
 * name. Board rows go in the same transaction as the workspace, under its lock (so no board can
 * be created in it meanwhile); then everyone connected is disconnected.
 */
export async function deleteWorkspace(workspaceId: string, userId: string, confirm: unknown): Promise<void> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  teamOnly(workspace);
  if (typeof confirm !== 'string' || confirm.trim() !== workspace.name) throw badRequest('Type the workspace name to confirm');
  await deleteTeamWorkspaceNow(workspaceId);
}

async function deleteTeamWorkspaceNow(workspaceId: string): Promise<void> {
  const gone = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return null;
    const boards = await deleteBoardRowsInWorkspace(workspaceId);
    await repo.deleteTeam(workspaceId);
    return boards;
  });
  if (gone) await cleanUpDeletedBoards(gone);
}

/**
 * Hands a team workspace to another member: they become an owner and the caller an admin, in one
 * transaction. Guests can't own a workspace.
 */
export async function transferWorkspace(workspaceId: string, userId: string, targetId: unknown): Promise<WorkspaceSummary> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  teamOnly(workspace);
  if (typeof targetId !== 'string' || !targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('You already own this workspace');
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    if ((await repo.getRole(workspaceId, userId)) !== 'owner') throw forbidden('Only a workspace owner can do that');
    const target = await repo.getRole(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (target === 'guest') throw badRequest('Make them a member first: guests can’t own a workspace');
    await repo.setRole(workspaceId, targetId, 'owner');
    await repo.setRole(workspaceId, userId, 'admin');
  });
  log(`workspaces: ${userId} transferred workspace ${workspaceId} to ${targetId}`);
  return workspaceSummary(workspaceId, userId);
}

// ---- members ----

export async function listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'member'); // guests don't browse the directory
  const rows = await repo.listMembers(workspace.id);
  const users = await getUsers(rows.map((r) => r.userId));
  const out: WorkspaceMember[] = [];
  for (const r of rows) {
    const u = users.get(r.userId);
    if (u) out.push({ userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role: r.role, joinedAt: r.createdAt });
  }
  return out;
}

export async function memberOf(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  const [role, u] = await Promise.all([repo.getRole(workspaceId, userId), getUser(userId)]);
  if (!role || !u) return null;
  return { userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role, joinedAt: Date.now() };
}

const lastOwner = () => new HttpError(409, 'A workspace needs at least one owner. Make someone else an owner first.');

/** Changes a member's role; never leaves the workspace without an owner (checked under its lock). */
export async function changeRole(workspaceId: string, actorId: string, targetId: string, role: unknown): Promise<WorkspaceMember> {
  if (!isWorkspaceRole(role)) throw badRequest('role must be owner, admin, member or guest');
  const { workspace, role: actor } = await requireWorkspace(workspaceId, actorId, 'admin');
  teamOnly(workspace);
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    const from = await repo.getRole(workspaceId, targetId);
    if (!from) throw notFound('That person is not a member of this workspace');
    if (!mayChangeRole(actor, from, role)) throw forbidden('Only a workspace owner can change the role of owners and admins');
    if (from === 'owner' && role !== 'owner' && (await repo.countOwners(workspaceId)) <= 1) throw lastOwner();
    await repo.setRole(workspaceId, targetId, role);
  });
  await refreshWorkspaceBoards(workspaceId);
  await membershipChanged({ workspaceId, userId: targetId, role });
  const m = await memberOf(workspaceId, targetId);
  if (!m) throw notFound('That person is not a member of this workspace');
  return m;
}

/**
 * Removes a member (or the caller leaves). Their live sessions lose the workspace's boards at once,
 * on every instance; their direct invitations to its boards end too; boards they owned there pass
 * to the person who removed them (or, when leaving, to an owner) — team content stays with the team.
 */
export async function removeMember(workspaceId: string, actorId: string, targetId: string): Promise<void> {
  const { workspace, role: actor } = await requireWorkspace(workspaceId, actorId);
  teamOnly(workspace);
  const self = actorId === targetId;
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    const target = await repo.getRole(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (!self && !mayRemove(actor, target)) throw forbidden('Only a workspace owner can remove owners and admins');
    if (target === 'owner' && (await repo.countOwners(workspaceId)) <= 1) throw lastOwner();
    await repo.removeMember(workspaceId, targetId);
    const heir = self ? (await repo.listMembers(workspaceId)).find((m) => m.role === 'owner')!.userId : actorId;
    await transferBoardsOwnedIn(workspaceId, targetId, heir);
    await removeBoardMemberships(await boardIdsInWorkspace(workspaceId), targetId);
  });
  await refreshWorkspaceBoards(workspaceId);
  await membershipChanged({ workspaceId, userId: targetId, role: null });
}

// ---- what a workspace grants on its boards ----

/** Everything a board access decision needs from the board's workspace (see members/roles.ts resolveRole). */
export interface BoardWorkspaceAccess {
  /**
   * The board's workspace as people see it: a team's name, whether the board is in a private
   * project, and the team access level its members get — or null for a personal workspace.
   */
  team: { name: string; private: boolean; access: TeamAccess } | null;
  workspaceRole: WorkspaceRole | null;
  policies: WorkspacePolicies;
  /** What the workspace grants by itself (team access). */
  teamRole: Role | null;
  /** The user is in the board's workspace (any role, guests included). */
  inWorkspace: boolean;
  /** "External sharing: nobody": outside access (direct invites, links) stops working. */
  outsidersBlocked: boolean;
  /** Highest link access the workspace allows. */
  maxLink: LinkAccess;
}

type BoardPlace = { workspaceId: string; projectId: string | null };

/**
 * Loads what's needed to decide access to boards of `workspaceIds` for one user (one round of
 * queries), and returns the per-board function. For lists; single boards use `boardAccess`.
 */
export async function boardAccessLoader(userId: string, workspaceIds: string[]): Promise<(b: BoardPlace) => BoardWorkspaceAccess> {
  const ids = [...new Set(workspaceIds)];
  const [workspaces, roles, projects, myProjects] = await Promise.all([
    repo.getWorkspaces(ids),
    repo.rolesOf(userId),
    repo.projectsIn(ids),
    repo.projectIdsOf(userId, ids),
  ]);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return (b) => {
    const ws = wsById.get(b.workspaceId);
    const policies = ws?.policies ?? DEFAULT_POLICIES;
    const role = roles.get(b.workspaceId) ?? null;
    const project = b.projectId ? (projectById.get(b.projectId) ?? null) : null;
    const level = teamAccessOf(policies, project);
    return {
      team: ws?.kind === 'team' ? { name: ws.name, private: project?.access === 'private', access: level } : null,
      workspaceRole: role,
      policies,
      teamRole: teamRole(role, project ? { access: project.access, member: myProjects.has(project.id) } : null, level),
      inWorkspace: role !== null,
      outsidersBlocked: policies.externalSharing === 'none',
      maxLink: policies.linkSharing,
    };
  };
}

export async function boardAccess(userId: string, board: BoardPlace): Promise<BoardWorkspaceAccess> {
  return (await boardAccessLoader(userId, [board.workspaceId]))(board);
}

/**
 * Everyone the workspace itself gives access to a board placed at `place` (team access), with the
 * role it gives them: its owners/admins (editor), and its members (guests only through a project
 * they are in) unless the board is in a private project they're outside of (the board's team
 * access level). Empty for a personal workspace.
 */
export async function teamMembers(place: BoardPlace): Promise<Array<{ userId: string; role: Role; workspaceRole: WorkspaceRole }>> {
  const ws = await repo.getWorkspace(place.workspaceId);
  if (!ws || ws.kind !== 'team') return [];
  const [members, project, inProject] = await Promise.all([
    repo.listMembers(ws.id),
    place.projectId ? repo.getProject(place.projectId) : Promise.resolve(null),
    place.projectId ? repo.projectMemberIds(place.projectId) : Promise.resolve([] as string[]),
  ]);
  const inP = new Set(inProject);
  const level = teamAccessOf(ws.policies, project);
  const out: Array<{ userId: string; role: Role; workspaceRole: WorkspaceRole }> = [];
  for (const m of members) {
    const role = teamRole(m.role, project ? { access: project.access, member: inP.has(m.userId) } : null, level);
    if (role) out.push({ userId: m.userId, role, workspaceRole: m.role });
  }
  return out;
}

export async function teamMemberIds(place: BoardPlace): Promise<string[]> {
  return (await teamMembers(place)).map((m) => m.userId);
}

/** workspaceId -> the user's role, for every workspace they're in. */
export function workspaceRolesOf(userId: string): Promise<Map<string, WorkspaceRole>> {
  return repo.rolesOf(userId);
}

/** The user's role in one workspace, or null. */
export function workspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return repo.getRole(workspaceId, userId);
}

export async function getWorkspaceInfo(workspaceId: string): Promise<{ id: string; kind: 'personal' | 'team'; personalOf: string | null; name: string } | null> {
  const w = await repo.getWorkspace(workspaceId);
  return w ? { id: w.id, kind: w.kind, personalOf: w.personalOf, name: w.name } : null;
}

/**
 * Inside the caller's transaction: checks `userId` may create boards in the workspace (a member,
 * not a guest) and keeps the workspace from being deleted until that transaction ends.
 */
export async function lockWorkspaceForNewBoard(workspaceId: string, userId: string): Promise<void> {
  if (!(await repo.lockWorkspace(workspaceId, 'share'))) throw notFound('Workspace not found');
  const role = await repo.getRole(workspaceId, userId);
  if (!role) throw notFound('Workspace not found');
  if (!isFullMember(role)) throw forbidden('Guests can’t create boards in this workspace');
}

/** Team workspace ids the user may share templates with (members, not guests). */
export async function teamWorkspaceIdsFor(userId: string): Promise<string[]> {
  return (await repo.teamMembershipsOf(userId)).filter((m) => isFullMember(m.role)).map((m) => m.workspaceId);
}

export { isManager };

// ---- account deletion ----

/**
 * Before an account is purged: in every team workspace where the user is the only owner, the
 * longest-standing admin (else member, else guest) becomes owner; a team with nobody else in it is
 * deleted with its boards. Boards the user owned in team workspaces pass to an owner of that
 * workspace, so team content survives. Idempotent (a purge interrupted halfway is simply redone).
 * The personal workspace is not touched here: it goes with the account row.
 */
export async function handOverTeamWorkspaces(userId: string): Promise<void> {
  for (const { workspaceId } of await repo.teamMembershipsOf(userId)) {
    const orphaned = await repo.transaction(async () => {
      if (!(await repo.lockWorkspace(workspaceId, 'update'))) return false;
      const others = (await repo.listMembers(workspaceId)).filter((m) => m.userId !== userId); // oldest first
      let heir = others.find((m) => m.role === 'owner');
      if (!heir) {
        heir = others.find((m) => m.role === 'admin') ?? others.find((m) => m.role === 'member') ?? others.find((m) => m.role === 'guest');
        if (!heir) return true;
        await repo.setRole(workspaceId, heir.userId, 'owner');
        log(`workspaces: ${heir.userId} now owns workspace ${workspaceId} (its owner's account was deleted)`);
      }
      await transferBoardsOwnedIn(workspaceId, userId, heir.userId);
      return false;
    });
    if (orphaned) await deleteTeamWorkspaceNow(workspaceId);
  }
}
