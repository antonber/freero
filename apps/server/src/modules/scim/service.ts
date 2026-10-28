// SCIM 2.0 provisioning of a team workspace (RFC 7643/7644), as Okta and Entra ID drive it.
//
// Users: a provisioned person is an account at one of the workspace's VERIFIED domains (the
// existing one, or a new passwordless, verified one) plus a scim_users record with what the
// directory sent. Active = member of the workspace; `active: false` (or DELETE) deprovisions with
// the admin console's deactivation (one mechanism: the `blocked` rule of members' resolveRole):
// they keep role and boards but open nothing in the workspace, their board sockets close on every
// instance, and — the account being the organization's (its domain) — every session they have
// ends, everywhere. A deactivated member can't sign in through the workspace's SSO; the
// directory's `active: true` reactivates them.
//
// Groups: stored as the directory sends them. What a group grants is mapped by the workspace's
// admins in Freero (not by the directory): a workspace ROLE (admin / member / guest — the highest
// mapped role of a person's groups wins; once any group maps a role, the directory owns the roles
// of the people it provisioned, and someone in no role group gets the default role), or a PROJECT
// (members of mapped groups are its members; projects mapped by groups are directory-managed for
// provisioned people). Owners are never changed by the directory.
import type { AuditAction, AuditMetadata } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { endSessionsOf, provisionDirectoryAccount, setAccountName } from '../auth/index';
import { defaultJoinRole, isOrganizationEmail } from '../sso/index';
import { applyDirectoryMembership, setDirectoryDeactivated, setDirectoryProjectMembership, type DirectoryRole } from '../workspaces/index';
import { getKey } from './filter';
import { scimBool } from './patch';
import * as repo from './repo';

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';

/** A SCIM protocol error (RFC 7644 §3.12). */
export class ScimError extends HttpError {
  constructor(status: number, detail: string, readonly scimType?: string) {
    super(status, detail);
  }
}

const base = () => `${getConfig().publicUrl ?? appUrl(null, '')}/scim/v2`;
const iso = (ms: number) => new Date(ms).toISOString();

// ---- representations ----

export function userResource(u: repo.ScimUser, groups: Array<{ id: string; displayName: string }>, baseUrl = base()) {
  const formatted = [u.givenName, u.familyName].filter(Boolean).join(' ') || null;
  return {
    schemas: [USER_SCHEMA],
    id: u.userId,
    ...(u.externalId ? { externalId: u.externalId } : {}),
    userName: u.userName,
    name: { ...(u.givenName ? { givenName: u.givenName } : {}), ...(u.familyName ? { familyName: u.familyName } : {}), ...(formatted ? { formatted } : {}) },
    ...(u.displayName ? { displayName: u.displayName } : {}),
    emails: [{ value: u.email, type: 'work', primary: true }],
    active: u.active,
    groups: groups.map((g) => ({ value: g.id, display: g.displayName, $ref: `${baseUrl}/Groups/${g.id}` })),
    meta: { resourceType: 'User', created: iso(u.createdAt), lastModified: iso(u.updatedAt), location: `${baseUrl}/Users/${u.userId}` },
  };
}

export function groupResource(g: repo.ScimGroup, members: Array<{ id: string; display: string }>, { withMembers = true } = {}, baseUrl = base()) {
  return {
    schemas: [GROUP_SCHEMA],
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.displayName,
    ...(withMembers ? { members: members.map((m) => ({ value: m.id, display: m.display, $ref: `${baseUrl}/Users/${m.id}` })) } : {}),
    meta: { resourceType: 'Group', created: iso(g.createdAt), lastModified: iso(g.updatedAt), location: `${baseUrl}/Groups/${g.id}` },
  };
}

const text = (v: unknown, max = 256): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The fields of a SCIM User body we store. */
export function readUser(body: unknown) {
  const userName = text(getKey(body, 'username'), 254);
  if (!userName) throw new ScimError(400, 'userName is required', 'invalidValue');
  const name = getKey(body, 'name');
  const emails = getKey(body, 'emails');
  const list = Array.isArray(emails) ? emails : [];
  const primary = list.find((e) => getKey(e, 'primary') === true || scimBool(getKey(e, 'primary')) === true) ?? list.find((e) => getKey(e, 'type') === 'work') ?? list[0];
  const email = (text(getKey(primary, 'value'), 254) ?? userName).toLowerCase();
  const active = getKey(body, 'active');
  return {
    userName,
    externalId: text(getKey(body, 'externalid'), 512),
    email,
    givenName: text(getKey(name, 'givenname')),
    familyName: text(getKey(name, 'familyname')),
    displayName: text(getKey(body, 'displayname')),
    active: active === undefined ? true : (scimBool(active) ?? true),
  };
}

const personName = (u: { displayName: string | null; givenName: string | null; familyName: string | null }) =>
  u.displayName ?? ([u.givenName, u.familyName].filter(Boolean).join(' ') || null);

