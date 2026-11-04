// Pure workspace rules: roles, what a workspace grants on its boards, and the sharing policies.
import { ADMIN_SCOPES, looserPolicy, POLICY_STRICTNESS, PROJECT_MAX_DEPTH } from '@freero/shared';
import type {
  AdminScope,
  InactiveBoardAction,
  LinkAccess,
  OrderedPolicyKey,
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

// ---- admin scopes (#151) ----

export const isAdminScope = (v: unknown): v is AdminScope => (ADMIN_SCOPES as readonly unknown[]).includes(v);

/** What someone administers: owners everything, an admin their scopes (none stored: everything), others nothing. */
export function scopesOf(role: WorkspaceRole | null, adminScopes: AdminScope[] | null): AdminScope[] {
  if (role === 'owner' || (role === 'admin' && !adminScopes)) return [...ADMIN_SCOPES];
  return role === 'admin' ? ADMIN_SCOPES.filter((s) => adminScopes!.includes(s)) : [];
}

/**
 * The role as it counts for board content: an admin who doesn't administer content is a member
 * there (no editing every board, no private projects, no moving others' boards). The SQL twin is
 * repo.ts `CONTENT_ROLE` (lists and board access read it from there).
 */
export function contentRole(role: WorkspaceRole | null, adminScopes: AdminScope[] | null): WorkspaceRole | null {
  return role === 'admin' && !scopesOf(role, adminScopes).includes('content') ? 'member' : role;
}

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
  linkPassword: 'optional',
  linkMaxDays: null,
  templatePublishing: 'members',
  gifs: 'g',
};

/**
 * One project on the way from a board's project up to the workspace (#129: projects nest): its
 * access, the person's membership in it and its own team access level.
 */
export interface ProjectGate {
  access: ProjectAccess;
  member: boolean;
  teamAccess?: TeamAccess | null;
}

const LEVEL_RANK: Record<TeamAccess, number> = { viewer: 0, commenter: 1, editor: 2 };

/**
 * The team access level of a board: the STRICTEST level set by its project or any project above
 * it (a sub-project may be stricter than its parent, never looser — #129), else the workspace's.
 * A single project's own level still wins over the workspace's, as before nesting (KAI-93).
 * `chain`: the board's project first, then its parent, and so on; null for none.
 */
export function teamAccessOf(policies: WorkspacePolicies, chain: ReadonlyArray<{ teamAccess?: TeamAccess | null }> | null): TeamAccess {
  let level: TeamAccess | null = null;
  for (const p of chain ?? []) if (p.teamAccess && (level === null || LEVEL_RANK[p.teamAccess] < LEVEL_RANK[level])) level = p.teamAccess;
  return level ?? policies.teamAccess;
}

/**
 * A project and the projects above it, nearest first (`[project, parent, grandparent…]`), from a
 * map of the workspace's projects. A parent that is missing ends the chain as an unknown project
 * would: `null` (fails closed — callers treat it like a project nobody may see through). Cycles
 * cannot be stored (moves are checked under lock) but are cut off here too.
 */
