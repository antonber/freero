// Pure workspace rules: roles, what a workspace grants on its boards, and the sharing policies.
import { looserPolicy, POLICY_STRICTNESS } from '@freero/shared';
import type {
  LinkAccess,
  OrganisationPolicyKey,
  OrganisationSecurityKey,
  ProjectAccess,
  Role,
  TeamAccess,
  WorkspacePolicies,
  WorkspaceRole,
  WorkspaceSettings,
} from '@freero/shared';

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
  liveEmbeds: 'on',
  boardEmbeds: 'on',
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

// ---- organisation floors (#108) ----

// The order of every floored policy, loosest to strictest, is POLICY_STRICTNESS in @freero/shared.
export { looserPolicy };
export const FLOOR_POLICY_KEYS = Object.keys(POLICY_STRICTNESS) as OrganisationPolicyKey[];
export const FLOOR_SETTING_KEYS: OrganisationSecurityKey[] = ['requireTwoFactor', 'sessionMaxHours', 'sessionIdleMinutes'];
export type PolicyFloor = Pick<WorkspacePolicies, OrganisationPolicyKey>;
export type SettingsFloor = Pick<WorkspaceSettings, OrganisationSecurityKey>;

/** What a new organisation starts with: the loosest value of every key, i.e. no floor at all. */
export const NO_FLOOR_POLICIES = Object.fromEntries(FLOOR_POLICY_KEYS.map((k) => [k, POLICY_STRICTNESS[k][0]])) as PolicyFloor;

/** A workspace's own policies raised to its organisation's floors, key by key (the effective policies). */
export function strictestPolicies(own: WorkspacePolicies, floor: PolicyFloor | null): WorkspacePolicies {
  if (!floor) return own;
  const out: Record<string, unknown> = { ...own };
  for (const k of FLOOR_POLICY_KEYS) if (looserPolicy(k, own[k], floor[k])) out[k] = floor[k];
  return out as unknown as WorkspacePolicies;
}

/** The shorter of two optional limits (null: no limit). */
const shorter = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

/** A workspace's own security settings raised to its organisation's floors (retention stays the workspace's own). */
export function strictestSettings(own: WorkspaceSettings, floor: SettingsFloor | null): WorkspaceSettings {
  if (!floor) return own;
  return {
    ...own,
    requireTwoFactor: own.requireTwoFactor || floor.requireTwoFactor,
    sessionMaxHours: shorter(own.sessionMaxHours, floor.sessionMaxHours),
    sessionIdleMinutes: shorter(own.sessionIdleMinutes, floor.sessionIdleMinutes),
  };
}

/** Is a requested security setting looser than the organisation's floor? */
export function looserSetting<K extends OrganisationSecurityKey>(k: K, value: WorkspaceSettings[K], floor: WorkspaceSettings[K]): boolean {
  if (k === 'requireTwoFactor') return floor === true && value !== true;
  return floor !== null && (value === null || (value as number) > (floor as number));
}