// ---- effects in Freero ----

const RANK: Record<DirectoryRole, number> = { guest: 1, member: 2, admin: 3 };

/**
 * Puts a provisioned person where their record and groups say: deactivated in the workspace when
 * the directory says inactive; otherwise a member with the role their groups map to, and in exactly
 * the directory-managed projects their groups map to. `alsoProjects`: projects a change just
 * unmapped. Never reactivates someone (only the directory's active: false -> true does, below; an
 * admin's deactivation stands).
 */
export async function syncPerson(workspaceId: string, userId: string, alsoProjects: string[] = []): Promise<void> {
  const su = await repo.getUser(workspaceId, userId);
  if (!su) return;
  if (!su.active) {
    await deactivate(workspaceId, su.userId, true, async () => {});
    return;
  }
  const [all, mine] = await Promise.all([repo.listGroups(workspaceId), repo.groupsOfUser(workspaceId, userId)]);
  const roleMapped = all.some((g) => g.mapping?.kind === 'role');
  const roles = mine.flatMap((g) => (g.mapping?.kind === 'role' ? [g.mapping.role] : []));
  const role = roles.length ? roles.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : await defaultJoinRole(workspaceId);
  await applyDirectoryMembership(workspaceId, userId, role, { overwrite: roleMapped });
  const wanted = new Set(mine.flatMap((g) => (g.mapping?.kind === 'project' ? [g.mapping.projectId] : [])));
  const managed = new Set([...all.flatMap((g) => (g.mapping?.kind === 'project' ? [g.mapping.projectId] : [])), ...alsoProjects]);
  for (const p of managed) await setDirectoryProjectMembership(p, userId, wanted.has(p));
}

/** The admin console's deactivation, by the directory (SCIM errors for its refusals). True when it changed. */
async function deactivate(workspaceId: string, userId: string, deactivated: boolean, record: () => Promise<void>): Promise<boolean> {
  try {
    return await setDirectoryDeactivated(workspaceId, userId, deactivated, record);
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) throw new ScimError(409, e.message, 'mutability');
    throw e;
  }
}

/** An audit event of the directory (no person acted) about someone in the workspace. */
const directoryEvent = (action: AuditAction, workspaceId: string, su: { userId: string; email: string }, metadata: AuditMetadata = {}) =>
  recordAudit({ action, workspaceId, actorId: null, target: { type: 'user', id: su.userId, label: su.email }, metadata: { via: 'scim', ...metadata } });

/**
 * Deprovisioning: deactivated in the workspace (keeps role and boards, opens nothing there, live on
 * every instance) and — the account being the organization's (its verified domain) — signed out
 * everywhere. The audit event commits with the deactivation.
 */
async function deprovision(workspaceId: string, su: repo.ScimUser, action: 'scim.user_deprovisioned' | 'scim.user_deleted'): Promise<void> {
  const organization = await isOrganizationEmail(workspaceId, su.email);
  const metadata = { signedOutEverywhere: organization };
  const changed = await deactivate(workspaceId, su.userId, true, () => directoryEvent(action, workspaceId, su, metadata));
  if (!changed) await directoryEvent(action, workspaceId, su, { ...metadata, alreadyDeactivated: true });
  if (organization) await endSessionsOf(su.userId);
}

// ---- Users ----

export async function createUser(workspaceId: string, body: unknown): Promise<repo.ScimUser> {
  const u = readUser(body);
  if (!(await isOrganizationEmail(workspaceId, u.email)))
    throw new ScimError(400, `${u.email} is not at a domain this workspace has verified`, 'invalidValue');
  const name = personName(u);
  const account = await provisionDirectoryAccount(u.email, name);
  try {
    await repo.transaction(async () => {
      if (!(await repo.insertUser({ workspaceId, userId: account.userId, ...u }, Date.now())))
        throw new ScimError(409, 'This person is already provisioned in this workspace', 'uniqueness');
      await directoryEvent('scim.user_provisioned', workspaceId, { userId: account.userId, email: u.email }, { active: u.active, newAccount: account.created });
    });
  } catch (e) {
    if (e instanceof repo.UserNameTakenError) throw new ScimError(409, `userName ${u.userName} is already provisioned`, 'uniqueness');
    throw e;
  }
  if (name && !account.created) await setAccountName(account.userId, name);
  await syncPerson(workspaceId, account.userId);
  return (await repo.getUser(workspaceId, account.userId))!;
}

