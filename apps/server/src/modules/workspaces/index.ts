// Public API of modules/workspaces [S2]. Workspaces own who is in a team and what the team may do;
// boards ask here for what a workspace grants (boardAccess / boardAccessLoader) on every access
// decision, and for the policies that limit sharing and downloads.
import type { WorkspaceRole } from '@freero/shared';
import { requireWorkspace } from './service';
export {
  ensurePersonalWorkspace,
  boardAccess,
  boardAccessLoader,
  type BoardWorkspaceAccess,
  workspaceRolesOf,
  workspaceRole,
  getWorkspaceInfo,
  lockWorkspaceForNewBoard,
  teamWorkspaceIdsFor,
  teamMemberIds,
  handOverTeamWorkspaces,
  isManager,
} from './service';
export { lockProjectForBoard } from './projects';
// Managing a team (its routes use these; so may provisioning later, e.g. SCIM).
export { createTeamWorkspace, updateWorkspace, transferWorkspace, removeMember as removeWorkspaceMember } from './service';
export { inviteToWorkspace } from './invites';
export { mayDownload, mayShareExternally, isFullMember } from './roles';
// The organization's directory (SSO just-in-time sign-in, SCIM provisioning).
export {
  applyDirectoryMembership,
  removeDirectoryMember,
  projectOfWorkspace,
  setDirectoryProjectMembership,
  type DirectoryRole,
} from './directory';
// Retention / legal holds: a module that must keep a workspace's data registers a check (KAI-51).
export { onWorkspaceDeletionHold, type DeletionHoldCheck } from './holds';
// Data exports (modules/privacy).
export { exportMembershipsOf, exportWorkspaceDirectory, type MembershipExport, type WorkspaceDirectoryExport } from './dataExport';

/**
 * The team or personal workspace and the user's role there: 404 unless they are in it, 403 below
 * `min` (admin routes of other modules: SSO, provisioning, exports).
 */
export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'guest',
): Promise<{ id: string; name: string; kind: 'personal' | 'team'; role: WorkspaceRole }> {
  const { workspace, role } = await requireWorkspace(workspaceId, userId, min);
  return { id: workspace.id, name: workspace.name, kind: workspace.kind, role };
}
