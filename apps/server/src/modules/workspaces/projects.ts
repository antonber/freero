// Projects: folders of boards inside a workspace. An open project ('workspace') is seen by every
// member; a private one only by its members and the workspace's owners/admins — and so are the
// boards in it (roles.ts teamRole). Its creator and the workspace's owners/admins manage it.
import type { ProjectAccess, ProjectSummary, TeamAccess, WorkspaceRole } from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { getUsers } from '../auth/index';
import { boardIdsInProject, countLiveBoardsInProject } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Project } from './repo';
import { isFullMember, isManager, isTeamAccess } from './roles';
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

const canSee = (p: Project, role: WorkspaceRole | null, member: boolean) => member || isManager(role) || (p.access === 'workspace' && isFullMember(role));
const canManage = (p: Project, role: WorkspaceRole | null, userId: string) => isManager(role) || (p.createdBy === userId && role !== null);

const toSummary = (p: Project, role: WorkspaceRole | null, userId: string): ProjectSummary => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  access: p.access,
  teamAccess: p.teamAccess,
  createdBy: p.createdBy,
  canManage: canManage(p, role, userId),
  createdAt: p.createdAt,
});

/** The workspace's projects the user can see (guests: only those they were added to). */
export async function listProjects(workspaceId: string, userId: string): Promise<ProjectSummary[]> {
  const { role } = await requireWorkspace(workspaceId, userId);
  const [projects, mine] = await Promise.all([repo.projectsIn([workspaceId]), repo.projectIdsOf(userId, [workspaceId])]);
  return projects.filter((p) => canSee(p, role, mine.has(p.id))).map((p) => toSummary(p, role, userId));
}

export async function createProject(
  workspaceId: string,
  userId: string,
  body: { name?: unknown; access?: unknown; teamAccess?: unknown },
): Promise<ProjectSummary> {
  const { role } = await requireWorkspace(workspaceId, userId, 'member');
  const now = Date.now();
  const p: Project = {
    id: newId(12),
    workspaceId,
    name: cleanName(body.name),
    access: body.access === undefined ? 'workspace' : cleanAccess(body.access),
    teamAccess: body.teamAccess === undefined ? null : cleanTeamAccess(body.teamAccess),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  if (!(await repo.insertProject(p))) throw notFound('Workspace not found');
  return toSummary(p, role, userId);
}

/** The project and the user's workspace role, if they can see it (404 otherwise: invisible = absent). */
async function visibleProject(projectId: string, userId: string): Promise<{ project: Project; role: WorkspaceRole }> {
  const project = await repo.getProject(projectId);
  const role = project ? await repo.getRole(project.workspaceId, userId) : null;
  if (!project || !role) throw notFound('Project not found');
  const member = (await repo.projectIdsOf(userId, [project.workspaceId])).has(project.id);
  if (!canSee(project, role, member)) throw notFound('Project not found');
  return { project, role };
}

async function manageable(projectId: string, userId: string): Promise<{ project: Project; role: WorkspaceRole }> {
  const r = await visibleProject(projectId, userId);
  if (!canManage(r.project, r.role, userId)) throw forbidden('Only the project’s creator and workspace admins can change it');
  return r;
}

async function refreshProjectBoards(projectId: string): Promise<void> {
  for (const id of await boardIdsInProject(projectId)) await refreshBoardAccess(id);
}

/**
 * Rename, open up / make private, or set the project's own team access level. Changes that alter
 * who may do what on its boards re-check everyone connected to them, on every instance.
 */
export async function updateProject(
  projectId: string,
  userId: string,
  body: { name?: unknown; access?: unknown; teamAccess?: unknown },
): Promise<ProjectSummary> {
  const { project, role } = await manageable(projectId, userId);
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    ...(body.access !== undefined ? { access: cleanAccess(body.access) } : {}),
    ...(body.teamAccess !== undefined ? { teamAccess: cleanTeamAccess(body.teamAccess) } : {}),
  };
  if (!(await repo.updateProject(projectId, patch, Date.now()))) throw notFound('Project not found');
  const accessChanged = (patch.access && patch.access !== project.access) || ('teamAccess' in patch && patch.teamAccess !== project.teamAccess);
  if (accessChanged) await refreshProjectBoards(projectId);
  return toSummary({ ...project, ...patch }, role, userId);
}

/**
 * Deletes an empty project. Under the project's row lock (which moving a board into it shares), so
 * a board can't slip into it meanwhile and end up visible to the whole workspace.
 */
export async function deleteProject(projectId: string, userId: string): Promise<void> {
  await manageable(projectId, userId);
  await repo.transaction(async () => {
    if (!(await repo.lockProject(projectId, 'update'))) throw notFound('Project not found');
    const n = await countLiveBoardsInProject(projectId);
    if (n > 0) throw new HttpError(409, `This project still has ${n} board${n === 1 ? '' : 's'}. Move them out first.`);
    await repo.deleteProject(projectId);
  });
}

export async function listProjectMembers(projectId: string, userId: string) {
  await visibleProject(projectId, userId);
  const users = await getUsers(await repo.projectMemberIds(projectId));
  return [...users.values()].map((u) => ({ userId: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl }));
}

/** Adds a workspace member (guests too) to a project; a private project's boards open up to them. */
export async function addProjectMember(projectId: string, actorId: string, targetId: string): Promise<void> {
  const { project } = await manageable(projectId, actorId);
  if (!(await repo.getRole(project.workspaceId, targetId))) throw badRequest('Add them to the workspace first');
  if (!(await repo.addProjectMember(projectId, targetId, Date.now()))) throw notFound('Project not found');
  await refreshProjectBoards(projectId);
}

export async function removeProjectMember(projectId: string, actorId: string, targetId: string): Promise<void> {
  if (actorId !== targetId) await manageable(projectId, actorId);
  else await visibleProject(projectId, actorId);
  if (!(await repo.removeProjectMember(projectId, targetId))) throw notFound('That person is not in this project');
  await refreshProjectBoards(projectId);
}

/**
 * Inside the caller's transaction: checks a board of `workspaceId` may be put into the project by
 * `userId` (it exists in that workspace and they can see it), and holds the project's share lock
 * until the transaction ends (see deleteProject).
 */
export async function lockProjectForBoard(projectId: string, workspaceId: string, userId: string): Promise<void> {
  if (!(await repo.lockProject(projectId, 'share'))) throw notFound('Project not found');
  const { project } = await visibleProject(projectId, userId);
  if (project.workspaceId !== workspaceId) throw badRequest('That project belongs to another workspace');
}
