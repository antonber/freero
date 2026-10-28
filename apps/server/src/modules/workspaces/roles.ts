// Pure workspace rules: roles, what a workspace grants on its boards, and the sharing policies.
import type { LinkAccess, ProjectAccess, Role, TeamAccess, WorkspacePolicies, WorkspaceRole } from '@freero/shared';

export const WORKSPACE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];
export const INVITABLE_WORKSPACE_ROLES = ['admin', 'member', 'guest'] as const;
export type InvitableWorkspaceRole = (typeof INVITABLE_WORKSPACE_ROLES)[number];

export const isWorkspaceRole = (v: unknown): v is WorkspaceRole => (WORKSPACE_ROLES as unknown[]).includes(v);
export const isInvitableWorkspaceRole = (v: unknown): v is InvitableWorkspaceRole =>
  (INVITABLE_WORKSPACE_ROLES as readonly unknown[]).includes(v);

/** Owners and admins manage the workspace (members, projects, policies). */
export const isManager = (r: WorkspaceRole | null): boolean => r === 'owner' || r === 'admin';
/** Everyone but guests: creates boards, sees the boards shared with the whole workspace. */
export const isFullMember = (r: WorkspaceRole | null): boolean => r !== null && r !== 'guest';

/** What owners/admins get on every board of their workspace (they administer the content). */
export const MANAGER_BOARD_ROLE: Role = 'editor';
export const TEAM_ACCESS_VALUES: TeamAccess[] = ['editor', 'commenter', 'viewer'];
export const isTeamAccess = (v: unknown): v is TeamAccess => (TEAM_ACCESS_VALUES as unknown[]).includes(v);

export const DEFAULT_POLICIES: WorkspacePolicies = {
  externalSharing: 'anyone',
  linkSharing: 'editor',
  guestInvites: 'admins',
  downloads: 'anyone',
  teamAccess: 'editor',
  publicLinks: 'anyone',
};

/** The team access level of a board: its project's own level, else the workspace's. */
export function teamAccessOf(policies: WorkspacePolicies, project: { teamAccess: TeamAccess | null } | null): TeamAccess {
  return project?.teamAccess ?? policies.teamAccess;
}

const LINK_RANK: Record<LinkAccess, number> = { none: 0, viewer: 1, commenter: 2, editor: 3 };
export const LINK_VALUES = Object.keys(LINK_RANK) as LinkAccess[];

/** The lower of a board's link access and the workspace's maximum. */
export function capLink(link: LinkAccess, max: LinkAccess): LinkAccess {
  return LINK_RANK[link] <= LINK_RANK[max] ? link : max;
}

/**
 * What the workspace itself grants `role` on one of its boards (team access), or null.
 * - owners/admins: edit every board, private projects included (they administer the content);
 * - a private project's boards: only its members;
 * - other boards: every full member; a guest only if added to the board's project.
 * Everyone but owners/admins gets `level`, the board's team access level (`teamAccessOf`).
 * Direct board memberships and link access come on top of this (members/roles.ts).
 */
export function teamRole(
  role: WorkspaceRole | null,
  project: { access: ProjectAccess; member: boolean } | null,
  level: TeamAccess,
): Role | null {
  if (!role) return null;
  if (isManager(role)) return MANAGER_BOARD_ROLE;
  if (project?.access === 'private') return project.member ? level : null;
  if (role === 'guest') return project?.member ? level : null;
  return level;
}

/** The "downloads" policy: may this person export / download / duplicate the workspace's boards? */
export function mayDownload(role: WorkspaceRole | null, p: WorkspacePolicies): boolean {
  if (p.downloads === 'anyone') return true;
  if (p.downloads === 'members') return isFullMember(role);
  return isManager(role);
}

/** The "external sharing" policy: may this person give someone outside the workspace access? */
export function mayShareExternally(role: WorkspaceRole | null, p: WorkspacePolicies): boolean {
  if (p.externalSharing === 'anyone') return true;
  if (p.externalSharing === 'admins') return isManager(role);
  return false;
}

/**
 * May `actor` invite someone into the workspace with `role`? Owners invite admins, members and
 * guests; admins members and guests (like `mayChangeRole`); members only guests, and only when
 * the "guest invites" policy says so.
 */
export function mayInvite(actor: WorkspaceRole | null, role: InvitableWorkspaceRole, p: WorkspacePolicies): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return role !== 'admin';
  return actor === 'member' && role === 'guest' && p.guestInvites === 'members';
}

/**
 * May `actor` change `target`'s role from `from` to `to`? Owners change anything (the last-owner
 * rule is checked separately, under a lock); admins only move people among member/guest.
 */
export function mayChangeRole(actor: WorkspaceRole | null, from: WorkspaceRole, to: WorkspaceRole): boolean {
  if (actor === 'owner') return true;
  if (actor !== 'admin') return false;
  return (from === 'member' || from === 'guest') && (to === 'member' || to === 'guest');
}

/** May `actor` remove a member whose role is `target` (removing yourself = leaving is always allowed)? */
export function mayRemove(actor: WorkspaceRole | null, target: WorkspaceRole): boolean {
  if (actor === 'owner') return true;
  return actor === 'admin' && (target === 'member' || target === 'guest');
}
