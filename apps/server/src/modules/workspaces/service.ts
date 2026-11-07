// Workspaces: personal + team, members and roles, sharing policies, ownership transfer, and what
// a workspace grants on its boards (asked by modules/boards for every access decision).
import type { Request } from 'express';
import {
  ADMIN_SCOPE_REQUIRED,
  INACTIVE_BOARD_ACTIONS,
  IP_ALLOWLIST_EXCLUDES_YOU,
  type InactiveBoardAction,
  LINK_MAX_DAYS_LIMIT,
  ORGANISATION_POLICY,
  WORKSPACE_CREATION_BLOCKED,
  WORKSPACE_SETTING_LIMITS,
  type AdminScope,
  type BoardLabelSummary,
  type LinkAccess,
  type OrganisationSummary,
  type Role,
  type TeamAccess,
  type WorkspaceBlock,
  type WorkspaceMember,
  type WorkspacePolicies,
  type WorkspaceRole,
  type WorkspaceSettings,
  type WorkspaceKind,
  type WorkspaceSummary,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { currentRequestContext } from '../../platform/requestContext';
import { ipAllowed, MAX_RANGES, parseRange } from './ipAllowlist';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { getUser, getUsers, hasTwoFactor } from '../auth/index';
import { creationRefusal } from './creation';
import { deletionHoldOn } from './holds';
import { labelsForPlaces, UNKNOWN_LABEL_CAPS, withLabelCaps } from './labels';
import { unusableKeysAmong } from '../keys/index';
import {
  boardIdsInWorkspace,
  cleanUpDeletedBoards,
  countHeldBoards,
  deleteBoardRowsInWorkspace,
  transferBoardsOwnedIn,
  underLegalHold,
} from '../boards/index';
import { removeBoardMemberships } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import { membershipChanged, recordMembershipChange } from './events';
import { handOverOrganisation, organisationSummary } from './organisations';
import * as repo from './repo';
import type { Workspace } from './repo';
import {
  contentRole,
  DEFAULT_POLICIES,
  FLOOR_POLICY_KEYS,
  FLOOR_SETTING_KEYS,
  isFullMember,
  isManager,
  isAdminScope,
  ipListsOf,
  isWorkspaceRole,
  LINK_VALUES,
  looserPolicy,
  looserSetting,
  mayChangeRole,
  mayRemove,
  projectChain,
  scopesOf,
  teamAccessOf,
  type ProjectGate,
  TEAM_ACCESS_VALUES,
  teamRole,
} from './roles';

const MAX_NAME = 80;

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name is required');
  const t = v.trim().slice(0, MAX_NAME);
  if (!t) throw badRequest('Give the workspace a name');
  return t;
}

/** The user's personal workspace (created on first use: at signup nothing else has to know). */
export function ensurePersonalWorkspace(userId: string): Promise<string> {
  return repo.ensurePersonal(userId, newId(12), Date.now());
}

const toSummary = (
  w: Workspace,
  role: WorkspaceRole,
  memberCount: number,
  blocked: WorkspaceBlock | null,
  orgRoles: Map<string, WorkspaceRole>,
  adminScopes: AdminScope[] | null,
): WorkspaceSummary => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  role,
  memberCount,
  policies: w.policies,
  createdAt: w.createdAt,
  blocked,
  organisation: w.organisation && { ...w.organisation, yourRole: orgRoles.get(w.organisation.id) ?? null },
  adminScopes: w.kind === 'personal' ? [] : scopesOf(role, adminScopes),
});

/** The user's role in each organisation whose directory they are in. */
async function organisationRolesOf(userId: string): Promise<Map<string, WorkspaceRole>> {
  return new Map((await repo.organisationMembershipsOf(userId)).map((m) => [m.workspaceId, m.role]));
}

/**
 * Why a workspace's boards are closed to the user, or null. One rule for lists, summaries and
 * every access decision (boardAccessLoader): deactivated there or in its organisation (#108: an
 * organisation-wide deactivation, e.g. its directory's deprovisioning), or the workspace — itself
 * or through its organisation — requires two-step verification and they haven't turned it on.
 */
function blockOf(
  w: Workspace | undefined,
  deactivated: Set<string>,
  workspaceId: string,
  twoFactor: () => boolean,
  ipExempt: Set<string>,
  keyUnusable: Set<string>,
): WorkspaceBlock | null {
  if (deactivated.has(workspaceId) || (w?.organisation && deactivated.has(w.organisation.id))) return 'deactivated';
  if (w?.kind === 'team' && w.settings.requireTwoFactor && !twoFactor()) return 'two_factor_required';
  if (w?.kind === 'team' && !ipExempt.has(w.id) && ipBlocked(w)) return 'ip_not_allowed';
  // #159: its encryption key is suspended, destroyed or refused / unreachable at its KMS.
  if (keyUnusable.has(workspaceId)) return 'key_unavailable';
  return null;
}

/**
 * #156: the request (or socket) comes from outside the workspace's IP allowlists. Only where a
 * client address is known: background work (jobs, digests) acts for nobody's network. Requests
 * through an API token or app follow the same rule on every board they resolve (REST, MCP, lists,
 * search), except in workspaces whose admins exempted that credential (`ipExempt`).
 */
function ipBlocked(w: Workspace): boolean {
  const lists = ipListsOf(w);
  if (!lists.length) return false;
  const ip = currentRequestContext()?.ip;
  if (!ip) return false;
  return lists.some((l) => !ipAllowed(l, ip));
}

/** Which of these workspaces exempted an API credential from their IP allowlist (apiauth registers the reader). */
type IpExemptions = (credentialId: string, workspaceIds: string[]) => Promise<Set<string>>;
let ipExemptions: IpExemptions = async () => new Set();
export function setIpExemptionReader(fn: IpExemptions): void {
  ipExemptions = fn;
}

/**
 * Whether the workspace (or its organisation) limits where its boards are opened from (#156). For
 * integrations whose requests come from a chat app's servers rather than the person (#105).
 */
export async function hasIpAllowlist(workspaceId: string): Promise<boolean> {
  const w = await repo.getWorkspace(workspaceId);
  return !!w && w.kind === 'team' && ipListsOf(w).length > 0;
}

/** May a request from `ip` reach the workspace's boards (#156)? For apiauth's per-workspace check. */
export async function ipAllowedIn(workspaceId: string, ip: string | null): Promise<boolean> {
  const w = await repo.getWorkspace(workspaceId);
  if (!w || w.kind !== 'team' || !ip) return true;
  return ipListsOf(w).every((l) => ipAllowed(l, ip));
}

/**
 * The user's deactivations, (only when some of `workspaces` needs it) their two-step status, and
 * (#156: only for a request through an API credential to a workspace with an IP allowlist) where
 * that credential is exempt.
 */
