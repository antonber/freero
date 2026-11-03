// The only writer of `workspaces`, `workspace_members`, `workspace_invites`, `projects`,
// `project_members` and (#63) `workspace_groups`, `workspace_group_members`, `project_groups` [S4].
import type { AdminScope, InactiveBoardAction, ProjectAccess, TeamAccess, WorkspaceKind, WorkspacePolicies, WorkspaceRole, WorkspaceSettings } from '@freero/shared';
import { isForeignKeyViolation, isUniqueViolation, one, query, tx } from '../../platform/db';
import { NO_FLOOR_POLICIES, strictestPolicies, strictestSettings, type InvitableWorkspaceRole, type PolicyFloor, type SettingsFloor } from './roles';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

// ---- workspaces ----

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  personalOf: string | null;
  /**
   * The EFFECTIVE policies and settings: the workspace's own, raised to its organisation's floors
   * (#108). Every access decision reads these; only the admin screens need `own…`.
   */
  policies: WorkspacePolicies;
  settings: WorkspaceSettings;
  /** What the workspace itself set (for an organisation: its floors). */
  ownPolicies: WorkspacePolicies;
  ownSettings: WorkspaceSettings;
  /** The organisation a team workspace is attached to, with its floors. */
  organisation: { id: string; name: string; policies: PolicyFloor; settings: SettingsFloor; attachedAt: number } | null;
  createdAt: number;
  updatedAt: number;
}

interface WsRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  personal_of: string | null;
  external_sharing: WorkspacePolicies['externalSharing'];
  link_sharing: WorkspacePolicies['linkSharing'];
  guest_invites: WorkspacePolicies['guestInvites'];
  downloads: WorkspacePolicies['downloads'];
  team_access: TeamAccess;
  public_links: 'anyone' | 'signed_in';
  live_embeds: 'on' | 'off';
  board_embeds: 'on' | 'off';
  link_password: 'optional' | 'required' | null;
  link_max_days: number | null;
  template_publishing: 'members' | 'admins' | null;
  require_two_factor: boolean;
  session_max_hours: number | null;
  session_idle_minutes: number | null;
  trash_retention_days: number;
  version_retention_days: number | null;
  audit_retention_days: number;
  inactive_board_action: InactiveBoardAction | null;
  inactive_board_days: number | null;
  organisation_id: string | null;
  organisation_attached_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // The organisation's row, joined (WS_SELECT).
  org_name: string | null;
  org_external_sharing: WorkspacePolicies['externalSharing'] | null;
  org_link_sharing: WorkspacePolicies['linkSharing'] | null;
  org_guest_invites: WorkspacePolicies['guestInvites'] | null;
  org_downloads: WorkspacePolicies['downloads'] | null;
  org_public_links: 'anyone' | 'signed_in' | null;
  org_live_embeds: 'on' | 'off' | null;
  org_board_embeds: 'on' | 'off' | null;
  org_link_password: 'optional' | 'required' | null;
  org_link_max_days: number | null;
  org_template_publishing: 'members' | 'admins' | null;
  org_require_two_factor: boolean | null;
  org_session_max_hours: number | null;
  org_session_idle_minutes: number | null;
  org_inactive_board_action: InactiveBoardAction | null;
  org_inactive_board_days: number | null;
}

/**
 * Every read of a workspace goes through this: the row with its organisation's floors, so the
 * effective policies are computed in one place (toWorkspace) and no reader can miss a floor.
 */
const WS_SELECT = `SELECT w.*, o.name AS org_name, o.external_sharing AS org_external_sharing, o.link_sharing AS org_link_sharing,
    o.guest_invites AS org_guest_invites, o.downloads AS org_downloads, o.public_links AS org_public_links,
    o.live_embeds AS org_live_embeds, o.board_embeds AS org_board_embeds, o.require_two_factor AS org_require_two_factor,
    o.link_password AS org_link_password, o.link_max_days AS org_link_max_days, o.template_publishing AS org_template_publishing,
    o.session_max_hours AS org_session_max_hours, o.session_idle_minutes AS org_session_idle_minutes,
    o.inactive_board_action AS org_inactive_board_action, o.inactive_board_days AS org_inactive_board_days
  FROM workspaces w LEFT JOIN workspaces o ON o.id = w.organisation_id`;

const publicLinks = (v: 'anyone' | 'signed_in'): WorkspacePolicies['publicLinks'] => (v === 'signed_in' ? 'signedIn' : 'anyone');

