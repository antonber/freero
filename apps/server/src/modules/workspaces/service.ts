// Workspaces: personal + team, members and roles, sharing policies, ownership transfer, and what
// a workspace grants on its boards (asked by modules/boards for every access decision).
import type { Request } from 'express';
import {
  WORKSPACE_SETTING_LIMITS,
  type LinkAccess,
  type Role,
  type TeamAccess,
  type WorkspaceBlock,
  type WorkspaceMember,
  type WorkspacePolicies,
  type WorkspaceRole,
  type WorkspaceSettings,
  type WorkspaceSummary,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { getUser, getUsers, hasTwoFactor } from '../auth/index';
import { deletionHoldOn } from './holds';
import {
  boardIdsInWorkspace,
  cleanUpDeletedBoards,
  countHeldBoards,
  deleteBoardRowsInWorkspace,
  transferBoardsOwnedIn,
} from '../boards/index';
import { removeBoardMemberships } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import { membershipChanged, recordMembershipChange } from './events';
import * as repo from './repo';
import type { Workspace } from './repo';
import {
  DEFAULT_POLICIES,
  isFullMember,
  isManager,
  isWorkspaceRole,
  LINK_VALUES,
  mayChangeRole,
  mayRemove,
  teamAccessOf,
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

const toSummary = (w: Workspace, role: WorkspaceRole, memberCount: number, blocked: WorkspaceBlock | null): WorkspaceSummary => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  role,
  memberCount,
  policies: w.policies,
  createdAt: w.createdAt,
  blocked,
});

/**
 * Why a workspace's boards are closed to the user, or null. One rule for lists, summaries and
 * every access decision (boardAccessLoader): deactivated there, or the workspace requires
 * two-step verification and they haven't turned it on.
 */
function blockOf(w: Workspace | undefined, deactivated: boolean, twoFactor: () => boolean): WorkspaceBlock | null {
  if (deactivated) return 'deactivated';
  if (w?.kind === 'team' && w.settings.requireTwoFactor && !twoFactor()) return 'two_factor_required';
  return null;
}

/** The user's deactivations and (only when some of `workspaces` needs it) their two-step status. */
async function blockInputs(userId: string, workspaces: Array<Workspace | undefined>): Promise<{ deactivated: Set<string>; twoFactor: boolean }> {
  const needs2fa = workspaces.some((w) => w?.kind === 'team' && w.settings.requireTwoFactor);
  const [deactivated, twoFactor] = await Promise.all([repo.deactivatedIn(userId), needs2fa ? hasTwoFactor(userId) : Promise.resolve(true)]);
  return { deactivated, twoFactor };
}

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  await ensurePersonalWorkspace(userId);
  const rows = await repo.workspacesOf(userId);
  const b = await blockInputs(userId, rows.map((r) => r.workspace));
  return rows.map((r) => toSummary(r.workspace, r.role, r.memberCount, blockOf(r.workspace, b.deactivated.has(r.workspace.id), () => b.twoFactor)));
}

export async function workspaceSummary(workspaceId: string, userId: string): Promise<WorkspaceSummary> {
  const row = (await repo.workspacesOf(userId)).find((r) => r.workspace.id === workspaceId);
  if (!row) throw notFound('Workspace not found');
  const b = await blockInputs(userId, [row.workspace]);
  return toSummary(row.workspace, row.role, row.memberCount, blockOf(row.workspace, b.deactivated.has(workspaceId), () => b.twoFactor));
}

const ROLE_RANK: Record<WorkspaceRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

/**
 * The workspace and the user's role there: 404 unless they are in it (a workspace you're not in
 * doesn't exist for you), 403 below `min`.
 */
export async function requireWorkspace(
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'guest',
  { allowDeactivated = false }: { allowDeactivated?: boolean } = {},
): Promise<{ workspace: Workspace; role: WorkspaceRole }> {
  const [workspace, member] = await Promise.all([repo.getWorkspace(workspaceId), repo.getMember(workspaceId, userId)]);
  if (!workspace || !member) throw notFound('Workspace not found');
  const role = member.role;
  // A deactivated member can do nothing in the workspace but leave it.
  if (member.deactivatedAt !== null && !allowDeactivated) throw forbidden('Your access to this workspace was deactivated by its admins');
  if (ROLE_RANK[role] < ROLE_RANK[min])
    throw forbidden(min === 'owner' ? 'Only a workspace owner can do that' : min === 'admin' ? 'Only workspace owners and admins can do that' : 'Guests can’t do that');
  return { workspace, role };
}