async function blockInputs(
  userId: string,
  workspaces: Array<Workspace | undefined>,
): Promise<{ deactivated: Set<string>; twoFactor: boolean; ipExempt: Set<string>; keyUnusable: Set<string> }> {
  const needs2fa = workspaces.some((w) => w?.kind === 'team' && w.settings.requireTwoFactor);
  const credentialId = currentRequestContext()?.apiCredentialId;
  const listed = credentialId ? workspaces.filter((w): w is Workspace => !!w && w.kind === 'team' && ipListsOf(w).length > 0).map((w) => w.id) : [];
  const teams = workspaces.filter((w): w is Workspace => w?.kind === 'team').map((w) => w.id);
  const [deactivated, twoFactor, ipExempt, keyUnusable] = await Promise.all([
    repo.deactivatedIn(userId),
    needs2fa ? hasTwoFactor(userId) : Promise.resolve(true),
    listed.length ? ipExemptions(credentialId!, listed) : Promise.resolve(new Set<string>()),
    teams.length ? unusableKeysAmong(teams) : Promise.resolve(new Set<string>()),
  ]);
  return { deactivated, twoFactor, ipExempt, keyUnusable };
}

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  await ensurePersonalWorkspace(userId);
  const [rows, orgRoles] = await Promise.all([repo.workspacesOf(userId), organisationRolesOf(userId)]);
  const b = await blockInputs(userId, rows.map((r) => r.workspace));
  return rows.map((r) =>
    toSummary(r.workspace, r.role, r.memberCount, blockOf(r.workspace, b.deactivated, r.workspace.id, () => b.twoFactor, b.ipExempt, b.keyUnusable), orgRoles, r.adminScopes),
  );
}

/** A workspace's summary for the user, or (for an organisation's id) the organisation's. */
export async function workspaceSummary(workspaceId: string, userId: string): Promise<WorkspaceSummary | OrganisationSummary> {
  const row = (await repo.workspacesOf(userId)).find((r) => r.workspace.id === workspaceId);
  if (!row) return organisationSummary(workspaceId, userId);
  const b = await blockInputs(userId, [row.workspace]);
  return toSummary(
    row.workspace,
    row.role,
    row.memberCount,
    blockOf(row.workspace, b.deactivated, workspaceId, () => b.twoFactor, b.ipExempt, b.keyUnusable),
    await organisationRolesOf(userId),
    row.adminScopes,
  );
}

const ROLE_RANK: Record<WorkspaceRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

/**
 * The workspace and the user's role there: 404 unless they are in it (a workspace you're not in
 * doesn't exist for you), 403 below `min`. An organisation's directory row (#108) answers 404 too
 * unless the caller opts in with `organisation: true` — only the directory features do (identity,
 * audit, the admin console's members and settings), so nothing that works on boards, projects,
 * invites or integrations can be pointed at an organisation.
 */
export async function requireWorkspace(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'guest',
  {
    allowDeactivated = false,
    organisation = false,
    scope,
  }: { allowDeactivated?: boolean; organisation?: boolean; /** #151: the admin scope this needs (implies `min` admin). */ scope?: AdminScope } = {},
): Promise<{ workspace: Workspace; role: WorkspaceRole; scopes: AdminScope[]; contentRole: WorkspaceRole | null }> {
  const [workspace, member] = await Promise.all([repo.getWorkspace(workspaceId), repo.getMember(workspaceId, userId)]);
  if (!workspace || !member) throw notFound('Workspace not found');
  if (workspace.kind === 'organisation' && !organisation) throw notFound('Workspace not found');
  const role = member.role;
  const what = workspace.kind === 'organisation' ? 'organisation' : 'workspace';
  // A deactivated member can do nothing in the workspace but leave it.
  if (member.deactivatedAt !== null && !allowDeactivated) throw forbidden(`Your access to this ${what} was deactivated by its admins`);
  if (scope && ROLE_RANK[min] < ROLE_RANK.admin) min = 'admin';
  if (ROLE_RANK[role] < ROLE_RANK[min])
    throw forbidden(min === 'owner' ? `Only ${what === 'organisation' ? 'an organisation' : 'a workspace'} owner can do that` : min === 'admin' ? `Only ${what} owners and admins can do that` : 'Guests can’t do that');
  const scopes = scopesOf(role, member.adminScopes);
  if (scope) requireScope(scopes, scope, what);
  return { workspace, role, scopes, contentRole: contentRole(role, member.adminScopes) };
}

/**
 * Inside `repo.transaction()`: locks the workspace for a membership change, then authorises the
 * actor as `requireWorkspace` does — against their membership as it is now, after every change
 * that committed before this one. Authorising before the lock would let a request that started
 * while its actor was still an owner (or an active admin) run after they were demoted, removed or
 * deactivated.
 */
async function lockAndRequire(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole,
  opts: Parameters<typeof requireWorkspace>[3],
): ReturnType<typeof requireWorkspace> {
  if (!(await repo.lockWorkspace(workspaceId, 'update'))) throw notFound('Workspace not found');
  return requireWorkspace(workspaceId, userId, min, opts);
}

const SCOPE_LABEL: Record<AdminScope, string> = { members: 'members', content: 'content', security: 'security' };

/** 403 `admin_scope_required` unless `scopes` covers `scope` (#151). */
export function requireScope(scopes: AdminScope[], scope: AdminScope, what = 'workspace'): void {
  if (!scopes.includes(scope)) throw new HttpError(403, `Only owners and ${SCOPE_LABEL[scope]} admins of this ${what} can do that`, ADMIN_SCOPE_REQUIRED);
}

const whatOf = (w: Workspace) => (w.kind === 'organisation' ? 'organisation' : 'workspace');

const teamOnly = (w: Workspace) => {
  if (w.kind !== 'team') throw badRequest('Your personal workspace has no members or policies. Create a team workspace to collaborate.');
};
/** Team workspaces and organisations (their members, policies, security settings). */
const teamOrOrganisation = (w: Workspace) => {
  if (w.kind === 'personal') teamOnly(w);
};

/** 403 naming the organisation when a workspace asks for something looser than its floors. */
const floorRefusal = (w: Workspace, what: string) =>
  new HttpError(403, `${w.organisation!.name} sets “${what}” for all its workspaces. A workspace can be stricter, not looser.`, ORGANISATION_POLICY);

export async function createTeamWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
  // An organization that manages this person's address may keep them to its own workspace (#64).
  const refusal = await creationRefusal(userId, name);
  if (refusal) throw new HttpError(403, refusal, WORKSPACE_CREATION_BLOCKED);
  const id = newId(12);
  await repo.transaction(async () => {
    const max = getConfig().maxWorkspacesPerUser;
    await repo.lockCreateQuota(userId);
    if ((await repo.countOwnedTeams(userId)) >= max) throw forbidden(`You can own at most ${max} team workspaces.`);
    await repo.insertTeam(id, name, userId, Date.now());
    await recordAudit({ action: 'workspace.created', workspaceId: id, actorId: userId, target: { type: 'workspace', id, label: name } });
  });
  return workspaceSummary(id, userId);
}

/**
 * Re-resolves everyone connected to the workspace's boards (on every instance); for an
 * organisation, the boards of every workspace attached to it (its floors and deactivations).
 */
export async function refreshWorkspaceBoards(workspaceId: string): Promise<void> {
  for (const id of await boardIdsInWorkspace(workspaceId)) await refreshBoardAccess(id);
  for (const w of await repo.attachedWorkspaces(workspaceId)) for (const id of await boardIdsInWorkspace(w.id)) await refreshBoardAccess(id);
}

