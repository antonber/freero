// Projects through the public API (#129, #161): a workspace's projects as the caller sees them,
// nested (`parentId`), new projects — empty or made from a blueprint — and the blueprints the
// caller can use. The same rules as the app (projects the caller can't see are left out; a
// blueprint is used in one transaction), behind the team's API switch.
import type { ProjectSummary } from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { useInWorkspace } from '../apiauth/index';
import { listBlueprints, useBlueprint } from '../blueprints/index';
import { createProject, listProjects, workspaceRolesOf } from '../workspaces/index';
import { appUrl } from '../../platform/mail';
import { agentWrite, withNotice, type ApiCall } from './service';

async function inWorkspace(call: ApiCall, workspaceId: string): Promise<void> {
  if (!(await workspaceRolesOf(call.userId)).has(workspaceId)) throw notFound('Workspace not found');
  await useInWorkspace(call.cred, workspaceId);
  call.audit.workspaceId = workspaceId;
}

const apiProject = (p: ProjectSummary) => ({
  id: p.id,
  name: p.name,
  parentId: p.parentId ?? null,
  description: p.description ?? '',
  access: p.access,
  teamAccess: p.teamAccess,
  createdAt: new Date(p.createdAt).toISOString(),
});

/** GET /workspaces/:workspaceId/projects — every project the caller can see there, sub-projects included. */
export async function listProjectsFor(call: ApiCall, workspaceId: string) {
  await inWorkspace(call, workspaceId);
  return withNotice({ projects: (await listProjects(workspaceId, call.userId)).map(apiProject) });
}

/**
 * POST /workspaces/:workspaceId/projects — a new project (`name`, `parentId`, `access`), or with
 * `blueprintId` one made from that blueprint: the project and a copy of each of its boards and docs.
 */
export async function createProjectFor(call: ApiCall, workspaceId: string, body: Record<string, unknown>) {
  await inWorkspace(call, workspaceId);
  await consumeRateLimit('boardCreate', `user:${call.userId}`);
  await agentWrite(call);
  if (body.blueprintId !== undefined) {
    if (typeof body.blueprintId !== 'string' || !body.blueprintId) throw badRequest('blueprintId must be a blueprint id');
    const made = await useBlueprint(body.blueprintId, call.userId, { workspaceId, name: body.name, parentId: body.parentId });
    call.audit.target = { type: 'project', id: made.project.id, label: made.project.name };
    return { project: apiProject(made.project), boards: made.boards.map((b) => ({ ...b, url: appUrl(call.req, `/${b.kind === 'doc' ? 'doc' : 'board'}/${encodeURIComponent(b.id)}`) })) };
  }
  const project = await createProject(workspaceId, call.userId, { name: body.name, access: body.access, parentId: body.parentId, description: body.description });
  call.audit.target = { type: 'project', id: project.id, label: project.name };
  return { project: apiProject(project), boards: [] };
}

/** GET /blueprints — the blueprints the caller can use: theirs and those shared with their teams. */
export async function listBlueprintsFor(call: ApiCall) {
  const all = await listBlueprints(call.userId);
  return withNotice({
    blueprints: all.map((b) => ({ id: b.id, name: b.name, description: b.description, steps: b.steps, items: b.items, workspaceId: b.workspaceId, ownerName: b.ownerName })),
  });
}