function toWorkspace(r: WsRow): Workspace {
  const ownPolicies: WorkspacePolicies = {
    externalSharing: r.external_sharing,
    linkSharing: r.link_sharing,
    guestInvites: r.guest_invites,
    downloads: r.downloads,
    teamAccess: r.team_access,
    publicLinks: publicLinks(r.public_links),
    liveEmbeds: r.live_embeds === 'off' ? 'off' : 'on',
    boardEmbeds: r.board_embeds === 'off' ? 'off' : 'on',
    linkPassword: r.link_password === 'required' ? 'required' : 'optional',
    linkMaxDays: r.link_max_days ?? null,
    templatePublishing: r.template_publishing === 'admins' ? 'admins' : 'members',
  };
  const ownSettings: WorkspaceSettings = {
    requireTwoFactor: r.require_two_factor,
    sessionMaxHours: r.session_max_hours,
    sessionIdleMinutes: r.session_idle_minutes,
    trashRetentionDays: r.trash_retention_days,
    versionRetentionDays: r.version_retention_days,
    auditRetentionDays: r.audit_retention_days,
    inactiveBoardAction: r.inactive_board_action ?? 'none',
    inactiveBoardDays: r.inactive_board_days ?? null,
  };
  const organisation =
    r.organisation_id && r.org_name !== null
      ? {
          id: r.organisation_id,
          name: r.org_name,
          policies: {
            externalSharing: r.org_external_sharing ?? NO_FLOOR_POLICIES.externalSharing,
            linkSharing: r.org_link_sharing ?? NO_FLOOR_POLICIES.linkSharing,
            guestInvites: r.org_guest_invites ?? NO_FLOOR_POLICIES.guestInvites,
            downloads: r.org_downloads ?? NO_FLOOR_POLICIES.downloads,
            publicLinks: r.org_public_links ? publicLinks(r.org_public_links) : NO_FLOOR_POLICIES.publicLinks,
            liveEmbeds: r.org_live_embeds ?? NO_FLOOR_POLICIES.liveEmbeds,
            boardEmbeds: r.org_board_embeds ?? NO_FLOOR_POLICIES.boardEmbeds,
            linkPassword: r.org_link_password ?? NO_FLOOR_POLICIES.linkPassword,
            linkMaxDays: r.org_link_max_days ?? null,
            templatePublishing: r.org_template_publishing ?? NO_FLOOR_POLICIES.templatePublishing,
          },
          settings: {
            requireTwoFactor: r.org_require_two_factor ?? false,
            sessionMaxHours: r.org_session_max_hours,
            sessionIdleMinutes: r.org_session_idle_minutes,
            inactiveBoardAction: r.org_inactive_board_action ?? 'none',
            inactiveBoardDays: r.org_inactive_board_days ?? null,
          },
          attachedAt: (r.organisation_attached_at ?? r.updated_at).getTime(),
        }
      : null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    personalOf: r.personal_of,
    policies: strictestPolicies(ownPolicies, organisation?.policies ?? null),
    settings: strictestSettings(ownSettings, organisation?.settings ?? null),
    ownPolicies,
    ownSettings,
    organisation,
    createdAt: r.created_at.getTime(),
    updatedAt: r.updated_at.getTime(),
  };
}

/**
 * The user's personal workspace id, creating it (with them as its owner) if missing. One
 * statement per step and idempotent: concurrent calls end up with the same single workspace.
 */
export async function ensurePersonal(userId: string, newWorkspaceId: string, now: number): Promise<string> {
  const existing = await one<{ id: string }>(`SELECT id FROM workspaces WHERE personal_of = $1`, [userId]);
  if (existing) return existing.id;
  await query(
    `WITH ins AS (
       INSERT INTO workspaces (id, name, kind, personal_of, created_by, created_at, updated_at)
       VALUES ($1, 'Personal', 'personal', $2, $2, $3, $3)
       ON CONFLICT (personal_of) DO NOTHING RETURNING id
     )
     INSERT INTO workspace_members (workspace_id, user_id, role, created_at) SELECT id, $2, 'owner', $3 FROM ins`,
    [newWorkspaceId, userId, new Date(now)],
  );
  const r = await one<{ id: string }>(`SELECT id FROM workspaces WHERE personal_of = $1`, [userId]);
  if (!r) throw new Error(`no personal workspace for ${userId} (account deleted?)`);
  return r.id;
}

/**
 * Team workspaces where an inactive-board rule may apply (#154): their own, or their
 * organisation's (the floor). Effective values: `settings` (toWorkspace raised them).
 */
export async function workspacesWithInactiveRule(): Promise<Workspace[]> {
  return (await query<WsRow>(`${WS_SELECT} WHERE w.kind = 'team' AND (w.inactive_board_action <> 'none' OR o.inactive_board_action <> 'none') ORDER BY w.id`)).map(
    toWorkspace,
  );
}