export function projectChain<P extends { id: string; parentId: string | null }>(id: string, byId: ReadonlyMap<string, P>): P[] | null {
  const out: P[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur) {
    const p = byId.get(cur);
    if (!p || seen.has(cur) || out.length > PROJECT_MAX_DEPTH + 1) return null;
    seen.add(cur);
    out.push(p);
    cur = p.parentId;
  }
  return out;
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
 * - a board in projects: only someone who passes EVERY project from the board's up to the top
 *   (#129: a sub-project never grants more than its parent) — a private one lets in its members,
 *   an open one every full member; a guest only projects they were added to;
 * - other boards: every full member, never a guest.
 * Everyone but owners/admins gets `level`, the board's team access level (`teamAccessOf`).
 * `projects`: the board's project chain (projectChain), a lone project, or null for none.
 * Direct board memberships and link access come on top of this (members/roles.ts).
 */
export function teamRole(role: WorkspaceRole | null, projects: ProjectGate | ReadonlyArray<ProjectGate> | null, level: TeamAccess): Role | null {
  if (!role) return null;
  if (isManager(role)) return MANAGER_BOARD_ROLE;
  const chain: ReadonlyArray<ProjectGate> = projects === null ? [] : Array.isArray(projects) ? projects : [projects as ProjectGate];
  if (chain.length === 0) return role === 'guest' ? null : level;
  for (const p of chain) if (!passesProject(role, p)) return null;
  return level;
}

/** Whether someone with workspace `role` gets through one project (see teamRole and projects.ts canSee). */
export function passesProject(role: WorkspaceRole | null, p: ProjectGate): boolean {
  if (isManager(role)) return true;
  if (p.member) return role !== null;
  return p.access === 'workspace' && isFullMember(role);
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
// Plus the numeric link lifetime limit (the shorter wins; null: no limit).
const ORDERED_KEYS = Object.keys(POLICY_STRICTNESS) as OrderedPolicyKey[];
export const FLOOR_POLICY_KEYS: OrganisationPolicyKey[] = [...ORDERED_KEYS, 'linkMaxDays'];
export const FLOOR_SETTING_KEYS: OrganisationSecurityKey[] = ['requireTwoFactor', 'sessionMaxHours', 'sessionIdleMinutes', 'inactiveBoardAction', 'inactiveBoardDays'];
export type PolicyFloor = Pick<WorkspacePolicies, OrganisationPolicyKey>;
export type SettingsFloor = Pick<WorkspaceSettings, OrganisationSecurityKey>;

/** What a new organisation starts with: the loosest value of every key, i.e. no floor at all. */
export const NO_FLOOR_POLICIES = { ...Object.fromEntries(ORDERED_KEYS.map((k) => [k, POLICY_STRICTNESS[k][0]])), linkMaxDays: null } as PolicyFloor;

/** A workspace's own policies raised to its organisation's floors, key by key (the effective policies). */
export function strictestPolicies(own: WorkspacePolicies, floor: PolicyFloor | null): WorkspacePolicies {
  if (!floor) return own;
  const out: Record<string, unknown> = { ...own };
  for (const k of FLOOR_POLICY_KEYS) if (looserPolicy(k, own[k], floor[k])) out[k] = floor[k];
  return out as unknown as WorkspacePolicies;
}

/** The shorter of two optional limits (null: no limit). */
const shorter = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

const ACTION_RANK: Record<InactiveBoardAction, number> = { none: 0, archive: 1, trash: 2 };

/**
 * A workspace's own security settings raised to its organisation's floors (trash, version and
 * audit retention stay the workspace's own). The inactive-board rule (#154) combines key by key,
 * like every floor: the stricter action, the shorter period. The IP allowlist (#156) stays the
 * workspace's own here: the organisation's list applies BESIDES it (`ipListsOf`), never merged.
 */
export function strictestSettings(own: WorkspaceSettings, floor: SettingsFloor | null): WorkspaceSettings {
  if (!floor) return own;
  return {
    ...own,
    requireTwoFactor: own.requireTwoFactor || floor.requireTwoFactor,
    sessionMaxHours: shorter(own.sessionMaxHours, floor.sessionMaxHours),
    sessionIdleMinutes: shorter(own.sessionIdleMinutes, floor.sessionIdleMinutes),
    inactiveBoardAction: ACTION_RANK[floor.inactiveBoardAction] > ACTION_RANK[own.inactiveBoardAction] ? floor.inactiveBoardAction : own.inactiveBoardAction,
    inactiveBoardDays: shorter(own.inactiveBoardDays, floor.inactiveBoardDays),
  };
}

/** The IP allowlists that apply to a workspace's boards (#156): its own and its organisation's, each when set. */
export function ipListsOf(w: { settings: WorkspaceSettings; organisation: { settings: SettingsFloor } | null }): string[][] {
  return [w.settings.ipAllowlist, w.organisation?.settings.ipAllowlist ?? []].filter((l) => l.length > 0);
}

/** Is a requested security setting looser than the organisation's floor? */
export function looserSetting<K extends OrganisationSecurityKey>(k: K, value: WorkspaceSettings[K], floor: WorkspaceSettings[K]): boolean {
  if (k === 'requireTwoFactor') return floor === true && value !== true;
  if (k === 'inactiveBoardAction') return ACTION_RANK[value as InactiveBoardAction] < ACTION_RANK[floor as InactiveBoardAction];
  return floor !== null && (value === null || (value as number) > (floor as number));
}
