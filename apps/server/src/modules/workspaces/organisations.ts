// Organisations above team workspaces (#108; docs/design/organisations.md). An organisation is a
// directory-only row of `workspaces` (kind 'organisation'): its members are its owners, admins and
// directory; its policy and security columns are floors for the team workspaces attached to it
// (workspaces.organisation_id), applied when any workspace is read (repo WS_SELECT). Single sign-on,
// provisioning, SIEM streams and the audit chain are keyed by its id like a workspace's.
//
// Who may do what:
// - create: any account (it becomes the owner), subject to domain control's creation check;
// - attach a team workspace: an OWNER of that workspace who is an owner/admin of the organisation;
// - detach: an owner/admin of the organisation (the workspace's owner alone can't: detaching would
//   be a way around the floors);
// - list workspaces, their members and owners: owners/admins of the organisation. An org role
//   never gives board access (rolesOf leaves organisations out).
import {
  MAX_ORGANISATIONS_PER_USER,
  WORKSPACE_CREATION_BLOCKED,
  type OrganisationSummary,
  type OrganisationWorkspace,
  type OrganisationWorkspaceMember,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { findUserByEmail, getUsers, normalizeEmail } from '../auth/index';
import { creationRefusal } from './creation';
import * as repo from './repo';
import type { Workspace } from './repo';
import { cleanName, refreshWorkspaceBoards, requireWorkspace } from './service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toSummary = (w: Workspace, role: WorkspaceRole, memberCount: number, workspaceCount: number): OrganisationSummary => ({
  id: w.id,
  name: w.name,
  kind: 'organisation',
  role,
  memberCount,
  // An organisation's own policies are its floors (teamAccess is not one; reported as the default).
  policies: w.ownPolicies,
  createdAt: w.createdAt,
  blocked: null,
  workspaceCount,
});

/** The organisation and the caller's role in its directory: 404 unless they are in it, 403 below `min`. */
export async function requireOrganisation(organisationId: string, userId: string, min: WorkspaceRole = 'admin'): Promise<{ organisation: Workspace; role: WorkspaceRole }> {
  const { workspace, role } = await requireWorkspace(organisationId, userId, min, { organisation: true });
  if (workspace.kind !== 'organisation') throw notFound('Organisation not found');
  return { organisation: workspace, role };
}

export async function listOrganisations(userId: string): Promise<OrganisationSummary[]> {
  const rows = await repo.organisationsOf(userId);
  return Promise.all(rows.map(async (r) => toSummary(r.workspace, r.role, r.memberCount, (await repo.attachedWorkspaces(r.workspace.id)).length)));
}

export async function organisationSummary(organisationId: string, userId: string): Promise<OrganisationSummary> {
  const row = (await repo.organisationsOf(userId)).find((r) => r.workspace.id === organisationId);
  if (!row) throw notFound('Workspace not found');
  return toSummary(row.workspace, row.role, row.memberCount, (await repo.attachedWorkspaces(organisationId)).length);
}

/** A new organisation with the caller as its owner and no floors yet (attaching a workspace changes nothing until it sets some). */
export async function createOrganisation(userId: string, nameIn: unknown): Promise<OrganisationSummary> {
  const name = cleanName(nameIn);
  // Someone whose address an organisation manages may be kept from starting their own (#64).
  const refusal = await creationRefusal(userId, name);
  if (refusal) throw new HttpError(403, refusal, WORKSPACE_CREATION_BLOCKED);
  const id = newId(12);
  await repo.transaction(async () => {
    await repo.lockCreateQuota(userId);
    if ((await repo.countOwnedOrganisations(userId)) >= MAX_ORGANISATIONS_PER_USER)
      throw forbidden(`You can own at most ${MAX_ORGANISATIONS_PER_USER} organisations.`);
    await repo.insertOrganisation(id, name, userId, Date.now());
    await recordAudit({ action: 'organisation.created', workspaceId: id, actorId: userId, target: { type: 'organisation', id, label: name } });
  });
  return organisationSummary(id, userId);
}

/** Locks two workspace rows in a fixed order (no crosswise waits); false if either is gone. */
async function lockBoth(a: string, b: string): Promise<boolean> {
  for (const id of [a, b].sort()) if (!(await repo.lockWorkspace(id, 'update'))) return false;
  return true;
}

const isActive = (m: repo.MemberRow | null, min: WorkspaceRole): boolean => {
  if (!m || m.deactivatedAt !== null) return false;
  const rank: Record<WorkspaceRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };
  return rank[m.role] >= rank[min];
};

