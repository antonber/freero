// Projects: folders of boards inside a workspace. An open project ('workspace') is seen by every
// member; a private one only by its members and the workspace's owners/admins — and so are the
// boards in it (roles.ts teamRole). Its creator and the workspace's owners/admins manage it.
//
// Nesting (#129): a project may sit in another one, PROJECT_MAX_DEPTH levels at most. Access is
// inherited and only ever narrows on the way down: a project — and every board in it — is seen
// only by someone who gets through EVERY project from it up to the top (roles.ts passesProject:
// a private one lets in its members, an open one every full member). So a sub-project can be
// private inside an open parent, but an "open" sub-project of a private parent is open only to
// the parent's people, and someone added to a sub-project gets nothing while the parent shuts
// them out (adding them is refused with the reason). Its team access level is the strictest set
// on the way up (roles.ts teamAccessOf). Moving a project changes the projects above it, so it
// needs whoever could have opened it up anyway: its manager, who also manages the project it
// leaves (or a content admin), and who sees the project it enters. Every change that can alter
// who reaches what re-resolves the boards of the whole subtree, live, on every instance.
import { PROJECT_MAX_DEPTH, PROJECT_MAX_PINNED_BOARDS, type ProjectAccess, type ProjectSummary, type TeamAccess, type WorkspaceGroup, type WorkspaceRole } from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardIdsInProject, countLiveBoardsInProject, liveBoardsInProject, moveAllBoardsOfProject, trashBoardForProject } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Project } from './repo';
import { contentRole, isManager, isTeamAccess, passesProject, projectChain } from './roles';
import { requireWorkspace } from './service';

const cleanName = (v: unknown): string => {
  if (typeof v !== 'string') throw badRequest('name is required');
  const t = v.trim().slice(0, 80);
  if (!t) throw badRequest('Give the project a name');
  return t;
};
const cleanAccess = (v: unknown): ProjectAccess => {
  if (v !== 'workspace' && v !== 'private') throw badRequest('access must be workspace or private');
  return v;
};
/** A project's own team access level, or null for the workspace's. */
const cleanTeamAccess = (v: unknown): TeamAccess | null => {
  if (v === null) return null;
  if (!isTeamAccess(v)) throw badRequest('teamAccess must be editor, commenter, viewer or null');
  return v;
};
const cleanDescription = (v: unknown): string => {
  if (v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be text');
  return v.slice(0, 2000);
};
const cleanPinned = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw badRequest('pinnedBoardIds must be a list of board ids');
  const ids = [...new Set(v as string[])];
  if (ids.length > PROJECT_MAX_PINNED_BOARDS) throw badRequest(`Pin at most ${PROJECT_MAX_PINNED_BOARDS} boards`);
  return ids;
};
const cleanParent = (v: unknown): string | null => {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw badRequest('parentId must be a project id or null');
  return v;
};

/** The workspace's projects by id (the chains above any of them). */
async function projectMap(workspaceId: string): Promise<Map<string, Project>> {
  return new Map((await repo.projectsIn([workspaceId])).map((p) => [p.id, p]));
}

/**
 * Who sees a project (and so may address it, and gets its boards through the team): someone who
 * gets through it and every project above it. A broken chain (a parent that isn't there) sees nobody.
 */
export function canSee(p: Project, role: WorkspaceRole | null, mine: ReadonlySet<string>, byId: ReadonlyMap<string, Project>): boolean {
  const chain = projectChain(p.id, byId.has(p.id) ? byId : new Map([...byId, [p.id, p]]));
  return !!chain && role !== null && chain.every((q) => passesProject(role, { access: q.access, member: mine.has(q.id) }));
}
export const canManage = (p: Project, role: WorkspaceRole | null, userId: string) => isManager(role) || (p.createdBy === userId && role !== null);

