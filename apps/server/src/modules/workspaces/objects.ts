// Workspaces and projects as objects of the registry (modules/objects, KAI-147). A workspace is
// seen by its members (guests too) and managed by its owners/admins; a deactivated member sees
// nothing in it. A project is seen as the project list shows it (projects.ts canSee) and managed
// by its creator and the workspace's managers (canManage).
import { isGuestId, objectKey, type ObjectAction, type ObjectRef, type WorkspaceRole } from '@freero/shared';
import { registerObjectType, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import { canManage, canSee } from './projects';
import * as repo from './repo';
import { isFullMember, isManager } from './roles';

const workspaceAction = (role: WorkspaceRole): ObjectAction => (isManager(role) ? 'manage' : isFullMember(role) ? 'edit' : 'view');

/** The actor's workspace roles where they are not deactivated. */
async function activeRoles(userId: string): Promise<Map<string, WorkspaceRole>> {
  if (isGuestId(userId)) return new Map();
  const [roles, deactivated] = await Promise.all([repo.rolesOf(userId), repo.deactivatedIn(userId)]);
  for (const id of deactivated) roles.delete(id);
  return roles;
}

export const workspaceObjects: ObjectTypeHandler = {
  type: 'workspace',
  async lookup(actor, refs) {
    const out = new Map<string, ObjectLookup>();
    const roles = await activeRoles(actor.userId);
    const ids = refs.map((r) => r.id).filter((id) => roles.has(id));
    for (const w of await repo.getWorkspaces(ids)) {
      const access = workspaceAction(roles.get(w.id)!);
      out.set(objectKey({ type: 'workspace', id: w.id }), { access, summary: { type: 'workspace', title: w.name, path: null, access } });
    }
    return out;
  },
};

export const projectObjects: ObjectTypeHandler = {
  type: 'project',
  async lookup(actor, refs) {
    const out = new Map<string, ObjectLookup>();
    const roles = await activeRoles(actor.userId);
    if (!roles.size) return out;
    const ids = refs.filter((r): r is Extract<ObjectRef, { type: 'project' }> => r.type === 'project').map((r) => r.id);
    const projects = (await repo.getProjects(ids)).filter((p) => roles.has(p.workspaceId));
    if (!projects.length) return out;
    const mine = await repo.projectIdsOf(actor.userId, [...new Set(projects.map((p) => p.workspaceId))]);
    for (const p of projects) {
      const role = roles.get(p.workspaceId) ?? null;
      if (!canSee(p, role, mine.has(p.id))) continue;
      const access: ObjectAction = canManage(p, role, actor.userId) ? 'manage' : 'view';
      out.set(objectKey({ type: 'project', id: p.id }), { access, summary: { type: 'project', title: p.name, path: null, access } });
    }
    return out;
  },
};

/** Workspaces and projects join the object registry (init.ts; tests call it too). */
export function registerWorkspaceObjectTypes(): void {
  registerObjectType(workspaceObjects);
  registerObjectType(projectObjects);
}