/** A team workspace with its creator as owner (inside a transaction: both rows or none). */
export async function insertTeam(id: string, name: string, ownerId: string, now: number): Promise<void> {
  await query(
    `INSERT INTO workspaces (id, name, kind, created_by, created_at, updated_at) VALUES ($1, $2, 'team', $3, $4, $4)`,
    [id, name, ownerId, new Date(now)],
  );
  await query(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, 'owner', $3)`, [
    id,
    ownerId,
    new Date(now),
  ]);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const r = await one<WsRow>(`${WS_SELECT} WHERE w.id = $1`, [id]);
  return r ? toWorkspace(r) : null;
}

export async function getWorkspaces(ids: string[]): Promise<Workspace[]> {
  if (ids.length === 0) return [];
  return (await query<WsRow>(`${WS_SELECT} WHERE w.id = ANY($1::text[])`, [ids])).map(toWorkspace);
}

type WithRole = { workspace: Workspace; role: WorkspaceRole; memberCount: number; adminScopes: AdminScope[] | null };

/**
 * Every WORKSPACE the user is in (personal and team; never an organisation's directory row), with
 * their role and the member count.
 */
export function workspacesOf(userId: string): Promise<WithRole[]> {
  return withRoles(userId, false);
}

/** The organisations whose directory the user is in, with their role and its member count. */
export function organisationsOf(userId: string): Promise<WithRole[]> {
  return withRoles(userId, true);
}

async function withRoles(userId: string, organisations: boolean): Promise<WithRole[]> {
  const rows = await query<WsRow & { role: WorkspaceRole; member_count: number; admin_scopes: AdminScope[] | null }>(
    `SELECT x.*, m.role, m.admin_scopes, (SELECT count(*)::int FROM workspace_members c WHERE c.workspace_id = x.id) AS member_count
     FROM workspace_members m JOIN (${WS_SELECT}) x ON x.id = m.workspace_id
     WHERE m.user_id = $1 AND (x.kind = 'organisation') = $2
     ORDER BY (x.kind = 'personal') DESC, x.name, x.id`,
    [userId, organisations],
  );
  return rows.map((r) => ({ workspace: toWorkspace(r), role: r.role, memberCount: r.member_count, adminScopes: r.role === 'admin' ? r.admin_scopes : null }));
}

/**
 * workspaceId -> role, for every WORKSPACE the user is in. Never an organisation: an org role
 * reaches no board (lists, search, board access and the public API read this).
 */
export async function rolesOf(userId: string): Promise<Map<string, WorkspaceRole>> {
  const rows = await query<{ workspace_id: string; role: WorkspaceRole }>(
    `SELECT m.workspace_id, ${CONTENT_ROLE} AS role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 AND w.kind <> 'organisation'`,
    [userId],
  );
  return new Map(rows.map((r) => [r.workspace_id, r.role]));
}

/** Changes only the given fields, in one statement. */
export async function updateWorkspace(id: string, patch: { name?: string; policies?: Partial<WorkspacePolicies> }, now: number): Promise<void> {
  const p = patch.policies ?? {};
  await query(
    `UPDATE workspaces SET name = COALESCE($2, name), external_sharing = COALESCE($3, external_sharing),
       link_sharing = COALESCE($4, link_sharing), guest_invites = COALESCE($5, guest_invites),
       downloads = COALESCE($6, downloads), updated_at = $7, team_access = COALESCE($8, team_access),
       public_links = COALESCE($9, public_links), live_embeds = COALESCE($10, live_embeds),
       board_embeds = COALESCE($11, board_embeds), link_password = COALESCE($12, link_password),
       link_max_days = CASE WHEN $13::boolean THEN $14::integer ELSE link_max_days END,
       template_publishing = COALESCE($15, template_publishing)
     WHERE id = $1`,
    [
      id,
      patch.name ?? null,
      p.externalSharing ?? null,
      p.linkSharing ?? null,
      p.guestInvites ?? null,
      p.downloads ?? null,
      new Date(now),
      p.teamAccess ?? null,
      p.publicLinks === undefined ? null : p.publicLinks === 'signedIn' ? 'signed_in' : 'anyone',
      p.liveEmbeds ?? null,
      p.boardEmbeds ?? null,
      p.linkPassword ?? null,
      // null is a value here (no limit): whether to set it at all is its own flag.
      p.linkMaxDays !== undefined,
      p.linkMaxDays ?? null,
      p.templatePublishing ?? null,
    ],
  );
}

/** Security / retention settings: only the given fields (null clears a limit), in one statement. */
export async function updateSettings(id: string, patch: Partial<WorkspaceSettings>, now: number): Promise<void> {
  const cols: Array<[keyof WorkspaceSettings, string]> = [
    ['requireTwoFactor', 'require_two_factor'],
    ['sessionMaxHours', 'session_max_hours'],
    ['sessionIdleMinutes', 'session_idle_minutes'],
    ['trashRetentionDays', 'trash_retention_days'],
    ['versionRetentionDays', 'version_retention_days'],
    ['auditRetentionDays', 'audit_retention_days'],
    ['inactiveBoardAction', 'inactive_board_action'],
    ['inactiveBoardDays', 'inactive_board_days'],
  ];
  const sets: string[] = [];
  const params: unknown[] = [id, new Date(now)];
  for (const [key, col] of cols) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return;
  await query(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = $2 WHERE id = $1`, params);
}

// Session and two-step policies apply to the people of TEAM workspaces (not their guests) and of
// organisations' directories; a team workspace's own limit is raised to its organisation's floor
// (LEAST ignores NULL, which means no limit).
const EFFECTIVE_LIMITS = `FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     LEFT JOIN workspaces o ON o.id = w.organisation_id
     WHERE m.role <> 'guest' AND w.kind IN ('team', 'organisation')`;

/**
 * The strictest session limits over the team workspaces (and organisations) the user is a member
 * of (not as a guest; deactivated or not), each raised to its organisation's floor: the policy
 * that applies to all their sessions. Nulls when none sets one.
 */
export async function sessionLimitsFor(userId: string): Promise<{ maxHours: number | null; idleMinutes: number | null }> {
  const r = await one<{ max_hours: number | null; idle_minutes: number | null }>(
    `SELECT min(LEAST(w.session_max_hours, o.session_max_hours)) AS max_hours,
       min(LEAST(w.session_idle_minutes, o.session_idle_minutes)) AS idle_minutes
     ${EFFECTIVE_LIMITS} AND m.user_id = $1`,
    [userId],
  );
  return { maxHours: r?.max_hours ?? null, idleMinutes: r?.idle_minutes ?? null };
}