/** How many levels a project sits at (1: the top). */
const depthOf = (id: string, byId: ReadonlyMap<string, Project>) => projectChain(id, byId)?.length ?? PROJECT_MAX_DEPTH + 1;
/** The project and everything below it, the project first. */
function subtree(id: string, byId: ReadonlyMap<string, Project>): string[] {
  const out = [id];
  for (let i = 0; i < out.length && out.length <= byId.size; i++) for (const p of byId.values()) if (p.parentId === out[i] && !out.includes(p.id)) out.push(p.id);
  return out;
}
/** Levels below the project, counting itself (a project without sub-projects: 1). */
function heightOf(id: string, byId: ReadonlyMap<string, Project>, guard = 0): number {
  let h = 1;
  if (guard > PROJECT_MAX_DEPTH + 1) return h;
  for (const p of byId.values()) if (p.parentId === id) h = Math.max(h, 1 + heightOf(p.id, byId, guard + 1));
  return h;
}

const toSummary = (p: Project, role: WorkspaceRole | null, userId: string, pinned = false): ProjectSummary => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  access: p.access,
  teamAccess: p.teamAccess,
  createdBy: p.createdBy,
  canManage: canManage(p, role, userId),
  createdAt: p.createdAt,
  parentId: p.parentId,
  description: p.description,
  pinnedBoardIds: p.pinnedBoards,
  pinned,
});

/** The workspace's projects the user can see (guests: only those they were added to), sub-projects included. */
export async function listProjects(workspaceId: string, userId: string): Promise<ProjectSummary[]> {
  // Projects are content (#151): an admin who doesn't administer content sees them as a member.
  const { contentRole: role } = await requireWorkspace(workspaceId, userId, 'guest', { allowDeactivated: true });
  if ((await repo.getMember(workspaceId, userId))?.deactivatedAt != null) return []; // sees nothing in it
  const [byId, mine, pins] = await Promise.all([projectMap(workspaceId), repo.projectIdsOf(userId, [workspaceId]), repo.projectPinsOf(userId, [workspaceId])]);
  return [...byId.values()].filter((p) => canSee(p, role, mine, byId)).map((p) => toSummary(p, role, userId, pins.has(p.id)));
}