function cleanPolicies(v: unknown): Partial<WorkspacePolicies> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('policies must be an object');
  const p = v as Record<string, unknown>;
  const out: Partial<WorkspacePolicies> = {};
  const pick = <K extends keyof WorkspacePolicies>(k: K, allowed: readonly WorkspacePolicies[K][]) => {
    if (p[k] === undefined) return;
    if (!allowed.includes(p[k] as WorkspacePolicies[K])) throw badRequest(`policies.${k} must be one of ${allowed.join(', ')}`);
    out[k] = p[k] as WorkspacePolicies[K];
  };
  pick('externalSharing', ['anyone', 'admins', 'none']);
  pick('linkSharing', LINK_VALUES);
  pick('guestInvites', ['admins', 'members']);
  pick('downloads', ['anyone', 'members', 'admins']);
  pick('teamAccess', TEAM_ACCESS_VALUES);
  pick('publicLinks', ['anyone', 'signedIn']);
  pick('liveEmbeds', ['on', 'off']);
  pick('boardEmbeds', ['on', 'off']);
  pick('linkPassword', ['optional', 'required']);
  pick('templatePublishing', ['members', 'admins']);
  pick('gifs', ['off', 'g', 'pg-13']);
  pick('offlineCopies', ['all', 'unkeyed', 'off']);
  pick('guestEditing', ['on', 'off']);
  if (p.linkMaxDays !== undefined) {
    const d = p.linkMaxDays;
    if (d !== null && (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > LINK_MAX_DAYS_LIMIT))
      throw badRequest(`policies.linkMaxDays must be a whole number of days from 1 to ${LINK_MAX_DAYS_LIMIT}, or null`);
    out.linkMaxDays = d;
  }
  return out;
}

/**
 * Rename and/or change policies (owners/admins of a team workspace; of an organisation: its
 * floors). Policy changes apply to live sessions at once. A workspace in an organisation can't
 * ask for anything looser than the organisation's floor (#108).
 */
export async function updateWorkspace(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceSummary | OrganisationSummary> {
  const { workspace, scopes } = await requireWorkspace(workspaceId, userId, 'admin', { organisation: true });
  teamOrOrganisation(workspace);
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    policies: cleanPolicies(body.policies),
  };
  // Sharing policies are content administration (#151); any admin may rename.
  if (Object.keys(patch.policies).length) requireScope(scopes, 'content', whatOf(workspace));
  if (workspace.kind === 'organisation') delete patch.policies.teamAccess; // a team's own (not a floor)
  const floor = workspace.organisation?.policies;
  if (floor)
    for (const k of FLOOR_POLICY_KEYS) {
      const v = patch.policies[k];
      if (v !== undefined && looserPolicy(k, v, floor[k])) throw floorRefusal(workspace, POLICY_LABELS[k]);
    }
  const changedPolicies = (Object.keys(patch.policies) as Array<keyof WorkspacePolicies>).filter((k) => patch.policies[k] !== workspace.ownPolicies[k]);
  await repo.transaction(async () => {
    await repo.updateWorkspace(workspaceId, patch, Date.now());
    const target = { type: 'workspace', id: workspaceId, label: patch.name ?? workspace.name };
    if (patch.name !== undefined && patch.name !== workspace.name)
      await recordAudit({ action: 'workspace.renamed', workspaceId, actorId: userId, target, metadata: { from: workspace.name, to: patch.name } });
    if (changedPolicies.length)
      await recordAudit({
        action: 'workspace.policies_changed',
        actorId: userId,
        workspaceId,
        target,
        metadata: Object.fromEntries(changedPolicies.flatMap((k) => [[`${k}.from`, workspace.ownPolicies[k]], [`${k}.to`, patch.policies[k]!]])),
      });
  });
  if (Object.keys(patch.policies).length > 0) await refreshWorkspaceBoards(workspaceId);
  return workspaceSummary(workspaceId, userId);
}

/** How the floors read in a refusal (the admin console's labels). */
const POLICY_LABELS: Record<(typeof FLOOR_POLICY_KEYS)[number], string> = {
  externalSharing: 'Sharing outside the workspace',
  linkSharing: 'Links to boards',
  guestInvites: 'Inviting guests',
  downloads: 'Export, download and copy',
  publicLinks: 'Visitors without an account',
  liveEmbeds: 'Live embeds',
  boardEmbeds: 'Embedding boards on other sites',
  linkPassword: 'Password on board links',
  linkMaxDays: 'Board links expire within',
  templatePublishing: 'Who shares templates',
  gifs: 'GIF search',
  offlineCopies: 'Offline copies on devices',
  guestEditing: 'Guests on edit links can edit',
};
const SETTING_LABELS: Record<(typeof FLOOR_SETTING_KEYS)[number], string> = {
  requireTwoFactor: 'Require two-step verification',
  sessionMaxHours: 'Sign-in lasts at most',
  sessionIdleMinutes: 'Sign out after inactivity',
  inactiveBoardAction: 'Boards nobody uses',
  inactiveBoardDays: 'Boards nobody uses, after',
  ipAllowlist: 'Allowed networks',
};

// ---- security and retention settings (admin console) ----

/**
 * Which admin scope changes each setting (#151): sign-in, sessions and how long the audit log is
 * kept are security's; how long trashed boards and versions are kept is content's.
 */
export const SETTING_SCOPE: Record<keyof WorkspaceSettings, AdminScope> = {
  requireTwoFactor: 'security',
  sessionMaxHours: 'security',
  sessionIdleMinutes: 'security',
  auditRetentionDays: 'security',
  trashRetentionDays: 'content',
  versionRetentionDays: 'content',
  inactiveBoardAction: 'content',
  inactiveBoardDays: 'content',
  ipAllowlist: 'security',
};

/** A team workspace's effective settings (its own raised to its organisation's floors); an organisation's floors. */
export async function getSettings(workspaceId: string, userId: string): Promise<WorkspaceSettings> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin', { organisation: true });
  teamOrOrganisation(workspace);
  return workspace.settings;
}

function cleanSettings(body: Record<string, unknown>): Partial<WorkspaceSettings> {
  const out: Partial<WorkspaceSettings> = {};
  if (body.requireTwoFactor !== undefined) {
    if (typeof body.requireTwoFactor !== 'boolean') throw badRequest('requireTwoFactor must be true or false');
    out.requireTwoFactor = body.requireTwoFactor;
  }
  const num = <K extends keyof typeof WORKSPACE_SETTING_LIMITS>(k: K, nullable: boolean) => {
    const v = body[k];
    if (v === undefined) return;
    const { min, max } = WORKSPACE_SETTING_LIMITS[k];
    if (v === null && nullable) return void ((out as Record<string, unknown>)[k] = null);
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw badRequest(`${k} must be a whole number from ${min} to ${max}${nullable ? ', or null' : ''}`);
    (out as Record<string, unknown>)[k] = v;
  };
  num('sessionMaxHours', true);
  num('sessionIdleMinutes', true);
  num('trashRetentionDays', false);
  num('versionRetentionDays', true);
  num('auditRetentionDays', false);
  num('inactiveBoardDays', true);
  if (body.ipAllowlist !== undefined) {
    if (!Array.isArray(body.ipAllowlist) || body.ipAllowlist.length > MAX_RANGES) throw badRequest(`ipAllowlist must be a list of at most ${MAX_RANGES} ranges`);
    const ranges: string[] = [];
    for (const v of body.ipAllowlist) {
      const r = typeof v === 'string' ? parseRange(v) : null;
      if (!r) throw badRequest(`“${String(v).slice(0, 60)}” is not an IP address or a CIDR range (like 203.0.113.0/24 or 2001:db8::/32)`);
      if (!ranges.includes(r)) ranges.push(r);
    }
    out.ipAllowlist = ranges;
  }
  if (body.inactiveBoardAction !== undefined) {
    if (!(INACTIVE_BOARD_ACTIONS as readonly unknown[]).includes(body.inactiveBoardAction)) throw badRequest('inactiveBoardAction must be none, archive or trash');
    out.inactiveBoardAction = body.inactiveBoardAction as InactiveBoardAction;
  }
  return out;
}