/** Every person some team workspace (or its organisation) limits sessions for, with their strictest limits (the enforcement job). */
export async function allSessionLimits(): Promise<Array<{ userId: string; maxHours: number | null; idleMinutes: number | null }>> {
  const rows = await query<{ user_id: string; max_hours: number | null; idle_minutes: number | null }>(
    `SELECT m.user_id, min(LEAST(w.session_max_hours, o.session_max_hours)) AS max_hours,
       min(LEAST(w.session_idle_minutes, o.session_idle_minutes)) AS idle_minutes
     ${EFFECTIVE_LIMITS}
       AND (w.session_max_hours IS NOT NULL OR w.session_idle_minutes IS NOT NULL OR o.session_max_hours IS NOT NULL OR o.session_idle_minutes IS NOT NULL)
     GROUP BY m.user_id ORDER BY m.user_id`,
  );
  return rows.map((r) => ({ userId: r.user_id, maxHours: r.max_hours, idleMinutes: r.idle_minutes }));
}

/**
 * Names of the team workspaces the user is in (any role) that require two-step verification,
 * themselves or through their organisation, and of the organisations requiring it whose directory
 * they are in.
 */
export async function twoFactorRequiredBy(userId: string): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT w.name FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     LEFT JOIN workspaces o ON o.id = w.organisation_id
     WHERE m.user_id = $1 AND w.kind IN ('team', 'organisation') AND (w.require_two_factor OR coalesce(o.require_two_factor, false))
     ORDER BY w.name`,
    [userId],
  );
  return rows.map((r) => r.name);
}

/** Workspaces whose retention differs from the defaults: trash days and version-history days. */
export async function retentionOverrides(): Promise<Array<{ id: string; trashDays: number; versionDays: number | null; auditDays: number }>> {
  const rows = await query<{ id: string; trash_retention_days: number; version_retention_days: number | null; audit_retention_days: number }>(
    `SELECT id, trash_retention_days, version_retention_days, audit_retention_days FROM workspaces
     WHERE trash_retention_days <> 30 OR version_retention_days IS NOT NULL OR audit_retention_days <> 365`,
  );
  return rows.map((r) => ({ id: r.id, trashDays: r.trash_retention_days, versionDays: r.version_retention_days, auditDays: r.audit_retention_days }));
}

/** Deletes a team workspace (members, invites, projects cascade). False if it was not there. */
export async function deleteTeam(id: string): Promise<boolean> {
  return (await query(`DELETE FROM workspaces WHERE id = $1 AND kind = 'team' RETURNING 1`, [id])).length > 0;
}

/**
 * Inside `transaction()`: locks the workspace row until the transaction ends — 'update' for
 * changes that must see a stable member list (last-owner checks, deletion), 'share' for writes
 * that only need it to keep existing (creating a board in it). False if there is no such workspace.
 */
export async function lockWorkspace(id: string, mode: 'update' | 'share'): Promise<boolean> {
  const sql = mode === 'update' ? `SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE` : `SELECT 1 FROM workspaces WHERE id = $1 FOR SHARE`;
  return (await one(sql, [id])) !== null;
}

// ---- organisations (#108) ----

/** An organisation with its creator as owner, starting with no floors (inside a transaction). */
export async function insertOrganisation(id: string, name: string, ownerId: string, now: number): Promise<void> {
  await query(
    `INSERT INTO workspaces (id, name, kind, created_by, created_at, updated_at, guest_invites) VALUES ($1, $2, 'organisation', $3, $4, $4, $5)`,
    [id, name, ownerId, new Date(now), NO_FLOOR_POLICIES.guestInvites],
  );
  await query(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, 'owner', $3)`, [id, ownerId, new Date(now)]);
}

/** Attaches a team workspace to an organisation (or detaches it: null). False if it is not a team workspace. */
export async function setOrganisation(workspaceId: string, organisationId: string | null, now: number): Promise<boolean> {
  return (
    await query(
      `UPDATE workspaces SET organisation_id = $2::text,
         organisation_attached_at = CASE WHEN $2::text IS NULL THEN NULL ELSE $3::timestamptz END
       WHERE id = $1 AND kind = 'team' RETURNING 1`,
      [workspaceId, organisationId, new Date(now)],
    )
  ).length > 0;
}

/** The team workspaces attached to an organisation, oldest attachment first. */
export async function attachedWorkspaces(organisationId: string): Promise<Workspace[]> {
  return (await query<WsRow>(`${WS_SELECT} WHERE w.organisation_id = $1 ORDER BY w.organisation_attached_at, w.id`, [organisationId])).map(toWorkspace);
}

/** workspaceId -> its organisation's id, for those of `workspaceIds` that are attached to one. */
export async function organisationIdsOf(workspaceIds: string[]): Promise<Map<string, string>> {
  if (workspaceIds.length === 0) return new Map();
  const rows = await query<{ id: string; organisation_id: string }>(
    `SELECT id, organisation_id FROM workspaces WHERE id = ANY($1::text[]) AND organisation_id IS NOT NULL`,
    [workspaceIds],
  );
  return new Map(rows.map((r) => [r.id, r.organisation_id]));
}

