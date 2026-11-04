// Projects through the public API (#129, #161): a workspace's projects as the caller sees them,
// nested (`parentId`), and a project made from a blueprint. The same rules as the app (projects
// the caller can't see are left out), behind the team's API switch.
import { notFound } from '../../platform/http';
import { useInWorkspace } from '../apiauth/index';
import { listProjects, workspaceRolesOf } from '../workspaces/index';
import { withNotice, type ApiCall } from './service';

async function inWorkspace(call: ApiCall, workspaceId: string): Promise<void> {
  if (!(await workspaceRolesOf(call.userId)).has(workspaceId)) throw notFound('Workspace not found');
  await useInWorkspace(call.cred, workspaceId);
  call.audit.workspaceId = workspaceId;
}

/** GET /workspaces/:workspaceId/projects — every project the caller can see there, sub-projects included. */
export async function listProjectsFor(call: ApiCall, workspaceId: string) {
  await inWorkspace(call, workspaceId);
  const projects = await listProjects(workspaceId, call.userId);
  return withNotice({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      parentId: p.parentId ?? null,
      description: p.description ?? '',
      access: p.access,
      teamAccess: p.teamAccess,
      createdAt: new Date(p.createdAt).toISOString(),
    })),
  });
}