/**
 * Changes security / retention settings (owners and admins of a team workspace). Turning on the
 * two-step requirement needs it on for the person doing it, so nobody locks themselves out. Takes
 * effect at once: board access is re-checked everywhere (two-step requirement); sessions and
 * retention follow from the next request / job run.
 */
export async function updateSettings(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceSettings> {
  const { workspace, scopes } = await requireWorkspace(workspaceId, userId, 'admin', { organisation: true });
  teamOrOrganisation(workspace);
  const patch = cleanSettings(body);
  // #151: each setting is someone's to change (SETTING_SCOPE).
  for (const k of Object.keys(patch) as Array<keyof WorkspaceSettings>) requireScope(scopes, SETTING_SCOPE[k], whatOf(workspace));
  const floor = workspace.organisation?.settings;
  if (floor)
    for (const k of FLOOR_SETTING_KEYS) {
      const v = patch[k];
      if (v !== undefined && looserSetting(k, v, floor[k])) throw floorRefusal(workspace, SETTING_LABELS[k]);
    }
  // #154: a rule that archives or trashes needs a period (its own, or the organisation's).
  const action = patch.inactiveBoardAction ?? workspace.ownSettings.inactiveBoardAction;
  const days = patch.inactiveBoardDays !== undefined ? patch.inactiveBoardDays : workspace.ownSettings.inactiveBoardDays;
  if (action !== 'none' && days === null && !workspace.organisation?.settings.inactiveBoardDays)
    throw badRequest('Choose after how many days without activity boards are archived or moved to the trash');
  if (patch.requireTwoFactor && !workspace.ownSettings.requireTwoFactor && !(await hasTwoFactor(userId)))
    throw forbidden('Turn on two-step verification for your own account first (Settings → Security)');
  // #156: a list that leaves out the address you are using now is saved only when you say so (you
  // would lose the boards, not the console: it stays reachable to fix the list).
  if (patch.ipAllowlist) {
    const ip = currentRequestContext()?.ip ?? null;
    const lists = [patch.ipAllowlist, workspace.kind === 'team' ? (workspace.organisation?.settings.ipAllowlist ?? []) : []].filter((l) => l.length);
    if (ip && lists.some((l) => !ipAllowed(l, ip)) && body.confirmExcludesMe !== true)
      throw new HttpError(409, `Your own address (${ip}) isn’t in this list: you couldn’t open the boards from here. Save it anyway?`, IP_ALLOWLIST_EXCLUDES_YOU);
  }
  const same = (k: keyof WorkspaceSettings) => String(patch[k]) === String(workspace.ownSettings[k]);
  const changed = (Object.keys(patch) as Array<keyof WorkspaceSettings>).filter((k) => !same(k));
  if (!changed.length) return workspace.settings;
  await repo.transaction(async () => {
    await repo.updateSettings(workspaceId, patch, Date.now());
    await recordAudit({
      action: 'workspace.settings_changed',
      actorId: userId,
      workspaceId,
      target: { type: 'workspace', id: workspaceId, label: workspace.name },
      metadata: Object.fromEntries(
        changed.flatMap((k) => {
          const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : (v as string | number | boolean | null));
          return [
            [`${k}.from`, show(workspace.ownSettings[k])],
            [`${k}.to`, show(patch[k])],
          ];
        }),
      ),
    });
  });
  if (changed.includes('requireTwoFactor') || changed.includes('ipAllowlist')) await refreshWorkspaceBoards(workspaceId);
  return (await repo.getWorkspace(workspaceId))!.settings;
}

/**
 * Deletes a team workspace with every board in it (trash included), after the caller typed its
 * name. Board rows go in the same transaction as the workspace, under its lock (so no board can
 * be created in it meanwhile); then everyone connected is disconnected.
 */
export async function deleteWorkspace(req: Request | null, workspaceId: string, userId: string, confirm: unknown): Promise<void> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  teamOnly(workspace);
  if (typeof confirm !== 'string' || confirm.trim() !== workspace.name) throw badRequest('Type the workspace name to confirm');
  const hold = await deletionHoldOn(workspaceId);
  if (hold) throw new HttpError(409, `This workspace can’t be deleted: ${hold}`);
  const owners = (await repo.listMembers(workspaceId)).filter((m) => m.role === 'owner').map((m) => m.userId);
  const boards = await deleteTeamWorkspaceNow(workspace, userId);
  if (boards === 'legal_hold')
    throw new HttpError(409, 'This workspace can’t be deleted: a legal hold keeps some of its content. It can be deleted once the hold is released.', 'legal_hold');
  if (boards === 'held')
    throw new HttpError(
      409,
      'A board in this workspace was taken down by Freero’s moderators and is under review. The workspace can be deleted once that review is over.',
      'workspace_board_held',
    );
  if (boards === null) return;
  // A receipt for every owner: what went, and that nothing of it can be restored.
  const people = await getUsers([...owners, userId]);
  for (const u of people.values())
    sendMailLater({
      to: u.email,
      ...renderMail({
        subject: `${workspace.name} was deleted`,
        title: `${workspace.name} was deleted`,
        paragraphs: [
          `${people.get(userId)?.name ?? 'An owner'} deleted the workspace ${workspace.name} on ${new Date().toUTCString()}.`,
          `Deleted with it: ${boards} board${boards === 1 ? '' : 's'} (their content, comments, version history and private layers), its projects, members, invitations, single sign-on and provisioning settings. Images only those boards used are removed from storage within a day.`,
          'This can’t be undone. If you didn’t expect this, contact the person who deleted it.',
        ],
        action: { label: 'Open Freero', url: appUrl(req, '/app') },
      }),
    });
}

/**
 * Deletes a team workspace and its boards now; returns how many boards went, or null if it was
 * gone already, or 'held' (changing nothing) while a board in it is taken down (held for review,
 * KAI-178; checked under the workspace lock). The deletion is recorded in the workspace's own log
 * (kept for the default retention after the workspace is gone) and in the account log of whoever
 * deleted it (null: the account purge).
 */
async function deleteTeamWorkspaceNow(workspace: Workspace, actorId: string | null): Promise<number | null | 'held' | 'legal_hold'> {
  const workspaceId = workspace.id;
  const gone = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return null;
    if (await countHeldBoards({ workspaceId })) return 'held' as const;
    // A legal hold (#157) on a board or custodian here: the database would refuse the delete anyway.
    if (await underLegalHold({ workspaceId })) return 'legal_hold' as const;
    const boards = await deleteBoardRowsInWorkspace(workspaceId);
    await repo.deleteTeam(workspaceId);
    await recordAudit({
      action: 'workspace.deleted',
      workspaceId,
      accountId: actorId,
      fanOut: false,
      actorId,
      target: { type: 'workspace', id: workspaceId, label: workspace.name },
      metadata: { boards: boards.length },
    });
    return boards;
  });
  if (gone === 'held' || gone === 'legal_hold') return gone;
  if (gone) await cleanUpDeletedBoards(gone);
  return gone ? gone.length : null;
}

/**
 * Hands a team workspace to another member: they become an owner and the caller an admin, in one
 * transaction. Guests can't own a workspace.
 */