/** Deletes an organisation (its directory cascades). False if it is not there or a workspace is still attached. */
export async function deleteOrganisation(id: string): Promise<boolean> {
  return (
    await query(
      `DELETE FROM workspaces WHERE id = $1 AND kind = 'organisation' AND NOT EXISTS (SELECT 1 FROM workspaces a WHERE a.organisation_id = $1) RETURNING 1`,
      [id],
    )
  ).length > 0;
}

/** How many organisations the user owns. */
export async function countOwnedOrganisations(userId: string): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 AND m.role = 'owner' AND w.kind = 'organisation'`,
    [userId],
  );
  return r?.n ?? 0;
}

/** Organisations whose directory the user is in, with their role there. */
export async function organisationMembershipsOf(userId: string): Promise<Array<{ workspaceId: string; role: WorkspaceRole }>> {
  return (
    await query<{ workspace_id: string; role: WorkspaceRole }>(
      `SELECT m.workspace_id, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.kind = 'organisation' ORDER BY m.workspace_id`,
      [userId],
    )
  ).map((r) => ({ workspaceId: r.workspace_id, role: r.role }));
}

/** How many team workspaces the user owns (the workspace quota). */
export async function countOwnedTeams(userId: string): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 AND m.role = 'owner' AND w.kind = 'team'`,
    [userId],
  );
  return r?.n ?? 0;
}

/** Inside `transaction()`: serializes quota-checked workspace creation of one user. */
export async function lockCreateQuota(userId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('workspaces.quota'), hashtext($1))`, [userId]);
}

// ---- members ----

export interface MemberRow {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: number;
  deactivatedAt: number | null;
  /** #151: an admin's scopes as stored (null: all three). Only meaningful for role 'admin'. */
  adminScopes: AdminScope[] | null;
}
interface MRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: Date;
  deactivated_at: Date | null;
  admin_scopes: AdminScope[] | null;
}
const toMember = (r: MRow): MemberRow => ({
  workspaceId: r.workspace_id,
  userId: r.user_id,
  role: r.role,
  createdAt: r.created_at.getTime(),
  deactivatedAt: r.deactivated_at ? r.deactivated_at.getTime() : null,
  adminScopes: r.role === 'admin' ? (r.admin_scopes ?? null) : null,
});

/**
 * #151: the role as it counts for board CONTENT — an admin without the content scope is a member
 * there (board access, projects, moving boards, templates). The SQL twin of roles.ts `contentRole`.
 */
const CONTENT_ROLE = `CASE WHEN m.role = 'admin' AND m.admin_scopes IS NOT NULL AND NOT ('content' = ANY(m.admin_scopes)) THEN 'member' ELSE m.role END`;

export async function getRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return (await one<{ role: WorkspaceRole }>(`SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]))?.role ?? null;
}

/** The user's role as it counts for board content (#151; see CONTENT_ROLE), or null. */
export async function getContentRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return (
    (await one<{ role: WorkspaceRole }>(`SELECT ${CONTENT_ROLE} AS role FROM workspace_members m WHERE m.workspace_id = $1 AND m.user_id = $2`, [workspaceId, userId]))
      ?.role ?? null
  );
}

/** Sets an admin's scopes (null: all three); false unless they are an admin there. */
export async function setAdminScopes(workspaceId: string, userId: string, scopes: AdminScope[] | null): Promise<boolean> {
  return (
    await query(`UPDATE workspace_members SET admin_scopes = $3 WHERE workspace_id = $1 AND user_id = $2 AND role = 'admin' RETURNING 1`, [
      workspaceId,
      userId,
      scopes,
    ])
  ).length > 0;
}

export async function getMember(workspaceId: string, userId: string): Promise<MemberRow | null> {
  const r = await one<MRow>(`SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
  return r ? toMember(r) : null;
}

/** Ids of the workspaces where the user is deactivated. */
export async function deactivatedIn(userId: string): Promise<Set<string>> {
  const rows = await query<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND deactivated_at IS NOT NULL`,
    [userId],
  );
  return new Set(rows.map((r) => r.workspace_id));
}

/** Deactivates (at) or reactivates (null) a member. False if they are not a member. */
export async function setDeactivated(workspaceId: string, userId: string, at: number | null): Promise<boolean> {
  return (
    await query(`UPDATE workspace_members SET deactivated_at = $3 WHERE workspace_id = $1 AND user_id = $2 RETURNING 1`, [
      workspaceId,
      userId,
      at === null ? null : new Date(at),
    ])
  ).length > 0;
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  return (await query<MRow>(`SELECT * FROM workspace_members WHERE workspace_id = $1 ORDER BY created_at, user_id`, [workspaceId])).map(toMember);
}

/** Adds a member unless they already are one; returns their role now, or null if the workspace (or user) is gone. */
export async function addMemberIfAbsent(workspaceId: string, userId: string, role: WorkspaceRole, now: number): Promise<WorkspaceRole | null> {
  try {
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [workspaceId, userId, role, new Date(now)],
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) return null;
    throw e;
  }
  return getRole(workspaceId, userId);
}

/**
 * Grants at least `role` (an invite being used): adds the member, or raises a lower role — never
 * lowers anyone and never touches an owner. False if the workspace (or user) is gone.
 */