const teamOnly = (w: Workspace) => {
  if (w.kind !== 'team') throw badRequest('Your personal workspace has no members or policies. Create a team workspace to collaborate.');
};

export async function createTeamWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
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

/** Re-resolves everyone connected to the workspace's boards (on every instance). */
export async function refreshWorkspaceBoards(workspaceId: string): Promise<void> {
  for (const id of await boardIdsInWorkspace(workspaceId)) await refreshBoardAccess(id);
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
  return out;
}

/** Rename and/or change policies (owners/admins of a team workspace). Policy changes apply to live sessions at once. */
export async function updateWorkspace(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceSummary> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  teamOnly(workspace);
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    policies: cleanPolicies(body.policies),
  };
  const changedPolicies = (Object.keys(patch.policies) as Array<keyof WorkspacePolicies>).filter((k) => patch.policies[k] !== workspace.policies[k]);
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
        metadata: Object.fromEntries(changedPolicies.flatMap((k) => [[`${k}.from`, workspace.policies[k]], [`${k}.to`, patch.policies[k]!]])),
      });
  });
  if (Object.keys(patch.policies).length > 0) await refreshWorkspaceBoards(workspaceId);
  return workspaceSummary(workspaceId, userId);
}

// ---- security and retention settings (admin console) ----

export async function getSettings(workspaceId: string, userId: string): Promise<WorkspaceSettings> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  teamOnly(workspace);
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
  return out;
}

/**
 * Changes security / retention settings (owners and admins of a team workspace). Turning on the
 * two-step requirement needs it on for the person doing it, so nobody locks themselves out. Takes
 * effect at once: board access is re-checked everywhere (two-step requirement); sessions and
 * retention follow from the next request / job run.
 */
export async function updateSettings(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<WorkspaceSettings> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  teamOnly(workspace);
  const patch = cleanSettings(body);
  if (patch.requireTwoFactor && !workspace.settings.requireTwoFactor && !(await hasTwoFactor(userId)))
    throw forbidden('Turn on two-step verification for your own account first (Settings → Security)');
  const changed = (Object.keys(patch) as Array<keyof WorkspaceSettings>).filter((k) => patch[k] !== workspace.settings[k]);
  if (!changed.length) return workspace.settings;
  await repo.transaction(async () => {
    await repo.updateSettings(workspaceId, patch, Date.now());
    await recordAudit({
      action: 'workspace.settings_changed',
      actorId: userId,
      workspaceId,
      target: { type: 'workspace', id: workspaceId, label: workspace.name },
      metadata: Object.fromEntries(changed.flatMap((k) => [[`${k}.from`, workspace.settings[k]], [`${k}.to`, patch[k]!]])),
    });
  });
  if (changed.includes('requireTwoFactor')) await refreshWorkspaceBoards(workspaceId);
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
async function deleteTeamWorkspaceNow(workspace: Workspace, actorId: string | null): Promise<number | null | 'held'> {
  const workspaceId = workspace.id;
  const gone = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'update'))) return null;
    if (await countHeldBoards({ workspaceId })) return 'held' as const;
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
  if (gone === 'held') return 'held';
  if (gone) await cleanUpDeletedBoards(gone);
  return gone ? gone.length : null;
}

/**
 * Hands a team workspace to another member: they become an owner and the caller an admin, in one
 * transaction. Guests can't own a workspace.
 */
