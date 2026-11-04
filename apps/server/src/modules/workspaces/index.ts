// Public API of modules/workspaces [S2]. Workspaces own who is in a team and what the team may do;
// boards ask here for what a workspace grants (boardAccess / boardAccessLoader) on every access
// decision, and for the policies that limit sharing and downloads.
import type { AdminScope, WorkspaceKind, WorkspaceRole } from '@freero/shared';
import { requireWorkspace } from './service';
export {
  ensurePersonalWorkspace,
  boardAccess,
  boardAccessLoader,
  openToWholeTeam,
  type BoardWorkspaceAccess,
  workspaceRolesOf,
  workspaceRole,
  getWorkspaceInfo,
  lockWorkspaceForNewBoard,
  teamWorkspaceIdsFor,
  teamMemberIds,
  teamMembers,
  boardGatekeepers,
  handOverTeamWorkspaces,
  isManager,
} from './service';
export { lockProjectForBoard } from './projects';
// The object registry (modules/objects): workspaces and projects.
export { registerWorkspaceObjectTypes } from './objects';
// Someone left a workspace or changed role there (templates unshare what they shared with it).
export { onMembershipChanged, WORKSPACE_MEMBERSHIP_TOPIC, type MembershipChangedEvent } from './events';
// Managing a team (its routes use these; so may provisioning later, e.g. SCIM).
export { createTeamWorkspace, updateWorkspace, transferWorkspace, deleteWorkspace, removeMember as removeWorkspaceMember, changeRole as changeWorkspaceRole } from './service';
export { createProject, listProjects, projectFor } from './projects';
export { inviteToWorkspace } from './invites';
export { mayDownload, mayShareExternally, isFullMember, mayInvite as mayInviteToWorkspace } from './roles';
// User groups (#63): groups of a workspace; boards and projects shared with them.
export { groupOfWorkspace, setDirectoryGroupReader, createGroup, setGroupMember } from './groups';
export { setProjectGroup } from './projects';
// The organization's directory (SSO just-in-time sign-in, SCIM provisioning).
export {
  applyDirectoryMembership,
  setDirectoryDeactivated,
  isDeactivatedMember,
  projectOfWorkspace,
  setDirectoryProjectMembership,
  setDirectoryWorkspaceMembership,
  type DirectoryRole,
} from './directory';
// Retention / legal holds: a module that must keep a workspace's data registers a check (KAI-51).
export { onWorkspaceDeletionHold, type DeletionHoldCheck } from './holds';
// Who may create a team workspace: sso's domain control registers "Block other team workspaces" (#64).
export { onTeamWorkspaceCreation, type CreationCheck } from './creation';
// Data exports (modules/privacy).
export { exportMembershipsOf, exportWorkspaceDirectory, type MembershipExport, type WorkspaceDirectoryExport } from './dataExport';

/**
 * The team or personal workspace and the user's role there: 404 unless they are in it, 403 below
 * `min` (admin routes of other modules: SSO, provisioning, exports). An organisation's id answers
 * 404 unless `organisation: true` (the directory features: SSO, provisioning). `scope` (#151): the
 * admin scope the route needs (403 `admin_scope_required` for an admin without it).
 */
export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'guest',
  opts: { organisation?: boolean; scope?: AdminScope } = {},
): Promise<{ id: string; name: string; kind: WorkspaceKind; role: WorkspaceRole }> {
  const { workspace, role } = await requireWorkspace(workspaceId, userId, min, opts);
  return { id: workspace.id, name: workspace.name, kind: workspace.kind, role };
}
// Classification labels (#158): what a board in a workspace may carry, and what new boards get.
export { availableLabels as labelsAvailableIn, labelRequirement, listLabels, createLabel, updateLabel, deleteLabel, setLabelPolicy } from './labels';
// Organisations above team workspaces (#108): audit's fan-out to an organisation's log, the
// workspaces an organisation's directory may grant (SCIM groups), and the organisation itself.
export { organisationsOfWorkspaces, attachedWorkspaceIds } from './service';
export { createOrganisation, attachWorkspace, detachWorkspace, requireOrganisation, addOrganisationMember } from './organisations';
// The admin console (modules/admin): the role check, members, security / retention settings.
export {
  requireWorkspace,
  // #159: a workspace key's state changed (modules/keys): everyone connected to its boards re-checked.
  refreshWorkspaceBoards,
  requireScope,
  listMembers as listWorkspaceMembers,
  setMemberDeactivated,
  getSettings as getWorkspaceSettings,
  updateSettings as updateWorkspaceSettings,
  workspaceAdminFacts,
} from './service';
// Policies other modules enforce (KAI-51): auth (sessions, two-step), boards (trash), realtime
// (version history), audit (its retention and which workspaces see an account's own events).
export { sessionLimitsFor, allSessionLimits, twoFactorRequirementOf, retentionOverrides, auditScopeOf } from './service';
// Retention of inactive boards (#154, boards' job): each workspace's rule as it applies, and holds.
export { inactiveBoardRules, workspaceHoldOn } from './service';
// Company templates (#155): who may share or publish templates.
export { templatePublishingOf } from './service';
// Usage trends (#65, modules/admin's rollup).
export { allTeamWorkspaceIds } from './service';
// IP allowlists (#156): apiauth checks a credential's requests per workspace (its exemption decides).
export { ipAllowedIn, hasIpAllowlist, setIpExemptionReader } from './service';