export async function grantAtLeast(workspaceId: string, userId: string, role: InvitableWorkspaceRole, now: number): Promise<boolean> {
  const rank = (col: string) => `(CASE ${col} WHEN 'guest' THEN 1 WHEN 'member' THEN 2 WHEN 'admin' THEN 3 ELSE 4 END)`;
  try {
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role
         WHERE ${rank('workspace_members.role')} < ${rank('excluded.role')}`,
      [workspaceId, userId, role, new Date(now)],
    );
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

/** Returns false if they are not a member. */
export async function setRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<boolean> {
  // Scopes belong to the admin role (#151): leaving it clears them, so a later promotion starts with all three.
  return (
    await query(
      `UPDATE workspace_members SET role = $3, admin_scopes = CASE WHEN $3 = 'admin' THEN admin_scopes ELSE NULL END
       WHERE workspace_id = $1 AND user_id = $2 RETURNING 1`,
      [workspaceId, userId, role],
    )
  ).length > 0;
}

/** Removes a member and their place in the workspace's projects. False if they were not a member. */
export async function removeMember(workspaceId: string, userId: string): Promise<boolean> {
  await query(`DELETE FROM project_members WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE workspace_id = $1)`, [
    workspaceId,
    userId,
  ]);
  // #63: leaving the workspace leaves its groups (their grants reach nobody outside it).
  await query(`DELETE FROM workspace_group_members WHERE user_id = $2 AND group_id IN (SELECT id FROM workspace_groups WHERE workspace_id = $1)`, [workspaceId, userId]);
  return (await query(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING 1`, [workspaceId, userId])).length > 0;
}

/**
 * Is the user an active (not deactivated) owner, and the only one? Then they must stay: a
 * workspace always keeps an owner who can act.
 */
export async function isLastActiveOwner(workspaceId: string, userId: string): Promise<boolean> {
  const r = await one<{ me: boolean; others: number }>(
    `SELECT bool_or(user_id = $2) AS me, count(*) FILTER (WHERE user_id <> $2)::int AS others
     FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' AND deactivated_at IS NULL`,
    [workspaceId, userId],
  );
  return !!r?.me && r.others === 0;
}

/** Team workspaces the user is in, with their role there. */
export async function teamMembershipsOf(userId: string): Promise<Array<{ workspaceId: string; role: WorkspaceRole }>> {
  return (
    await query<{ workspace_id: string; role: WorkspaceRole }>(
      `SELECT m.workspace_id, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.kind = 'team' ORDER BY m.workspace_id`,
      [userId],
    )
  ).map((r) => ({ workspaceId: r.workspace_id, role: r.role }));
}

// ---- pending invites ----

export interface InviteRow {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableWorkspaceRole;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}
interface IRow {
  id: string;
  workspace_id: string;
  email: string;
  role: InvitableWorkspaceRole;
  invited_by: string;
  created_at: Date;
  expires_at: Date;
}
const toInvite = (r: IRow): InviteRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  email: r.email,
  role: r.role,
  invitedBy: r.invited_by,
  createdAt: r.created_at.getTime(),
  expiresAt: r.expires_at.getTime(),
});

/** Creates or renews (new token, role, expiry) the pending invite for (workspace, email); null if the workspace is gone. */
export async function saveInvite(i: {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableWorkspaceRole;
  tokenHash: string;
  invitedBy: string;
  now: number;
  expiresAt: number;
}): Promise<InviteRow | null> {
  try {
    const r = await one<IRow>(
      `INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workspace_id, email) DO UPDATE
         SET role = excluded.role, token_hash = excluded.token_hash, invited_by = excluded.invited_by,
             created_at = excluded.created_at, expires_at = excluded.expires_at
       RETURNING *`,
      [i.id, i.workspaceId, i.email, i.role, i.tokenHash, i.invitedBy, new Date(i.now), new Date(i.expiresAt)],
    );
    return r ? toInvite(r) : null;
  } catch (e) {
    if (isForeignKeyViolation(e)) return null;
    throw e;
  }
}