/** Replaces a person's attributes (PUT, or the result of a PATCH). The address can't move to another account. */
export async function replaceUser(workspaceId: string, userId: string, body: unknown): Promise<repo.ScimUser> {
  const prev = await repo.getUser(workspaceId, userId);
  if (!prev) throw new ScimError(404, 'User not found');
  const u = readUser(body);
  // The account's email stays: re-pointing a Freero account at another address is the person's
  // own (verified) change, not the directory's. The record keeps what the directory sent.
  if (u.email !== prev.email && !(await isOrganizationEmail(workspaceId, u.email)))
    throw new ScimError(400, `${u.email} is not at a domain this workspace has verified`, 'invalidValue');
  try {
    await repo.updateUser({ workspaceId, userId, ...u }, Date.now());
  } catch (e) {
    if (e instanceof repo.UserNameTakenError) throw new ScimError(409, `userName ${u.userName} is already provisioned`, 'uniqueness');
    throw e;
  }
  const name = personName(u);
  if (name && name !== personName(prev)) await setAccountName(userId, name);
  if (prev.active && !u.active) {
    await deprovision(workspaceId, prev, 'scim.user_deprovisioned');
  } else if (u.active) {
    if (!prev.active) {
      // Reactivated by the directory: the deactivation it made (or an admin's) is lifted.
      await syncPerson(workspaceId, userId); // a member again (if they had left meanwhile)
      const changed = await deactivate(workspaceId, userId, false, () => directoryEvent('scim.user_reactivated', workspaceId, { userId, email: u.email }));
      if (!changed) await directoryEvent('scim.user_reactivated', workspaceId, { userId, email: u.email });
    }
    await syncPerson(workspaceId, userId);
  }
  return (await repo.getUser(workspaceId, userId))!;
}

/**
 * DELETE: deprovisioned (deactivated, like `active: false`) and the directory's record of them is
 * gone. The account stays theirs; an admin reactivates them in the console if they come back.
 */
export async function deleteUser(workspaceId: string, userId: string): Promise<void> {
  const su = await repo.getUser(workspaceId, userId);
  if (!su) throw new ScimError(404, 'User not found');
  await deprovision(workspaceId, su, 'scim.user_deleted');
  await repo.deleteUser(workspaceId, userId);
}

// ---- Groups ----

function readMembers(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((m) => text(getKey(m, 'value'), 128)).filter((x): x is string => !!x);
}

export async function createGroup(workspaceId: string, body: unknown): Promise<repo.ScimGroup> {
  const displayName = text(getKey(body, 'displayname'), 256);
  if (!displayName) throw new ScimError(400, 'displayName is required', 'invalidValue');
  const id = newId(16);
  try {
    await repo.insertGroup({ id, workspaceId, displayName, externalId: text(getKey(body, 'externalid'), 512) }, Date.now());
  } catch (e) {
    if (e instanceof repo.GroupNameTakenError) throw new ScimError(409, `A group named ${displayName} exists`, 'uniqueness');
    throw e;
  }
  await setGroupMembers(workspaceId, id, readMembers(getKey(body, 'members')));
  log(`scim: created group ${id} in ${workspaceId}`);
  return (await repo.getGroup(workspaceId, id))!;
}

/** Makes the group's members exactly `wanted` (people not provisioned here are ignored) and syncs who changed. */
export async function setGroupMembers(workspaceId: string, groupId: string, wanted: string[]): Promise<void> {
  const current = new Set(await repo.groupMemberIds(groupId));
  const want = new Set(wanted);
  const add = [...want].filter((id) => !current.has(id));
  const remove = [...current].filter((id) => !want.has(id));
  await repo.changeMembers(groupId, workspaceId, add, remove);
  for (const id of [...add, ...remove]) await syncPerson(workspaceId, id);
}

export async function replaceGroup(workspaceId: string, groupId: string, body: unknown, { members }: { members: boolean }): Promise<repo.ScimGroup> {
  const g = await repo.getGroup(workspaceId, groupId);
  if (!g) throw new ScimError(404, 'Group not found');
  const displayName = text(getKey(body, 'displayname'), 256) ?? g.displayName;
  try {
    await repo.updateGroup(workspaceId, groupId, { displayName, externalId: text(getKey(body, 'externalid'), 512) ?? g.externalId }, Date.now());
  } catch (e) {
    if (e instanceof repo.GroupNameTakenError) throw new ScimError(409, `A group named ${displayName} exists`, 'uniqueness');
    throw e;
  }
  if (members) await setGroupMembers(workspaceId, groupId, readMembers(getKey(body, 'members')));
  return (await repo.getGroup(workspaceId, groupId))!;
}

export async function deleteGroup(workspaceId: string, groupId: string): Promise<void> {
  const g = await repo.getGroup(workspaceId, groupId);
  if (!g) throw new ScimError(404, 'Group not found');
  const members = await repo.groupMemberIds(groupId);
  await repo.deleteGroup(workspaceId, groupId);
  const unmapped = g.mapping?.kind === 'project' ? [g.mapping.projectId] : [];
  for (const id of members) await syncPerson(workspaceId, id, unmapped);
}

// ---- tokens (admins, in the app) ----

export const TOKEN_PREFIX = 'frscim_';