export async function transferWorkspace(workspaceId: string, userId: string, targetId: unknown): Promise<WorkspaceSummary | OrganisationSummary> {
  if (typeof targetId !== 'string' || !targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('You already own this workspace');
  await repo.transaction(async () => {
    const { workspace } = await lockAndRequire(workspaceId, userId, 'owner', { organisation: true });
    teamOrOrganisation(workspace);
    const target = await repo.getMember(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (target.role === 'guest') throw badRequest('Make them a member first: guests can’t own a workspace');
    // The caller steps down to admin, so handing over to someone deactivated would leave no owner who can act.
    if (target.deactivatedAt !== null) throw badRequest('Reactivate them first: a deactivated member can’t take over a workspace');
    await repo.setRole(workspaceId, targetId, 'owner');
    await repo.setRole(workspaceId, userId, 'admin');
    await recordAudit({
      action: 'workspace.transferred',
      workspaceId,
      actorId: userId,
      target: { type: 'user', id: targetId, label: (await getUser(targetId))?.email ?? null },
      metadata: { previousOwnerRole: 'admin', newOwnerPreviousRole: target.role },
    });
  });
  return workspaceSummary(workspaceId, userId);
}

// ---- members ----

export async function listMembers(workspaceId: string, userId: string): Promise<WorkspaceMember[]> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'member'); // guests don't browse the directory
  const rows = await repo.listMembers(workspace.id);
  const users = await getUsers(rows.map((r) => r.userId));
  const out: WorkspaceMember[] = [];
  for (const r of rows) {
    const u = users.get(r.userId);
    if (u)
      out.push({
        userId: u.id,
        name: u.name,
        email: u.email,
        color: u.color,
        avatarUrl: u.avatarUrl,
        role: r.role,
        joinedAt: r.createdAt,
        ...(r.role === 'admin' ? { adminScopes: r.adminScopes } : {}),
      });
  }
  return out;
}

export async function memberOf(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  const [m, u] = await Promise.all([repo.getMember(workspaceId, userId), getUser(userId)]);
  if (!m || !u) return null;
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    color: u.color,
    avatarUrl: u.avatarUrl,
    role: m.role,
    joinedAt: m.createdAt,
    ...(m.role === 'admin' ? { adminScopes: m.adminScopes } : {}),
  };
}

/** `adminScopes` of a PATCH: a non-empty list of scopes, or null for all three (#151). */
function cleanScopes(v: unknown): AdminScope[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || !v.every(isAdminScope))
    throw badRequest('adminScopes must be a non-empty list of members, content, security — or null for all three');
  const set = new Set(v);
  return set.size === 3 ? null : (['members', 'content', 'security'] as AdminScope[]).filter((s) => set.has(s));
}

const lastOwner = () => new HttpError(409, 'A workspace needs at least one owner. Make someone else an owner first.');

/** Who inherits a departing member's boards: the longest-standing active owner, else any owner; null if none. */
async function heirIn(workspaceId: string): Promise<string | null> {
  const owners = (await repo.listMembers(workspaceId)).filter((m) => m.role === 'owner');
  return (owners.find((m) => m.deactivatedAt === null) ?? owners[0])?.userId ?? null;
}

/** Changes a member's role; never leaves the workspace without an owner (checked under its lock). */
export async function changeRole(workspaceId: string, actorId: string, targetId: string, role: unknown, adminScopes?: unknown): Promise<WorkspaceMember> {
  if (!isWorkspaceRole(role)) throw badRequest('role must be owner, admin, member or guest');
  const scopes = adminScopes === undefined ? undefined : cleanScopes(adminScopes);
  await repo.transaction(async () => {
    const { workspace, role: actor } = await lockAndRequire(workspaceId, actorId, 'admin', { organisation: true, scope: 'members' });
    teamOrOrganisation(workspace);
    if (workspace.kind === 'organisation' && role === 'guest') throw badRequest('An organisation has owners, admins and members');
    // Only owners decide what an admin administers (#151): an admin can never widen anyone's powers, theirs included.
    if (scopes !== undefined && actor !== 'owner') throw forbidden(`Only an owner of this ${whatOf(workspace)} can choose what an admin administers`);
    if (scopes !== undefined && role !== 'admin') throw badRequest('Only admins have admin scopes');
    const before = await repo.getMember(workspaceId, targetId);
    if (!before) throw notFound('That person is not a member of this workspace');
    const from = before.role;
    if (!mayChangeRole(actor, from, role)) throw forbidden('Only a workspace owner can change the role of owners and admins');
    if (from === 'owner' && role !== 'owner' && (await repo.isLastActiveOwner(workspaceId, targetId))) throw lastOwner();
    await repo.setRole(workspaceId, targetId, role);
    if (from !== role) await recordMembershipChange(workspaceId, targetId);
    if (from !== role)
      await recordAudit({ action: 'member.role_changed', workspaceId, actorId, target: await userTarget(targetId), metadata: { from, to: role } });
    const was = from === 'admin' ? before.adminScopes : null;
    if (scopes !== undefined && (from !== 'admin' ? scopes !== null : String(was) !== String(scopes))) {
      await repo.setAdminScopes(workspaceId, targetId, scopes);
      if (from === 'admin') await recordMembershipChange(workspaceId, targetId);
      await recordAudit({
        action: 'member.admin_scopes_changed',
        workspaceId,
        actorId,
        target: await userTarget(targetId),
        metadata: { from: from === 'admin' ? (was ?? ['all']).join(',') : null, to: (scopes ?? ['all']).join(',') },
      });
    }
  });
  await refreshWorkspaceBoards(workspaceId);
  await membershipChanged({ workspaceId, userId: targetId, role });
  const m = await memberOf(workspaceId, targetId);
  if (!m) throw notFound('That person is not a member of this workspace');
  return m;
}

/**
 * Removes a member (or the caller leaves). Their live sessions lose the workspace's boards at once,
 * on every instance; their direct invitations to its boards end too; boards they owned there pass
 * to the person who removed them (or, when leaving, to an owner) — team content stays with the team.
 */
export async function removeMember(workspaceId: string, actorId: string, targetId: string): Promise<void> {
  const self = actorId === targetId;
  await repo.transaction(async () => {
    const { workspace, role: actor, scopes } = await lockAndRequire(workspaceId, actorId, 'guest', { allowDeactivated: self, organisation: true });
    teamOrOrganisation(workspace);
    if (!self && actor === 'admin') requireScope(scopes, 'members', whatOf(workspace));
    const target = await repo.getRole(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (!self && !mayRemove(actor, target)) throw forbidden('Only a workspace owner can remove owners and admins');
    if (target === 'owner' && (await repo.isLastActiveOwner(workspaceId, targetId))) throw lastOwner();
    await repo.removeMember(workspaceId, targetId);
    await recordMembershipChange(workspaceId, targetId);
    // Leaving: the boards go to an owner who stays. None left (only a workspace whose owners are all
    // deactivated, which nothing allows any more): refused, so the workspace never ends up ownerless.
    const heir = self ? await heirIn(workspaceId) : actorId;
    if (!heir) throw lastOwner();
    const boards = await transferBoardsOwnedIn(workspaceId, targetId, heir);
    await removeBoardMemberships(await boardIdsInWorkspace(workspaceId), targetId);
    await recordAudit({
      action: self ? 'member.left' : 'member.removed',
      workspaceId,
      actorId,
      target: await userTarget(targetId),
      metadata: { role: target, boardsHandedTo: boards.length ? heir : null, boards: boards.length },
    });
  });
  await refreshWorkspaceBoards(workspaceId);
  await membershipChanged({ workspaceId, userId: targetId, role: null });
}

/**
 * The organisation's directory removes someone from one of its workspaces (#108: they left every
 * SCIM group that grants it). Owners are never removed by a directory. Same effects as an admin's
 * removal: their boards there pass to an owner, their direct invitations to its boards end, their
 * live sessions lose its boards on every instance. False when nothing changed.
 */
export async function removeMemberByDirectory(workspaceId: string, targetId: string, metadata: Record<string, string>): Promise<boolean> {
  const removed = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return false;
    const target = await repo.getRole(workspaceId, targetId);
    if (!target || target === 'owner') return false;
    const heir = await heirIn(workspaceId);
    if (!heir) return false;
    await repo.removeMember(workspaceId, targetId);
    await recordMembershipChange(workspaceId, targetId);
    const boards = await transferBoardsOwnedIn(workspaceId, targetId, heir);
    await removeBoardMemberships(await boardIdsInWorkspace(workspaceId), targetId);
    await recordAudit({
      action: 'member.removed',
      workspaceId,
      actorId: null,
      target: await userTarget(targetId),
      metadata: { ...metadata, role: target, boardsHandedTo: boards.length ? heir : null, boards: boards.length },
    });
    return true;
  });
  if (!removed) return false;
  await refreshWorkspaceBoards(workspaceId);
  await membershipChanged({ workspaceId, userId: targetId, role: null });
  return true;
}