export async function createProject(
  workspaceId: string,
  userId: string,
  body: { name?: unknown; access?: unknown; teamAccess?: unknown; parentId?: unknown; description?: unknown },
): Promise<ProjectSummary> {
  const { contentRole: role } = await requireWorkspace(workspaceId, userId, 'member');
  const now = Date.now();
  const p: Project = {
    id: newId(12),
    workspaceId,
    name: cleanName(body.name),
    access: body.access === undefined ? 'workspace' : cleanAccess(body.access),
    teamAccess: body.teamAccess === undefined ? null : cleanTeamAccess(body.teamAccess),
    parentId: body.parentId === undefined ? null : cleanParent(body.parentId),
    description: body.description === undefined ? '' : cleanDescription(body.description),
    pinnedBoards: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await repo.transaction(async () => {
    if (p.parentId) {
      // The parent stays put (and undeleted) until the sub-project is in it.
      if (!(await repo.lockProject(p.parentId, 'share'))) throw notFound('Project not found');
      const { project: parent } = await visibleProject(p.parentId, userId);
      if (parent.workspaceId !== workspaceId) throw badRequest('That project belongs to another workspace');
      if (depthOf(parent.id, await projectMap(workspaceId)) >= PROJECT_MAX_DEPTH) throw badRequest(`Projects nest at most ${PROJECT_MAX_DEPTH} levels deep`);
    }
    if (!(await repo.insertProject(p))) throw notFound('Workspace not found');
  });
  await recordAuditQuietly({ action: 'project.created', workspaceId, actorId: userId, target: projectTarget(p), metadata: { access: p.access, parentId: p.parentId } });
  return toSummary(p, role, userId);
}

/** The project and the user's workspace role, if they can see it (404 otherwise: invisible = absent). */
async function visibleProject(projectId: string, userId: string): Promise<{ project: Project; role: WorkspaceRole; byId: Map<string, Project> }> {
  const project = await repo.getProject(projectId);
  const inWorkspace = project ? await repo.getMember(project.workspaceId, userId) : null;
  const role = inWorkspace && inWorkspace.deactivatedAt === null ? contentRole(inWorkspace.role, inWorkspace.adminScopes) : null; // deactivated: nothing
  if (!project || !role) throw notFound('Project not found');
  const [byId, mine] = await Promise.all([projectMap(project.workspaceId), repo.projectIdsOf(userId, [project.workspaceId])]);
  if (!canSee(project, role, mine, byId)) throw notFound('Project not found');
  return { project, role, byId };
}

const projectTarget = (p: { id: string; name: string }) => ({ type: 'project', id: p.id, label: p.name });

async function manageable(projectId: string, userId: string): Promise<{ project: Project; role: WorkspaceRole; byId: Map<string, Project> }> {
  const r = await visibleProject(projectId, userId);
  if (!canManage(r.project, r.role, userId)) throw forbidden('Only the project’s creator and workspace admins can change it');
  return r;
}

/** Re-checks everyone connected to the boards of the project and of every project below it. */
async function refreshProjectBoards(projectId: string, byId?: ReadonlyMap<string, Project>): Promise<void> {
  const p = byId ? null : await repo.getProject(projectId);
  const map: ReadonlyMap<string, Project> = byId ?? (p ? await projectMap(p.workspaceId) : new Map());
  for (const pid of map.has(projectId) ? subtree(projectId, map) : [projectId]) for (const id of await boardIdsInProject(pid)) await refreshBoardAccess(id);
}

/**
 * Rename, describe, pin boards on its page, open up / make private, set the project's own team
 * access level, or move it into another project (`parentId`; null: to the top). Changes that alter
 * who may do what on its boards re-check everyone connected to them (and to the boards of every
 * project below it), on every instance.
 */
export async function updateProject(
  projectId: string,
  userId: string,
  body: { name?: unknown; access?: unknown; teamAccess?: unknown; description?: unknown; pinnedBoardIds?: unknown; parentId?: unknown },
): Promise<ProjectSummary> {
  const { project, role } = await manageable(projectId, userId);
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    ...(body.access !== undefined ? { access: cleanAccess(body.access) } : {}),
    ...(body.teamAccess !== undefined ? { teamAccess: cleanTeamAccess(body.teamAccess) } : {}),
    ...(body.description !== undefined ? { description: cleanDescription(body.description) } : {}),
    ...(body.pinnedBoardIds !== undefined ? { pinnedBoards: cleanPinned(body.pinnedBoardIds) } : {}),
  };
  const moveTo = body.parentId === undefined ? undefined : cleanParent(body.parentId);
  const moving = moveTo !== undefined && moveTo !== project.parentId;
  await repo.transaction(async () => {
    if (moving) await checkMove(project, role, userId, moveTo);
    if (!(await repo.updateProject(projectId, { ...patch, ...(moving ? { parentId: moveTo } : {}) }, Date.now()))) throw notFound('Project not found');
  });
  await recordAuditQuietly({
    action: 'project.updated',
    workspaceId: project.workspaceId,
    actorId: userId,
    target: projectTarget({ ...project, ...patch }),
    metadata: {
      nameFrom: project.name,
      nameTo: patch.name ?? project.name,
      accessFrom: project.access,
      accessTo: patch.access ?? project.access,
      // The project's own team access level (null: the workspace's), KAI-93.
      teamAccessFrom: project.teamAccess,
      teamAccessTo: 'teamAccess' in patch ? (patch.teamAccess ?? null) : project.teamAccess,
      ...(moving ? { parentFrom: project.parentId, parentTo: moveTo } : {}),
    },
  });
  const accessChanged = moving || (patch.access && patch.access !== project.access) || ('teamAccess' in patch && patch.teamAccess !== project.teamAccess);
  if (accessChanged) await refreshProjectBoards(projectId);
  return toSummary({ ...project, ...patch, ...(moving ? { parentId: moveTo } : {}) }, role, userId, (await repo.projectPinsOf(userId, [project.workspaceId])).has(projectId));
}

/**
 * Inside the move's transaction, with both projects locked: may `userId` put `project` into
 * `to` (null: the top)? Leaving a parent can open the project's boards wider than the parent
 * allowed, so it needs someone who manages that parent too (or the workspace's content admins);
 * entering one only narrows them, so seeing it is enough. Never into itself or a project below
 * it, never deeper than PROJECT_MAX_DEPTH counting the projects it carries along.
 */