async function toOrganisationWorkspace(w: Workspace, userId: string): Promise<OrganisationWorkspace> {
  const members = await repo.listMembers(w.id);
  const ownerIds = members.filter((m) => m.role === 'owner').map((m) => m.userId);
  const users = await getUsers(ownerIds);
  return {
    id: w.id,
    name: w.name,
    memberCount: members.length,
    owners: ownerIds.flatMap((id) => {
      const u = users.get(id);
      return u ? [{ userId: u.id, name: u.name, email: u.email }] : [];
    }),
    attachedAt: w.organisation?.attachedAt ?? w.updatedAt,
    policies: w.policies,
    yourRole: members.find((m) => m.userId === userId)?.role ?? null,
  };
}

/** The team workspaces attached to the organisation (its owners/admins). */
export async function organisationWorkspaces(organisationId: string, userId: string): Promise<OrganisationWorkspace[]> {
  await requireOrganisation(organisationId, userId, 'admin');
  return Promise.all((await repo.attachedWorkspaces(organisationId)).map((w) => toOrganisationWorkspace(w, userId)));
}

/** The members of one attached workspace (directory facts, never board content). */
export async function organisationWorkspaceMembers(organisationId: string, workspaceId: string, userId: string): Promise<OrganisationWorkspaceMember[]> {
  await requireOrganisation(organisationId, userId, 'admin');
  const w = await repo.getWorkspace(workspaceId);
  if (!w || w.organisation?.id !== organisationId) throw notFound('That workspace is not in this organisation');
  const rows = await repo.listMembers(workspaceId);
  const users = await getUsers(rows.map((r) => r.userId));
  return rows.flatMap((r) => {
    const u = users.get(r.userId);
    return u
      ? [{ userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role: r.role, joinedAt: r.createdAt, deactivated: r.deactivatedAt !== null }]
      : [];
  });
}

/**
 * Attaches a team workspace to the organisation. The caller must be an OWNER of the workspace and
 * an owner or admin of the organisation — both checked again under the two rows' locks, in the
 * transaction that attaches it. Its floors apply at once (board access is re-resolved everywhere).
 * Recorded in the workspace's log and, through the fan-out, the organisation's.
 */
export async function attachWorkspace(organisationId: string, workspaceIdIn: unknown, userId: string): Promise<OrganisationWorkspace> {
  if (typeof workspaceIdIn !== 'string' || !workspaceIdIn) throw badRequest('workspaceId is required');
  const workspaceId = workspaceIdIn;
  const { organisation } = await requireOrganisation(organisationId, userId, 'admin');
  const { workspace } = await requireWorkspace(workspaceId, userId, 'owner');
  if (workspace.kind !== 'team') throw badRequest('Only a team workspace can join an organisation');
  await repo.transaction(async () => {
    if (!(await lockBoth(organisationId, workspaceId))) throw notFound('Workspace not found');
    const [orgMember, wsMember, current] = await Promise.all([
      repo.getMember(organisationId, userId),
      repo.getMember(workspaceId, userId),
      repo.getWorkspace(workspaceId),
    ]);
    if (!isActive(orgMember, 'admin')) throw forbidden('Only owners and admins of the organisation can attach workspaces to it');
    if (!isActive(wsMember, 'owner')) throw forbidden('Only an owner of the workspace can attach it to an organisation');
    if (current?.organisation?.id === organisationId) return;
    if (current?.organisation) throw new HttpError(409, `${workspace.name} already belongs to ${current.organisation.name}. Its admins detach it first.`);
    if (!(await repo.setOrganisation(workspaceId, organisationId, Date.now()))) throw notFound('Workspace not found');
    await recordAudit({
      action: 'organisation.workspace_attached',
      workspaceId,
      actorId: userId,
      target: { type: 'workspace', id: workspaceId, label: workspace.name },
      metadata: { organisationId, organisation: organisation.name },
    });
  });
  await refreshWorkspaceBoards(workspaceId);
  return toOrganisationWorkspace((await repo.getWorkspace(workspaceId))!, userId);
}

/**
 * Detaches a workspace (owners/admins of the organisation; `actorId` null: the organisation being
 * dissolved). Recorded first, so the organisation's log has it too; its own settings apply again.
 */
