// Membership changes made by the organization's directory rather than by a person in the app:
// single sign-on's just-in-time provisioning and SCIM (modules/sso, modules/scim). Same rules and
// locks as the member routes (service.ts): a workspace always keeps an owner, someone removed
// loses its boards live on every instance, and their boards stay with the team. The directory
// never changes an owner's role: owners are managed in Freero (the break-glass seat).
import type { WorkspaceRole } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { boardIdsInProject, boardIdsInWorkspace, transferBoardsOwnedIn } from '../boards/index';
import { removeBoardMemberships } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import { refreshWorkspaceBoards } from './service';

export type DirectoryRole = Exclude<WorkspaceRole, 'owner'>;

const lastOwner = () => new HttpError(409, 'A workspace needs at least one owner. Make someone else an owner in Freero first.');

/**
 * Makes `userId` a member of the team workspace with `role` (added if absent). With
 * `overwrite: false` an existing member keeps their role (SSO just-in-time sign-in); with true the
 * directory's role wins (SCIM group mapping) — except for owners. Returns the role they have now.
 */
export async function applyDirectoryMembership(
  workspaceId: string,
  userId: string,
  role: DirectoryRole,
  { overwrite }: { overwrite: boolean },
): Promise<WorkspaceRole> {
  const result = await repo.transaction(async () => {
    const ws = await repo.lockWorkspace(workspaceId, 'update');
    if (!ws) throw notFound('Workspace not found');
    const current = await repo.getRole(workspaceId, userId);
    if (current === null) {
      const now = await repo.addMemberIfAbsent(workspaceId, userId, role, Date.now());
      if (!now) throw notFound('Workspace not found');
      return { role: now, changed: true };
    }
    if (!overwrite || current === 'owner' || current === role) return { role: current, changed: false };
    await repo.setRole(workspaceId, userId, role);
    return { role, changed: true };
  });
  if (result.changed) await refreshWorkspaceBoards(workspaceId);
  return result.role;
}

/**
 * The directory deprovisioned someone: they leave the workspace (and its projects), their direct
 * invitations to its boards end, boards they owned there pass to the longest-standing owner, and
 * their sockets on its boards close on every instance. The last owner can't be removed this way.
 * False when they were not a member.
 */
export async function removeDirectoryMember(workspaceId: string, userId: string): Promise<boolean> {
  const removed = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return false;
    const role = await repo.getRole(workspaceId, userId);
    if (!role) return false;
    const members = await repo.listMembers(workspaceId);
    const heir = members.find((m) => m.role === 'owner' && m.userId !== userId);
    if (!heir) throw lastOwner();
    await repo.removeMember(workspaceId, userId);
    await transferBoardsOwnedIn(workspaceId, userId, heir.userId);
    await removeBoardMemberships(await boardIdsInWorkspace(workspaceId), userId);
    return true;
  });
  if (removed) await refreshWorkspaceBoards(workspaceId);
  return removed;
}

/** The project, if it belongs to the workspace. */
export async function projectOfWorkspace(projectId: string, workspaceId: string): Promise<{ id: string; name: string } | null> {
  const p = await repo.getProject(projectId);
  return p && p.workspaceId === workspaceId ? { id: p.id, name: p.name } : null;
}

/** Adds or removes a workspace member from a project (a directory group mapped to it); boards follow live. */
export async function setDirectoryProjectMembership(projectId: string, userId: string, member: boolean): Promise<void> {
  const project = await repo.getProject(projectId);
  if (!project) return;
  const changed = member
    ? (await repo.getRole(project.workspaceId, userId)) !== null && (await repo.addProjectMember(projectId, userId, Date.now()))
    : await repo.removeProjectMember(projectId, userId);
  if (changed) for (const id of await boardIdsInProject(projectId)) await refreshBoardAccess(id);
}