async function checkMove(project: Project, role: WorkspaceRole, userId: string, to: string | null): Promise<void> {
  if (!(await repo.lockProject(project.id, 'update'))) throw notFound('Project not found');
  if (to && !(await repo.lockProject(to, 'share'))) throw notFound('Project not found');
  const byId = await projectMap(project.workspaceId);
  const current = byId.get(project.id);
  if (!current) throw notFound('Project not found');
  if (current.parentId) {
    const parent = byId.get(current.parentId);
    if (parent && !canManage(parent, role, userId)) throw forbidden(`Only whoever manages “${parent.name}” can take a project out of it`);
  }
  if (!to) return;
  const target = byId.get(to);
  const mine = await repo.projectIdsOf(userId, [project.workspaceId]);
  if (!target || !canSee(target, role, mine, byId)) throw notFound('Project not found');
  const above = projectChain(to, byId);
  if (!above || above.some((p) => p.id === project.id)) throw badRequest('A project can’t go inside itself or one of its own sub-projects');
  if (above.length + heightOf(project.id, byId) > PROJECT_MAX_DEPTH) throw badRequest(`Projects nest at most ${PROJECT_MAX_DEPTH} levels deep`);
}

/**
 * Deletes a project. Its sub-projects must go first (409). Its boards: without `boards` the
 * project must be empty (409, as always); `parent` moves them into the parent project (the
 * workspace root at the top) — which the project's manager could do anyway by opening it up;
 * `trash` puts them in the trash, only when the caller owns each one or administers the
 * workspace's content. Under the project's row lock (which moving a board into it shares), so a
 * board can't slip into it meanwhile and end up visible to the whole workspace. Boards in the
 * trash move with `parent` too, so restoring one never lands it wider than the project it was in.
 */
export async function deleteProject(projectId: string, userId: string, opts: { boards?: unknown } = {}): Promise<void> {
  const { project, role } = await manageable(projectId, userId);
  const mode = opts.boards === undefined || opts.boards === '' ? null : opts.boards;
  if (mode !== null && mode !== 'parent' && mode !== 'trash') throw badRequest('boards must be parent or trash');
  if ((await repo.childProjectIds(projectId)).length > 0) throw new HttpError(409, 'This project has sub-projects. Move or delete them first.');
  if (mode === 'trash') {
    const live = await liveBoardsInProject(projectId);
    const others = live.filter((b) => b.ownerId !== userId);
    if (others.length && !isManager(role))
      throw forbidden(`${others.length} of its boards belong to other people. Move them to the parent project instead, or ask a workspace admin.`);
    for (const b of live) await trashBoardForProject(b.id, userId);
  }
  const moved = await repo.transaction(async () => {
    if (!(await repo.lockProject(projectId, 'update'))) throw notFound('Project not found');
    if (project.parentId && !(await repo.lockProject(project.parentId, 'share'))) throw notFound('Project not found');
    if ((await repo.childProjectIds(projectId)).length > 0) throw new HttpError(409, 'This project has sub-projects. Move or delete them first.');
    const n = await countLiveBoardsInProject(projectId);
    if (n > 0 && mode !== 'parent') throw new HttpError(409, `This project still has ${n} board${n === 1 ? '' : 's'}. Move them out first.`);
    const ids = await moveAllBoardsOfProject(projectId, project.parentId);
    await repo.deleteProject(projectId);
    await recordAudit({
      action: 'project.deleted',
      workspaceId: project.workspaceId,
      actorId: userId,
      target: projectTarget(project),
      metadata: { boards: mode ?? 'none', movedTo: ids.length ? project.parentId : null },
    });
    return ids;
  });
  for (const id of moved) await refreshBoardAccess(id);
}

/** Pins a project to the top of the person's sidebar, or unpins it (anyone who sees it; per person). */
export async function setProjectPinned(projectId: string, userId: string, pinned: boolean): Promise<void> {
  await visibleProject(projectId, userId);
  await repo.setProjectPin(userId, projectId, pinned, Date.now());
}

export async function listProjectMembers(projectId: string, userId: string) {
  await visibleProject(projectId, userId);
  const users = await getUsers(await repo.projectMemberIds(projectId));
  return [...users.values()].map((u) => ({ userId: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl }));
}