export async function detachWorkspace(organisationId: string, workspaceId: string, actorId: string | null): Promise<void> {
  if (actorId) await requireOrganisation(organisationId, actorId, 'admin');
  await repo.transaction(async () => {
    if (!(await lockBoth(organisationId, workspaceId))) throw notFound('That workspace is not in this organisation');
    if (actorId && !isActive(await repo.getMember(organisationId, actorId), 'admin'))
      throw forbidden('Only owners and admins of the organisation can detach its workspaces');
    const w = await repo.getWorkspace(workspaceId);
    if (!w || w.organisation?.id !== organisationId) throw notFound('That workspace is not in this organisation');
    await recordAudit({
      action: 'organisation.workspace_detached',
      workspaceId,
      actorId,
      target: { type: 'workspace', id: workspaceId, label: w.name },
      metadata: { organisationId, organisation: w.organisation.name },
    });
    await repo.setOrganisation(workspaceId, null, Date.now());
  });
  await refreshWorkspaceBoards(workspaceId);
}

/**
 * Adds an existing Freero account to the organisation's directory (as admin: owners only), the way
 * a workspace adds an existing account. Nobody without an account: the organisation's people come
 * through its workspaces, SSO, provisioning or domain control.
 */
export async function addOrganisationMember(organisationId: string, actorId: string, body: { email?: unknown; role?: unknown }): Promise<WorkspaceMember> {
  const { role: mine } = await requireOrganisation(organisationId, actorId, 'admin');
  const role = body.role;
  if (role !== 'admin' && role !== 'member') throw badRequest('role must be admin or member');
  if (role === 'admin' && mine !== 'owner') throw forbidden('Only an owner of the organisation can add admins');
  const email = normalizeEmail(body.email);
  if (!email || !EMAIL_RE.test(email)) throw badRequest('Enter a valid email address');
  const person = await findUserByEmail(email);
  if (!person) throw notFound('Nobody has a Freero account with that address');
  await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(organisationId, 'update'))) throw notFound('Organisation not found');
    const before = await repo.getRole(organisationId, person.id);
    if (before === 'owner' || before === role || (before === 'admin' && role === 'member')) return;
    if (!(await repo.grantAtLeast(organisationId, person.id, role, Date.now()))) throw notFound('Organisation not found');
    await recordAudit({ action: 'organisation.member_added', workspaceId: organisationId, actorId, target: { type: 'user', id: person.id, label: email }, metadata: { role, previousRole: before } });
  });
  const r = (await repo.getMember(organisationId, person.id))!;
  return { userId: person.id, name: person.name, email: person.email, color: person.color, avatarUrl: person.avatarUrl, role: r.role, joinedAt: r.createdAt };
}

/** Deletes an organisation (an owner, typing its name), only once no workspace is attached. */
export async function deleteOrganisation(organisationId: string, userId: string, confirm: unknown): Promise<void> {
  const { organisation } = await requireOrganisation(organisationId, userId, 'owner');
  if (typeof confirm !== 'string' || confirm.trim() !== organisation.name) throw badRequest('Type the organisation’s name to confirm');
  await dissolve(organisation, userId);
}

async function dissolve(organisation: Workspace, actorId: string | null): Promise<void> {
  await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(organisation.id, 'update'))) return;
    if ((await repo.attachedWorkspaces(organisation.id)).length) throw new HttpError(409, 'Detach its workspaces first');
    await recordAudit({
      action: 'organisation.deleted',
      workspaceId: organisation.id,
      accountId: actorId,
      fanOut: false,
      actorId,
      target: { type: 'organisation', id: organisation.id, label: organisation.name },
    });
    await repo.deleteOrganisation(organisation.id);
  });
}

/**
 * Account purge: an organisation the person owns alone passes to its longest-standing admin, else
 * member; one nobody else is in has its workspaces detached and is dissolved. Idempotent.
 */
export async function handOverOrganisation(organisationId: string, userId: string): Promise<void> {
  const orphaned = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(organisationId, 'update'))) return null;
    const others = (await repo.listMembers(organisationId)).filter((m) => m.userId !== userId);
    const active = others.filter((m) => m.deactivatedAt === null);
    if (active.some((m) => m.role === 'owner')) return null;
    const heir = active.find((m) => m.role === 'admin') ?? active.find((m) => m.role === 'member') ?? others[0];
    if (!heir) return repo.getWorkspace(organisationId);
    await repo.setRole(organisationId, heir.userId, 'owner');
    await recordAudit({
      action: 'workspace.owner_inherited',
      workspaceId: organisationId,
      actorId: null,
      target: { type: 'user', id: heir.userId },
      metadata: { previousRole: heir.role, previousOwner: userId },
    });
    return null;
  });
  if (!orphaned) return;
  for (const w of await repo.attachedWorkspaces(organisationId)) await detachWorkspace(organisationId, w.id, null);
  await dissolve(orphaned, null);
}
