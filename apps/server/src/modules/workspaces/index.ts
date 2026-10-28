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
  teamMembers,
  boardGatekeepers,
  handOverTeamWorkspaces,
  isManager,
} from './service';
export { lockProjectForBoard } from './projects';
// Someone left a workspace or changed role there (templates unshare what they shared with it).
export { onMembershipChanged, type MembershipChangedEvent } from './events';
// Managing a team (its routes use these; so may provisioning later, e.g. SCIM).
export { createTeamWorkspace, updateWorkspace, removeMember as removeWorkspaceMember } from './service';
export { createProject } from './projects';
export { inviteToWorkspace } from './invites';
export { mayDownload, mayShareExternally, isFullMember } from './roles';