/**
 * Deactivates a member (owners: anyone else; admins: members and guests): they keep their role,
 * boards and invitations but open nothing in the workspace — not even boards they own — and can
 * do nothing there but leave, until reactivated. Their live connections lose access at once.
 * Only an owner deactivates an owner, never the last active one, and the actor is authorised under
 * the workspace's lock: two owners deactivating each other at once leave one of them active.
 */
export async function setMemberDeactivated(workspaceId: string, actorId: string, targetId: string, deactivated: boolean): Promise<void> {
  if (actorId === targetId) throw badRequest('You can’t deactivate yourself');
  await repo.transaction(async () => {
    const { workspace, role: actor } = await lockAndRequire(workspaceId, actorId, 'admin', { organisation: true, scope: 'members' });
    teamOrOrganisation(workspace);
    const target = await repo.getMember(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (!mayRemove(actor, target.role)) throw forbidden('Only a workspace owner can deactivate owners and admins');
    if ((target.deactivatedAt !== null) === deactivated) return;
    if (deactivated && (await repo.isLastActiveOwner(workspaceId, targetId))) throw lastOwner();
    await repo.setDeactivated(workspaceId, targetId, deactivated ? Date.now() : null);
    await recordAudit({
      action: deactivated ? 'member.deactivated' : 'member.reactivated',
      workspaceId,
      actorId,
      target: await userTarget(targetId),
      metadata: { role: target.role },
    });
  });
  await refreshWorkspaceBoards(workspaceId);
}

/** An audit target for a person: their id and (current) email. */
async function userTarget(userId: string): Promise<{ type: 'user'; id: string; label: string | null }> {
  return { type: 'user', id: userId, label: (await getUser(userId))?.email ?? null };
}

// ---- what a workspace grants on its boards ----

/** Everything a board access decision needs from the board's workspace (see members/roles.ts resolveRole). */
export interface BoardWorkspaceAccess {
  /**
   * The board's workspace as people see it: a team's name, whether the board is in a private
   * project, and the team access level its members get — or null for a personal workspace.
   */
  team: { name: string; private: boolean; access: TeamAccess } | null;
  workspaceRole: WorkspaceRole | null;
  policies: WorkspacePolicies;
  /** What the workspace grants by itself (team access). */
  teamRole: Role | null;
  /** The user is in the board's workspace (any role, guests included). */
  inWorkspace: boolean;
  /** "External sharing: nobody": outside access (direct invites, links) stops working. */
  outsidersBlocked: boolean;
  /** Highest link access the workspace allows. */
  maxLink: LinkAccess;
  /** The workspace lets a board's link in visitors without an account (policy `publicLinks`). */
  anonymousLinks: boolean;
  /**
   * The workspace's boards are closed to this user whatever else they hold (ownership, invites,
   * links): deactivated there, or two-step verification required and off. The requirement applies
   * to everyone who opens its boards, members or not.
   */
  blocked: WorkspaceBlock | null;
  /** Days a trashed board of this workspace is kept. */
  trashRetentionDays: number;
  /**
   * #158: the board's classification label, whose caps are already in `policies` (and so in
   * `maxLink`, `anonymousLinks`, `outsidersBlocked`); `viewerExports` is read by boards' download check.
   */
  label: BoardLabelSummary | null;
}

const DEFAULT_TRASH_DAYS = 30;

/** Where a board is, and (#158) the label it carries. */
type BoardPlace = { workspaceId: string; projectId: string | null; labelId?: string | null };

/** A project nobody gets through: where a board's project chain is broken (a project that isn't there). */
const CLOSED_GATE: ProjectGate = { access: 'private', member: false };

/**
 * The gates a board in `projectId` sits behind (#129): its project and every project above it,
 * with whether the person is in each — null without a project; a broken chain fails closed.
 */
function projectGates(projectId: string | null, byId: ReadonlyMap<string, repo.Project>, mine: ReadonlySet<string>): ProjectGate[] | null {
  if (!projectId) return null;
  const chain = projectChain(projectId, byId);
  if (!chain) return [CLOSED_GATE];
  return chain.map((p) => ({ access: p.access, member: mine.has(p.id), teamAccess: p.teamAccess }));
}

/**
 * Loads what's needed to decide access to boards of `workspaceIds` for one user (one round of
 * queries), and returns the per-board function. For lists; single boards use `boardAccess`.
 */
export async function boardAccessLoader(userId: string, workspaceIds: string[]): Promise<(b: BoardPlace) => BoardWorkspaceAccess> {
  const ids = [...new Set(workspaceIds)];
  const [workspaces, roles, projects, myProjects] = await Promise.all([
    repo.getWorkspaces(ids),
    repo.rolesOf(userId),
    repo.projectsIn(ids),
    repo.projectIdsOf(userId, ids),
  ]);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const [blocks, labels] = await Promise.all([
    blockInputs(userId, workspaces),
    labelsForPlaces([...ids, ...workspaces.flatMap((w) => (w.organisation ? [w.organisation.id] : []))]),
  ]);
  // A label none of these places defines (an organisation's, after a detach) caps everything.
  const labelOf = (id: string | null | undefined): BoardLabelSummary | null => (id ? (labels.get(id) ?? STALE_LABEL(id)) : null);
  return (b) => {
    const ws = wsById.get(b.workspaceId);
    const label = labelOf(b.labelId);
    const policies = label ? withLabelCaps(ws?.policies ?? DEFAULT_POLICIES, label.caps) : (ws?.policies ?? DEFAULT_POLICIES);
    const role = roles.get(b.workspaceId) ?? null;
    const gates = projectGates(b.projectId, projectById, myProjects);
    const level = teamAccessOf(policies, gates);
    return {
      team: ws?.kind === 'team' ? { name: ws.name, private: gates?.some((g) => g.access === 'private') ?? false, access: level } : null,
      workspaceRole: role,
      policies,
      teamRole: teamRole(role, gates, level),
      inWorkspace: role !== null,
      outsidersBlocked: policies.externalSharing === 'none',
      maxLink: policies.linkSharing,
      anonymousLinks: policies.publicLinks === 'anyone',
      blocked: blockOf(ws, blocks.deactivated, b.workspaceId, () => blocks.twoFactor, blocks.ipExempt, blocks.keyUnusable),
      trashRetentionDays: ws?.settings.trashRetentionDays ?? DEFAULT_TRASH_DAYS,
      label,
    };
  };
}

/** A label id nothing the loader read defines: it caps everything (fail closed) until the board is relabelled. */
const STALE_LABEL = (id: string): BoardLabelSummary => ({ id, name: 'Unknown label', color: '#868e96', caps: UNKNOWN_LABEL_CAPS });

export async function boardAccess(userId: string, board: BoardPlace): Promise<BoardWorkspaceAccess> {
  return (await boardAccessLoader(userId, [board.workspaceId]))(board);
}

/**
 * Whether every full member of a team workspace can open a board placed at each of `places`
 * through team access alone (not in a private project) — the "workspace-level reader" that
 * workspace-wide integrations (webhooks) may tell about a board. Always false in a personal
 * workspace. In the order given; two queries whatever the count.
 */
export async function openToWholeTeam(places: BoardPlace[]): Promise<boolean[]> {
  const ids = [...new Set(places.map((p) => p.workspaceId))];
  const [workspaces, projects] = await Promise.all([repo.getWorkspaces(ids), repo.projectsIn(ids)]);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return places.map((p) => {
    const ws = wsById.get(p.workspaceId);
    if (!ws || ws.kind !== 'team') return false;
    if (p.projectId && !projectById.has(p.projectId)) return false;
    const gates = projectGates(p.projectId, projectById, new Set());
    return teamRole('member', gates, teamAccessOf(ws.policies, gates)) !== null;
  });
}

/**
 * Everyone the workspace itself gives access to a board placed at `place` (team access), with the
 * role it gives them: its owners/admins (editor), and its members (guests only through a project
 * they are in) unless the board is in a private project they're outside of (the board's team
 * access level). Deactivated members are left out. Empty for a personal workspace.
 */
export async function teamMembers(place: BoardPlace): Promise<Array<{ userId: string; role: Role; workspaceRole: WorkspaceRole }>> {
  const ws = await repo.getWorkspace(place.workspaceId);
  if (!ws || ws.kind !== 'team') return [];
  const [members, projects, orgMembers] = await Promise.all([
    repo.listMembers(ws.id),
    place.projectId ? repo.projectsIn([ws.id]) : Promise.resolve([] as repo.Project[]),
    ws.organisation ? repo.listMembers(ws.organisation.id) : Promise.resolve([] as repo.MemberRow[]),
  ]);
  // The board's project and every project above it (#129), with who is in each.
  const chain = place.projectId ? projectChain(place.projectId, new Map(projects.map((p) => [p.id, p]))) : [];
  const people = new Map<string, Set<string>>();
  for (const p of chain ?? []) people.set(p.id, new Set(await repo.projectPeopleIds(p.id)));
  // Deactivated across the organisation counts as deactivated here (blockOf).
  const offInOrg = new Set(orgMembers.filter((m) => m.deactivatedAt !== null).map((m) => m.userId));
  const level = teamAccessOf(ws.policies, chain ?? []);
  const out: Array<{ userId: string; role: Role; workspaceRole: WorkspaceRole }> = [];
  for (const m of members) {
    if (m.deactivatedAt !== null || offInOrg.has(m.userId)) continue;
    const wsRole = contentRole(m.role, m.adminScopes)!;
    const gates: ProjectGate[] | null = chain === null ? [CLOSED_GATE] : chain.map((p) => ({ access: p.access, member: people.get(p.id)!.has(m.userId), teamAccess: p.teamAccess }));
    const role = teamRole(wsRole, gates, level);
    if (role) out.push({ userId: m.userId, role, workspaceRole: wsRole });
  }
  return out;
}

/**
 * Who, besides a board's owner, decides who may join it (access requests) — `deciders`: the
 * workspace's owners/admins and, for a board in a private project, the project's creator while
 * still in the workspace (they run the project). `notify`: who hears about a new request — for a
 * private project's board the people running the project (its creator; the admins when there is
 * none), elsewhere the admins. Both empty for a personal workspace's board.
 */
export async function boardGatekeepers(place: BoardPlace): Promise<{ deciders: string[]; notify: string[] }> {
  const ws = await repo.getWorkspace(place.workspaceId);
  if (!ws || ws.kind !== 'team') return { deciders: [], notify: [] };
  const [members, project, projects] = await Promise.all([
    repo.listMembers(ws.id),
    place.projectId ? repo.getProject(place.projectId) : Promise.resolve(null),
    place.projectId ? repo.projectsIn([ws.id]) : Promise.resolve([] as repo.Project[]),
  ]);
  // Private here or anywhere above it (#129): the board's project runs who joins it.
  const chain = place.projectId ? projectChain(place.projectId, new Map(projects.map((p) => [p.id, p]))) : null;
  const closed = !!chain?.some((p) => p.access === 'private');
  // #151: an admin who doesn't administer content doesn't decide who opens boards.
  const admins = members.filter((m) => isManager(contentRole(m.role, m.adminScopes))).map((m) => m.userId);
  const lead =
    closed && project?.createdBy && members.some((m) => m.userId === project.createdBy && isFullMember(m.role))
      ? project.createdBy
      : null;
  const deciders = lead && !admins.includes(lead) ? [...admins, lead] : admins;
  return { deciders, notify: closed && lead ? [lead] : admins };
}

export async function teamMemberIds(place: BoardPlace): Promise<string[]> {
  return (await teamMembers(place)).map((m) => m.userId);
}

/** workspaceId -> the user's role, for every workspace they're in. */
export function workspaceRolesOf(userId: string): Promise<Map<string, WorkspaceRole>> {
  return repo.rolesOf(userId);
}

/**
 * The user's role in one workspace as it counts for board content (#151: an admin who doesn't
 * administer content reads 'member'; owners always 'owner'), or null.
 */
export function workspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return repo.getContentRole(workspaceId, userId);
}

