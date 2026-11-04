// Membership changes made by the organization's directory rather than by a person in the app:
// single sign-on's just-in-time provisioning and SCIM (modules/sso, modules/scim). Same rules and
// locks as the member routes (service.ts). Deprovisioning is the admin console's deactivation (one
// mechanism: `deactivated_at`, the `blocked` rule in members' resolveRole): the person keeps role
// and boards but opens nothing in the workspace, live on every instance, until reactivated. The
// directory never changes an owner's role, and never deactivates the last active owner.
import type { WorkspaceRole } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { recordAudit } from '../audit/index';
import { getUser } from '../auth/index';
import { boardIdsUnderProject } from './projects';
import { refreshBoardAccess } from '../realtime/index';
import { membershipChanged, recordMembershipChange } from './events';
import * as repo from './repo';
import { refreshWorkspaceBoards, removeMemberByDirectory } from './service';

export type DirectoryRole = Exclude<WorkspaceRole, 'owner'>;

const lastOwner = () => new HttpError(409, 'A workspace needs at least one active owner. Make someone else an owner in Freero first.');

/**
 * Makes `userId` a member of the team workspace with `role` (added if absent). With
 * `overwrite: false` an existing member keeps their role (SSO just-in-time sign-in); with true the
 * directory's role wins (SCIM group mapping) — except for owners. `onJoined` runs inside the same
 * transaction when the person was added (the caller's audit event). Returns the role they have now.
 */
export async function applyDirectoryMembership(
  workspaceId: string,
  userId: string,
  role: DirectoryRole,
  { overwrite, onJoined }: { overwrite: boolean; onJoined?: (role: WorkspaceRole) => Promise<void> },
): Promise<WorkspaceRole> {
  const result = await repo.transaction(async () => {
    const ws = await repo.lockWorkspace(workspaceId, 'update');
    if (!ws) throw notFound('Workspace not found');
    const current = await repo.getRole(workspaceId, userId);
    if (current === null) {
      const now = await repo.addMemberIfAbsent(workspaceId, userId, role, Date.now());
      if (!now) throw notFound('Workspace not found');
      await onJoined?.(now);
      return { role: now, changed: true };
    }
    if (!overwrite || current === 'owner' || current === role) return { role: current, changed: false };
    await repo.setRole(workspaceId, userId, role);
    await recordMembershipChange(workspaceId, userId);
    return { role, changed: true };
  });
  if (result.changed) await refreshWorkspaceBoards(workspaceId);
  return result.role;
}

/**
 * The directory deprovisions (true) or reprovisions (false) someone: the admin console's
 * deactivation, done by the directory. `record(changed)` runs inside the same transaction (the
 * caller's audit event). Their sockets on the workspace's boards are re-resolved on every
 * instance. False when they are not a member or nothing changed.
 */
export async function setDirectoryDeactivated(
  workspaceId: string,
  userId: string,
  deactivated: boolean,
  record: () => Promise<void>,
): Promise<boolean> {
  const changed = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return false;
    const m = await repo.getMember(workspaceId, userId);
    if (!m || (m.deactivatedAt !== null) === deactivated) return false;
    if (deactivated && (await repo.isLastActiveOwner(workspaceId, userId))) throw lastOwner();
    await repo.setDeactivated(workspaceId, userId, deactivated ? Date.now() : null);
    await record();
    return true;
  });
  if (changed) await refreshWorkspaceBoards(workspaceId);
  return changed;
}

const RANK: Record<WorkspaceRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

/**
 * An organisation's directory grants (role) or withdraws (null) membership of one of ITS team
 * workspaces (#108: SCIM groups mapped to the workspace). A grant adds the person or raises their
 * role, never lowers it and never touches an owner; a withdrawal removes them unless they own it.
 * Nothing happens for a workspace that is not attached to `organisationId`. Recorded in the
 * workspace's log (and so the organisation's), with the directory as actor.
 */
export async function setDirectoryWorkspaceMembership(organisationId: string, workspaceId: string, userId: string, role: DirectoryRole | null): Promise<void> {
  const ws = await repo.getWorkspace(workspaceId);
  if (!ws || ws.kind !== 'team' || ws.organisation?.id !== organisationId) return;
  const metadata = { via: 'scim', organisationId };
  if (role === null) {
    await removeMemberByDirectory(workspaceId, userId, metadata);
    return;
  }
  const before = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return 'none' as const;
    const b = await repo.getRole(workspaceId, userId);
    if (b !== null && RANK[b] >= RANK[role]) return 'none' as const;
    if (!(await repo.grantAtLeast(workspaceId, userId, role, Date.now()))) return 'none' as const;
    if (b !== null) await recordMembershipChange(workspaceId, userId);
    const target = { type: 'user', id: userId, label: (await getUser(userId))?.email ?? null };
    await recordAudit(
      b === null
        ? { action: 'member.joined', workspaceId, actorId: null, target, metadata: { ...metadata, role } }
        : { action: 'member.role_changed', workspaceId, actorId: null, target, metadata: { ...metadata, from: b, to: role } },
    );
    return b;
  });
  if (before === 'none') return;
  await refreshWorkspaceBoards(workspaceId);
  if (before !== null) await membershipChanged({ workspaceId, userId, role });
}

/** Whether the person is a deactivated member of the workspace (SSO won't let them in there). */
export async function isDeactivatedMember(workspaceId: string, userId: string): Promise<boolean> {
  return ((await repo.getMember(workspaceId, userId))?.deactivatedAt ?? null) !== null;
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
  if (changed) for (const id of await boardIdsUnderProject(projectId)) await refreshBoardAccess(id);
}