export async function transferWorkspace(workspaceId: string, userId: string, targetId: unknown): Promise<WorkspaceSummary> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  teamOnly(workspace);
  if (typeof targetId !== 'string' || !targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('You already own this workspace');
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    if ((await repo.getRole(workspaceId, userId)) !== 'owner') throw forbidden('Only a workspace owner can do that');
    const target = await repo.getRole(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (target === 'guest') throw badRequest('Make them a member first: guests can’t own a workspace');
    await repo.setRole(workspaceId, targetId, 'owner');
    await repo.setRole(workspaceId, userId, 'admin');
    await recordAudit({
      action: 'workspace.transferred',
      workspaceId,
      actorId: userId,
      target: { type: 'user', id: targetId, label: (await getUser(targetId))?.email ?? null },
      metadata: { previousOwnerRole: 'admin', newOwnerPreviousRole: target },
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
    if (u) out.push({ userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role: r.role, joinedAt: r.createdAt });
  }
  return out;
}

export async function memberOf(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  const [role, u] = await Promise.all([repo.getRole(workspaceId, userId), getUser(userId)]);
  if (!role || !u) return null;
  return { userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role, joinedAt: Date.now() };
}

const lastOwner = () => new HttpError(409, 'A workspace needs at least one owner. Make someone else an owner first.');

/** Changes a member's role; never leaves the workspace without an owner (checked under its lock). */
export async function changeRole(workspaceId: string, actorId: string, targetId: string, role: unknown): Promise<WorkspaceMember> {
  if (!isWorkspaceRole(role)) throw badRequest('role must be owner, admin, member or guest');
  const { workspace, role: actor } = await requireWorkspace(workspaceId, actorId, 'admin');
  teamOnly(workspace);
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    const from = await repo.getRole(workspaceId, targetId);
    if (!from) throw notFound('That person is not a member of this workspace');
    if (!mayChangeRole(actor, from, role)) throw forbidden('Only a workspace owner can change the role of owners and admins');
    if (from === 'owner' && role !== 'owner' && (await repo.isLastActiveOwner(workspaceId, targetId))) throw lastOwner();
    await repo.setRole(workspaceId, targetId, role);
    if (from !== role) await recordMembershipChange(workspaceId, targetId);
    if (from !== role)
      await recordAudit({ action: 'member.role_changed', workspaceId, actorId, target: await userTarget(targetId), metadata: { from, to: role } });
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
  const { workspace, role: actor } = await requireWorkspace(workspaceId, actorId, 'guest', { allowDeactivated: self });
  teamOnly(workspace);
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    const target = await repo.getRole(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (!self && !mayRemove(actor, target)) throw forbidden('Only a workspace owner can remove owners and admins');
    if (target === 'owner' && (await repo.isLastActiveOwner(workspaceId, targetId))) throw lastOwner();
    await repo.removeMember(workspaceId, targetId);
    await recordMembershipChange(workspaceId, targetId);
    const heir = self ? (await repo.listMembers(workspaceId)).find((m) => m.role === 'owner')!.userId : actorId;
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
 * Deactivates a member (owners: anyone else; admins: members and guests): they keep their role,
 * boards and invitations but open nothing in the workspace — not even boards they own — and can
 * do nothing there but leave, until reactivated. Their live connections lose access at once.
 * Only an owner deactivates an owner, so an active owner always remains.
 */
export async function setMemberDeactivated(workspaceId: string, actorId: string, targetId: string, deactivated: boolean): Promise<void> {
  const { workspace, role: actor } = await requireWorkspace(workspaceId, actorId, 'admin');
  teamOnly(workspace);
  if (actorId === targetId) throw badRequest('You can’t deactivate yourself');
  await repo.transaction(async () => {
    await repo.lockWorkspace(workspaceId, 'update');
    const target = await repo.getMember(workspaceId, targetId);
    if (!target) throw notFound('That person is not a member of this workspace');
    if (!mayRemove(actor, target.role)) throw forbidden('Only a workspace owner can deactivate owners and admins');
    if ((target.deactivatedAt !== null) === deactivated) return;
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
}

const DEFAULT_TRASH_DAYS = 30;

type BoardPlace = { workspaceId: string; projectId: string | null };

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
  const blocks = await blockInputs(userId, workspaces);
  return (b) => {
    const ws = wsById.get(b.workspaceId);
    const policies = ws?.policies ?? DEFAULT_POLICIES;
    const role = roles.get(b.workspaceId) ?? null;
    const project = b.projectId ? (projectById.get(b.projectId) ?? null) : null;
    const level = teamAccessOf(policies, project);
    return {
      team: ws?.kind === 'team' ? { name: ws.name, private: project?.access === 'private', access: level } : null,
      workspaceRole: role,
      policies,
      teamRole: teamRole(role, project ? { access: project.access, member: myProjects.has(project.id) } : null, level),
      inWorkspace: role !== null,
      outsidersBlocked: policies.externalSharing === 'none',
      maxLink: policies.linkSharing,
      anonymousLinks: policies.publicLinks === 'anyone',
      blocked: blockOf(ws, blocks.deactivated.has(b.workspaceId), () => blocks.twoFactor),
      trashRetentionDays: ws?.settings.trashRetentionDays ?? DEFAULT_TRASH_DAYS,
    };
  };
}

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
    const project = p.projectId ? (projectById.get(p.projectId) ?? null) : null;
    if (p.projectId && !project) return false;
    return teamRole('member', project ? { access: project.access, member: false } : null, teamAccessOf(ws.policies, project)) !== null;
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
  const [members, project, inProject] = await Promise.all([
    repo.listMembers(ws.id),
    place.projectId ? repo.getProject(place.projectId) : Promise.resolve(null),
    place.projectId ? repo.projectMemberIds(place.projectId) : Promise.resolve([] as string[]),
  ]);
  const inP = new Set(inProject);
  const level = teamAccessOf(ws.policies, project);
  const out: Array<{ userId: string; role: Role; workspaceRole: WorkspaceRole }> = [];
  for (const m of members) {
    if (m.deactivatedAt !== null) continue;
    const role = teamRole(m.role, project ? { access: project.access, member: inP.has(m.userId) } : null, level);
    if (role) out.push({ userId: m.userId, role, workspaceRole: m.role });
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
  const [members, project] = await Promise.all([
    repo.listMembers(ws.id),
    place.projectId ? repo.getProject(place.projectId) : Promise.resolve(null),
  ]);
  const admins = members.filter((m) => isManager(m.role)).map((m) => m.userId);
  const lead =
    project?.access === 'private' && project.createdBy && members.some((m) => m.userId === project.createdBy && isFullMember(m.role))
      ? project.createdBy
      : null;
  const deciders = lead && !admins.includes(lead) ? [...admins, lead] : admins;
  return { deciders, notify: project?.access === 'private' && lead ? [lead] : admins };
}

export async function teamMemberIds(place: BoardPlace): Promise<string[]> {
  return (await teamMembers(place)).map((m) => m.userId);
}

/** workspaceId -> the user's role, for every workspace they're in. */
export function workspaceRolesOf(userId: string): Promise<Map<string, WorkspaceRole>> {
  return repo.rolesOf(userId);
}

/** The user's role in one workspace, or null. */
export function workspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return repo.getRole(workspaceId, userId);
}

export async function getWorkspaceInfo(workspaceId: string): Promise<{ id: string; kind: 'personal' | 'team'; personalOf: string | null; name: string } | null> {
  const w = await repo.getWorkspace(workspaceId);
  return w ? { id: w.id, kind: w.kind, personalOf: w.personalOf, name: w.name } : null;
}

/**
 * Inside the caller's transaction: checks `userId` may create boards in the workspace (a member,
 * not a guest) and keeps the workspace from being deleted until that transaction ends.
 */
export async function lockWorkspaceForNewBoard(workspaceId: string, userId: string): Promise<void> {
  if (!(await repo.lockWorkspace(workspaceId, 'share'))) throw notFound('Workspace not found');
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
  members: Array<{ userId: string; role: WorkspaceRole; joinedAt: number; deactivated: boolean }>;
  projects: number;
  pendingInvites: number;
}> {
  const [members, projects, invites] = await Promise.all([repo.listMembers(workspaceId), repo.projectsIn([workspaceId]), repo.listInvites(workspaceId)]);
  return {
    members: members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.createdAt, deactivated: m.deactivatedAt !== null })),
    projects: projects.length,
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

/** Workspaces whose retention differs from the defaults (trash 30 days, versions kept, audit 365 days). */
export function retentionOverrides(): Promise<Array<{ id: string; trashDays: number; versionDays: number | null; auditDays: number }>> {
  return repo.retentionOverrides();
}

/** Team workspaces whose log shows an account's own events: those the person is a member (not guest) of. */
export async function auditScopeOf(userId: string): Promise<string[]> {
  return (await repo.teamMembershipsOf(userId)).filter((m) => isFullMember(m.role)).map((m) => m.workspaceId);
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
    if (orphaned && (await deleteTeamWorkspaceNow(orphaned, null)) === 'held') held++;
  }
  return { held };
}