export async function getWorkspaceInfo(
  workspaceId: string,
): Promise<{ id: string; kind: WorkspaceKind; personalOf: string | null; name: string; organisationId: string | null } | null> {
  const w = await repo.getWorkspace(workspaceId);
  return w ? { id: w.id, kind: w.kind, personalOf: w.personalOf, name: w.name, organisationId: w.organisation?.id ?? null } : null;
}

/**
 * Inside the caller's transaction: checks `userId` may create boards in the workspace (a member,
 * not a guest) and keeps the workspace from being deleted until that transaction ends. Never in an
 * organisation's directory row: it holds no boards (#108).
 */
export async function lockWorkspaceForNewBoard(workspaceId: string, userId: string): Promise<void> {
  if (!(await repo.lockWorkspace(workspaceId, 'share'))) throw notFound('Workspace not found');
  if ((await repo.getWorkspace(workspaceId))?.kind === 'organisation') throw notFound('Workspace not found');
  const member = await repo.getMember(workspaceId, userId);
  if (!member) throw notFound('Workspace not found');
  if (member.deactivatedAt !== null) throw forbidden('Your access to this workspace was deactivated by its admins');
  if (!isFullMember(member.role)) throw forbidden('Guests can’t create boards in this workspace');
}

/** Team workspace ids the user may share templates with (members, not guests). */
export async function teamWorkspaceIdsFor(userId: string): Promise<string[]> {
  return (await repo.teamMembershipsOf(userId)).filter((m) => isFullMember(m.role)).map((m) => m.workspaceId);
}

