// Public API of modules/workspaces [S2]. Workspaces own who is in a team and what the team may do;
// boards ask here for what a workspace grants (boardAccess / boardAccessLoader) on every access
// decision, and for the policies that limit sharing and downloads.
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
export { createTeamWorkspace, updateWorkspace, removeMember as removeWorkspaceMember } from './service';
export { inviteToWorkspace } from './invites';
export { mayDownload, mayShareExternally, isFullMember } from './roles';
// The admin console (modules/admin): the role check, members, security / retention settings.
export {
  requireWorkspace,
  listMembers as listWorkspaceMembers,
  setMemberDeactivated,
  getSettings as getWorkspaceSettings,
  updateSettings as updateWorkspaceSettings,
  workspaceAdminFacts,
} from './service';
// Policies other modules enforce (KAI-51): auth (sessions, two-step), boards (trash), realtime
// (version history), audit (its retention and which workspaces see an account's own events).
export { sessionLimitsFor, allSessionLimits, twoFactorRequirementOf, retentionOverrides, auditScopeOf } from './service';