/**
 * Adds a workspace member (guests too) to a project; a private project's boards open up to them.
 * In a sub-project only someone who already gets through the projects above it (#129): anyone
 * else would get nothing from it, and the project's manager can't let them past a parent.
 */
export async function addProjectMember(projectId: string, actorId: string, targetId: string): Promise<void> {
  const { project, byId } = await manageable(projectId, actorId);
  const member = await repo.getMember(project.workspaceId, targetId);
  if (!member) throw badRequest('Add them to the workspace first');
  const parent = project.parentId ? byId.get(project.parentId) : undefined;
  if (parent) {
    const theirs = await repo.projectIdsOf(targetId, [project.workspaceId]);
    if (!canSee(parent, contentRole(member.role, member.adminScopes), theirs, byId)) throw badRequest(`Add them to “${parent.name}” first: this project is inside it`);
  }
  if (!(await repo.addProjectMember(projectId, targetId, Date.now()))) throw notFound('Project not found');
  await recordAuditQuietly({ action: 'project.member_added', workspaceId: project.workspaceId, actorId, target: projectTarget(project), metadata: { userId: targetId } });
  await refreshProjectBoards(projectId, byId);
}

// ---- projects shared with groups (#63) ----

/** The groups a project is shared with (anyone who sees the project). */
export async function listProjectGroups(projectId: string, userId: string): Promise<WorkspaceGroup[]> {
  const { project } = await visibleProject(projectId, userId);
  const ids = new Set(await repo.projectGroupIds(projectId));
  return (await repo.groupsIn(project.workspaceId)).filter((g) => ids.has(g.id));
}

/** Shares a project with a group of its workspace, or stops (who manages the project); its boards follow live. */
export async function setProjectGroup(projectId: string, actorId: string, groupId: string, shared: boolean): Promise<WorkspaceGroup[]> {
  const { project, byId } = await manageable(projectId, actorId);
  const group = await repo.getGroup(groupId);
  if (!group || group.workspaceId !== project.workspaceId) throw notFound('That group is not in this workspace');
  const changed = shared ? await repo.addProjectGroup(projectId, groupId, Date.now()) : await repo.removeProjectGroup(projectId, groupId);
  if (changed)
    await recordAuditQuietly({
      action: shared ? 'project.group_added' : 'project.group_removed',
      workspaceId: project.workspaceId,
      actorId,
      target: projectTarget(project),
      metadata: { groupId, group: group.name },
    });
  if (changed) await refreshProjectBoards(projectId, byId);
  return listProjectGroups(projectId, actorId);
}

export async function removeProjectMember(projectId: string, actorId: string, targetId: string): Promise<void> {
  const { project, byId } = actorId !== targetId ? await manageable(projectId, actorId) : await visibleProject(projectId, actorId);
  if (!(await repo.removeProjectMember(projectId, targetId))) throw notFound('That person is not in this project');
  await recordAuditQuietly({ action: 'project.member_removed', workspaceId: project.workspaceId, actorId, target: projectTarget(project), metadata: { userId: targetId } });
  await refreshProjectBoards(projectId, byId);
}

/** The boards of a project and of every project below it (#129): whose access a change to it re-resolves. */
export async function boardIdsUnderProject(projectId: string): Promise<string[]> {
  const p = await repo.getProject(projectId);
  if (!p) return boardIdsInProject(projectId);
  const byId = await projectMap(p.workspaceId);
  const out: string[] = [];
  for (const pid of subtree(projectId, byId)) out.push(...(await boardIdsInProject(pid)));
  return out;
}

/**
 * Inside the caller's transaction: checks a board of `workspaceId` may be put into the project by
 * `userId` (it exists in that workspace and they can see it), and holds the project's share lock
 * until the transaction ends (see deleteProject).
 */
export async function lockProjectForBoard(projectId: string, workspaceId: string, userId: string): Promise<{ name: string }> {
  if (!(await repo.lockProject(projectId, 'share'))) throw notFound('Project not found');
  const { project } = await visibleProject(projectId, userId);
  if (project.workspaceId !== workspaceId) throw badRequest('That project belongs to another workspace');
  return { name: project.name };
}