export { isManager };

/**
 * What the admin console shows about a team workspace (the caller checked the role with
 * requireWorkspace): its members with their state, how many projects and pending invites.
 */
export async function workspaceAdminFacts(workspaceId: string): Promise<{
  members: Array<{ userId: string; role: WorkspaceRole; joinedAt: number; deactivated: boolean; adminScopes: AdminScope[] | null }>;
  projects: number;
  /** Its projects' ids and names (the board inventory, #152). */
  projectList: Array<{ id: string; name: string }>;
  pendingInvites: number;
}> {
  const [members, projects, invites] = await Promise.all([repo.listMembers(workspaceId), repo.projectsIn([workspaceId]), repo.listInvites(workspaceId)]);
  return {
    members: members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.createdAt, deactivated: m.deactivatedAt !== null, adminScopes: m.adminScopes })),
    projects: projects.length,
    projectList: projects.map((p) => ({ id: p.id, name: p.name })),
    pendingInvites: invites.filter((i) => i.expiresAt > Date.now()).length,
  };
}

// ---- policies other modules enforce (KAI-51) ----

/**
 * The session limits of a person: the strictest of the team workspaces they are a member of (not
 * as a guest — a guest's account is their own, and a team shouldn't be able to sign people out of
 * everything by inviting them). Sessions belong to people, not workspaces, so the limit applies to
 * all of their sessions.
 */
export function sessionLimitsFor(userId: string): Promise<{ maxHours: number | null; idleMinutes: number | null }> {
  return repo.sessionLimitsFor(userId);
}

/** Everyone with session limits, with their strictest limits (the enforcement job). */
export function allSessionLimits(): Promise<Array<{ userId: string; maxHours: number | null; idleMinutes: number | null }>> {
  return repo.allSessionLimits();
}

/** "Acme requires two-step verification", when a workspace the user is in requires it (auth's seam). */
export async function twoFactorRequirementOf(userId: string): Promise<string | null> {
  const names = await repo.twoFactorRequiredBy(userId);
  return names.length ? `${names.join(', ')} require${names.length === 1 ? 's' : ''} two-step verification` : null;
}

/**
 * The inactive-board rule of every team workspace that has one (#154), as it applies: its own
 * raised to its organisation's floor. A rule needs an action and a period.
 */
export async function inactiveBoardRules(): Promise<Array<{ workspaceId: string; name: string; action: 'archive' | 'trash'; days: number }>> {
  const out: Array<{ workspaceId: string; name: string; action: 'archive' | 'trash'; days: number }> = [];
  for (const w of await repo.workspacesWithInactiveRule()) {
    const { inactiveBoardAction: action, inactiveBoardDays: days } = w.settings;
    if (action !== 'none' && days !== null) out.push({ workspaceId: w.id, name: w.name, action, days });
  }
  return out;
}

/** Every team workspace (#65: the daily usage rollup). */
export function allTeamWorkspaceIds(): Promise<string[]> {
  return repo.teamIds();
}

/** Who may share templates with a team workspace (its effective policy) or publish to an organisation (its own), #155. */
export async function templatePublishingOf(workspaceId: string): Promise<'members' | 'admins'> {
  const w = await repo.getWorkspace(workspaceId);
  return (w?.kind === 'organisation' ? w.ownPolicies : w?.policies)?.templatePublishing ?? 'members';
}

/** Why a workspace's data must be kept as it is (a legal hold, KAI-51 / #157), or null. */
export { deletionHoldOn as workspaceHoldOn } from './holds';

/** Workspaces whose retention differs from the defaults (trash 30 days, versions kept, audit 365 days). */
export function retentionOverrides(): Promise<Array<{ id: string; trashDays: number; versionDays: number | null; auditDays: number }>> {
  return repo.retentionOverrides();
}

/**
 * Team workspaces whose log shows an account's own events: those the person is a member (not
 * guest) of; and the organisations whose directory they are in (audit adds the organisations of
 * those workspaces itself, once each).
 */
export async function auditScopeOf(userId: string): Promise<string[]> {
  const [teams, orgs] = await Promise.all([repo.teamMembershipsOf(userId), repo.organisationMembershipsOf(userId)]);
  return [...teams, ...orgs].filter((m) => isFullMember(m.role)).map((m) => m.workspaceId);
}

/** workspaceId -> the organisation it is attached to (audit's fan-out to the organisation's log). */
export function organisationsOfWorkspaces(workspaceIds: string[]): Promise<Map<string, string>> {
  return repo.organisationIdsOf(workspaceIds);
}

/** The team workspaces attached to an organisation (its directory grants in them: SCIM groups). */
export async function attachedWorkspaceIds(organisationId: string): Promise<string[]> {
  return (await repo.attachedWorkspaces(organisationId)).map((w) => w.id);
}

// ---- account deletion ----

/**
 * Before an account is purged: in every team workspace where the user is the only owner, the
 * longest-standing admin (else member, else guest) becomes owner; a team with nobody else in it is
 * deleted with its boards — unless one of them is taken down (held for review, KAI-178): then it
 * is kept, and the result counts it, so the purge waits. Boards the user owned in team workspaces
 * pass to an owner of that workspace, so team content survives. Idempotent (a purge interrupted
 * halfway is simply redone). The personal workspace is not touched here: it goes with the account row.
 */
export async function handOverTeamWorkspaces(userId: string): Promise<{ held: number }> {
  let held = 0;
  // Organisations they run pass on the same way; one nobody else is in is dissolved.
  for (const { workspaceId } of await repo.organisationMembershipsOf(userId)) await handOverOrganisation(workspaceId, userId);
  for (const { workspaceId } of await repo.teamMembershipsOf(userId)) {
    const orphaned = await repo.transaction(async () => {
      if (!(await repo.lockWorkspace(workspaceId, 'update'))) return null;
      const others = (await repo.listMembers(workspaceId)).filter((m) => m.userId !== userId); // oldest first
      // Someone who can act: deactivated members inherit only when nobody else is left.
      const active = others.filter((m) => m.deactivatedAt === null);
      let heir = active.find((m) => m.role === 'owner');
      if (!heir) {
        heir =
          active.find((m) => m.role === 'admin') ??
          active.find((m) => m.role === 'member') ??
          active.find((m) => m.role === 'guest') ??
          others.find((m) => m.role === 'owner') ??
          others[0];
        if (!heir) return repo.getWorkspace(workspaceId);
        if (heir.role !== 'owner') {
          await repo.setRole(workspaceId, heir.userId, 'owner');
          await recordAudit({
            action: 'workspace.owner_inherited',
            workspaceId,
            actorId: null,
            target: await userTarget(heir.userId),
            metadata: { previousRole: heir.role, previousOwner: userId },
          });
        }
      }
      const boards = await transferBoardsOwnedIn(workspaceId, userId, heir.userId);
      if (boards.length)
        await recordAudit({
          action: 'board.transferred',
          workspaceId,
          actorId: null,
          target: await userTarget(heir.userId),
          metadata: { from: userId, boards: boards.length, reason: 'account_deleted' },
        });
      return null;
    });
    if (orphaned) {
      const r = await deleteTeamWorkspaceNow(orphaned, null);
      if (r === 'held' || r === 'legal_hold') held++;
    }
  }
  return { held };
}