export async function listInvites(workspaceId: string): Promise<InviteRow[]> {
  return (await query<IRow>(`SELECT * FROM workspace_invites WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])).map(toInvite);
}

export async function findLiveInvite(tokenHash: string, now: number): Promise<InviteRow | null> {
  const r = await one<IRow>(`SELECT * FROM workspace_invites WHERE token_hash = $1 AND expires_at > $2`, [tokenHash, new Date(now)]);
  return r ? toInvite(r) : null;
}

/** Uses a live invite (deletes and returns it): of two concurrent uses exactly one gets it. */
export async function takeInvite(tokenHash: string, now: number): Promise<InviteRow | null> {
  const r = await one<IRow>(`DELETE FROM workspace_invites WHERE token_hash = $1 AND expires_at > $2 RETURNING *`, [tokenHash, new Date(now)]);
  return r ? toInvite(r) : null;
}

/** Whether a live invite was sent to `email` (an invite-only server lets that address sign up). */
export async function hasLiveInviteFor(email: string, now: number): Promise<boolean> {
  return (await query(`SELECT 1 FROM workspace_invites WHERE email = $1 AND expires_at > $2 LIMIT 1`, [email, new Date(now)])).length > 0;
}

export async function takeInvitesForEmail(email: string, now: number): Promise<InviteRow[]> {
  return (await query<IRow>(`DELETE FROM workspace_invites WHERE email = $1 AND expires_at > $2 RETURNING *`, [email, new Date(now)])).map(toInvite);
}

export async function renewInvite(workspaceId: string, id: string, tokenHash: string, now: number, expiresAt: number): Promise<InviteRow | null> {
  const r = await one<IRow>(
    `UPDATE workspace_invites SET token_hash = $3, created_at = $4, expires_at = $5 WHERE workspace_id = $1 AND id = $2 RETURNING *`,
    [workspaceId, id, tokenHash, new Date(now), new Date(expiresAt)],
  );
  return r ? toInvite(r) : null;
}

export async function deleteInvite(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM workspace_invites WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, id])).length > 0;
}

// ---- projects ----

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  access: ProjectAccess;
  /** The project's own team access level (null: the workspace's). */
  teamAccess: TeamAccess | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}
interface PRow {
  id: string;
  workspace_id: string;
  name: string;
  access: ProjectAccess;
  team_access: TeamAccess | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}
const toProject = (r: PRow): Project => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  access: r.access,
  teamAccess: r.team_access ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/** Inserts a project and makes its creator a member. False if the workspace is gone. */
export async function insertProject(p: Project): Promise<boolean> {
  try {
    await query(
      `INSERT INTO projects (id, workspace_id, name, access, created_by, created_at, updated_at, team_access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.id, p.workspaceId, p.name, p.access, p.createdBy, new Date(p.createdAt), new Date(p.updatedAt), p.teamAccess],
    );
    if (p.createdBy) await query(`INSERT INTO project_members (project_id, user_id, created_at) VALUES ($1, $2, $3)`, [p.id, p.createdBy, new Date(p.createdAt)]);
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function getProject(id: string): Promise<Project | null> {
  const r = await one<PRow>(`SELECT * FROM projects WHERE id = $1`, [id]);
  return r ? toProject(r) : null;
}

export async function getProjects(ids: string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  return (await query<PRow>(`SELECT * FROM projects WHERE id = ANY($1::text[])`, [ids])).map(toProject);
}

export async function projectsIn(workspaceIds: string[]): Promise<Project[]> {
  if (workspaceIds.length === 0) return [];
  return (await query<PRow>(`SELECT * FROM projects WHERE workspace_id = ANY($1::text[]) ORDER BY lower(name), id`, [workspaceIds])).map(toProject);
}

/** Changes only the given fields (`teamAccess: null`: back to the workspace's level). */
export async function updateProject(
  id: string,
  patch: { name?: string; access?: ProjectAccess; teamAccess?: TeamAccess | null },
  now: number,
): Promise<boolean> {
  return (
    await query(
      `UPDATE projects SET name = COALESCE($2, name), access = COALESCE($3, access), updated_at = $4,
         team_access = CASE WHEN $5::boolean THEN $6 ELSE team_access END
       WHERE id = $1 RETURNING 1`,
      [id, patch.name ?? null, patch.access ?? null, new Date(now), patch.teamAccess !== undefined, patch.teamAccess ?? null],
    )
  ).length > 0;
}

export async function deleteProject(id: string): Promise<boolean> {
  return (await query(`DELETE FROM projects WHERE id = $1 RETURNING 1`, [id])).length > 0;
}

/**
 * Inside `transaction()`: locks the project row until the transaction ends. Moving a board into a
 * project takes 'share', deleting the project 'update', so a board can never land in a project
 * that is being deleted. False if there is no such project (any more).
 */
export async function lockProject(id: string, mode: 'update' | 'share'): Promise<boolean> {
  const sql = mode === 'update' ? `SELECT 1 FROM projects WHERE id = $1 FOR UPDATE` : `SELECT 1 FROM projects WHERE id = $1 FOR SHARE`;
  return (await one(sql, [id])) !== null;
}

/** Ids of the projects (among `workspaceIds`) the user is a member of. */
/** Projects the user is in: added to it, or (#63) in a group of its workspace the project is shared with. */
export async function projectIdsOf(userId: string, workspaceIds: string[]): Promise<Set<string>> {
  if (workspaceIds.length === 0) return new Set();
  const rows = await query<{ project_id: string }>(
    `SELECT pm.project_id FROM project_members pm JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = $1 AND p.workspace_id = ANY($2::text[])
     UNION
     SELECT pg.project_id FROM project_groups pg JOIN projects p ON p.id = pg.project_id
       JOIN workspace_groups g ON g.id = pg.group_id AND g.workspace_id = p.workspace_id
       JOIN workspace_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     WHERE p.workspace_id = ANY($2::text[])`,
    [userId, workspaceIds],
  );
  return new Set(rows.map((r) => r.project_id));
}

/** Everyone in a project: added to it, or in a group it is shared with (#63; who the team gives its boards). */
export async function projectPeopleIds(projectId: string): Promise<string[]> {
  return (
    await query<{ user_id: string }>(
      `SELECT user_id FROM project_members WHERE project_id = $1
       UNION SELECT gm.user_id FROM project_groups pg JOIN projects p ON p.id = pg.project_id
         JOIN workspace_groups g ON g.id = pg.group_id AND g.workspace_id = p.workspace_id
         JOIN workspace_group_members gm ON gm.group_id = g.id WHERE pg.project_id = $1`,
      [projectId],
    )
  ).map((r) => r.user_id);
}

// ---- groups (#63) ----

export interface GroupRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: number;
  memberCount: number;
  guestCount: number;
}
const GROUP_SELECT = `SELECT g.id, g.workspace_id, g.name, g.created_at,
    (SELECT count(*)::int FROM workspace_group_members gm WHERE gm.group_id = g.id) AS member_count,
    (SELECT count(*)::int FROM workspace_group_members gm JOIN workspace_members m ON m.workspace_id = g.workspace_id AND m.user_id = gm.user_id
      WHERE gm.group_id = g.id AND m.role = 'guest') AS guest_count
  FROM workspace_groups g`;
const toGroup = (r: { id: string; workspace_id: string; name: string; created_at: Date; member_count: number; guest_count: number }): GroupRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  createdAt: r.created_at.getTime(),
  memberCount: r.member_count,
  guestCount: r.guest_count,
});

/** A new group; false when the workspace already has one of that name (any case). */
export async function insertGroup(id: string, workspaceId: string, name: string, by: string, now: number): Promise<boolean> {
  try {
    await query(`INSERT INTO workspace_groups (id, workspace_id, name, created_by, created_at) VALUES ($1, $2, $3, $4, $5)`, [id, workspaceId, name, by, new Date(now)]);
    return true;
  } catch (e) {
    if (isUniqueViolation(e, 'workspace_groups_name')) return false;
    throw e;
  }
}

/** Renames a group: true, false when it is gone, 'taken' when the name is another group's. */
export async function renameGroup(id: string, name: string): Promise<boolean | 'taken'> {
  try {
    return (await query(`UPDATE workspace_groups SET name = $2 WHERE id = $1 RETURNING 1`, [id, name])).length > 0;
  } catch (e) {
    if (isUniqueViolation(e, 'workspace_groups_name')) return 'taken';
    throw e;
  }
}

export async function deleteGroup(id: string): Promise<boolean> {
  return (await query(`DELETE FROM workspace_groups WHERE id = $1 RETURNING 1`, [id])).length > 0;
}

export async function getGroup(id: string): Promise<GroupRow | null> {
  const r = await one<Parameters<typeof toGroup>[0]>(`${GROUP_SELECT} WHERE g.id = $1`, [id]);
  return r ? toGroup(r) : null;
}

export async function groupsIn(workspaceId: string): Promise<GroupRow[]> {
  return (await query<Parameters<typeof toGroup>[0]>(`${GROUP_SELECT} WHERE g.workspace_id = $1 ORDER BY lower(g.name), g.id`, [workspaceId])).map(toGroup);
}

export async function groupMemberIds(groupId: string): Promise<string[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM workspace_group_members WHERE group_id = $1 ORDER BY added_at, user_id`, [groupId])).map((r) => r.user_id);
}

/** Adds a member to a group; false when already in it, or the group (or user) is gone. */
export async function addGroupMember(groupId: string, userId: string, now: number): Promise<boolean> {
  try {
    return (await query(`INSERT INTO workspace_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`, [groupId, userId, new Date(now)])).length > 0;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function removeGroupMember(groupId: string, userId: string): Promise<boolean> {
  return (await query(`DELETE FROM workspace_group_members WHERE group_id = $1 AND user_id = $2 RETURNING 1`, [groupId, userId])).length > 0;
}

/** The groups of a workspace the user is in. */
export async function groupIdsOf(workspaceId: string, userId: string): Promise<string[]> {
  return (
    await query<{ id: string }>(
      `SELECT g.id FROM workspace_groups g JOIN workspace_group_members gm ON gm.group_id = g.id WHERE g.workspace_id = $1 AND gm.user_id = $2`,
      [workspaceId, userId],
    )
  ).map((r) => r.id);
}

export async function addProjectGroup(projectId: string, groupId: string, now: number): Promise<boolean> {
  try {
    return (await query(`INSERT INTO project_groups (project_id, group_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`, [projectId, groupId, new Date(now)])).length > 0;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function removeProjectGroup(projectId: string, groupId: string): Promise<boolean> {
  return (await query(`DELETE FROM project_groups WHERE project_id = $1 AND group_id = $2 RETURNING 1`, [projectId, groupId])).length > 0;
}

export async function projectGroupIds(projectId: string): Promise<string[]> {
  return (await query<{ group_id: string }>(`SELECT group_id FROM project_groups WHERE project_id = $1`, [projectId])).map((r) => r.group_id);
}

/** Projects shared with a group (its boards follow the group's membership). */
export async function projectIdsOfGroup(groupId: string): Promise<string[]> {
  return (await query<{ project_id: string }>(`SELECT project_id FROM project_groups WHERE group_id = $1`, [groupId])).map((r) => r.project_id);
}

export async function projectMemberIds(projectId: string): Promise<string[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM project_members WHERE project_id = $1 ORDER BY created_at`, [projectId])).map(
    (r) => r.user_id,
  );
}

/** Adds a project member; false if the project (or user) is gone. */
export async function addProjectMember(projectId: string, userId: string, now: number): Promise<boolean> {
  try {
    await query(`INSERT INTO project_members (project_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
      projectId,
      userId,
      new Date(now),
    ]);
    return true;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  return (await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING 1`, [projectId, userId])).length > 0;
}
