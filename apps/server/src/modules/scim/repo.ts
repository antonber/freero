// The only writer of `scim_tokens`, `scim_users`, `scim_groups` and `scim_group_members` [S4].
import type { ScimGroupMapping } from '@freero/shared';
import { isForeignKeyViolation, isUniqueViolation, one, query, tx } from '../../platform/db';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

// ---- tokens ----

export interface TokenRecord {
  id: string;
  workspaceId: string;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}
interface TokenRow {
  id: string;
  workspace_id: string;
  label: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}
const toToken = (r: TokenRow): TokenRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  prefix: r.prefix,
  createdAt: r.created_at.getTime(),
  lastUsedAt: r.last_used_at?.getTime() ?? null,
});

export async function insertToken(t: { id: string; workspaceId: string; label: string; tokenHash: string; prefix: string; createdBy: string; now: number }): Promise<void> {
  await query(
    `INSERT INTO scim_tokens (id, workspace_id, label, token_hash, prefix, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [t.id, t.workspaceId, t.label, t.tokenHash, t.prefix, t.createdBy, new Date(t.now)],
  );
}

export async function listTokens(workspaceId: string): Promise<TokenRecord[]> {
  return (await query<TokenRow>(`SELECT * FROM scim_tokens WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toToken);
}

export async function countTokens(workspaceId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM scim_tokens WHERE workspace_id = $1`, [workspaceId]))?.n ?? 0;
}

export async function tokenByHash(tokenHash: string): Promise<TokenRecord | null> {
  const r = await one<TokenRow>(`SELECT * FROM scim_tokens WHERE token_hash = $1`, [tokenHash]);
  return r ? toToken(r) : null;
}

export async function touchToken(id: string, now: number): Promise<void> {
  await query(`UPDATE scim_tokens SET last_used_at = $2 WHERE id = $1`, [id, new Date(now)]);
}

export async function deleteToken(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM scim_tokens WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, id])).length > 0;
}

// ---- users ----

export interface ScimUser {
  workspaceId: string;
  userId: string;
  userName: string;
  externalId: string | null;
  email: string;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}
interface UserRow {
  workspace_id: string;
  user_id: string;
  user_name: string;
  external_id: string | null;
  email: string;
  given_name: string | null;
  family_name: string | null;
  display_name: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}
const toUser = (r: UserRow): ScimUser => ({
  workspaceId: r.workspace_id,
  userId: r.user_id,
  userName: r.user_name,
  externalId: r.external_id,
  email: r.email,
  givenName: r.given_name,
  familyName: r.family_name,
  displayName: r.display_name,
  active: r.active,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

export class UserNameTakenError extends Error {}

/** Inserts (false when the person is already provisioned here); UserNameTakenError on a userName clash. */
export async function insertUser(u: Omit<ScimUser, 'createdAt' | 'updatedAt'>, now: number): Promise<boolean> {
  try {
    const rows = await query(
      `INSERT INTO scim_users (workspace_id, user_id, user_name, external_id, email, given_name, family_name, display_name, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT (workspace_id, user_id) DO NOTHING RETURNING 1`,
      [u.workspaceId, u.userId, u.userName, u.externalId, u.email, u.givenName, u.familyName, u.displayName, u.active, new Date(now)],
    );
    return rows.length > 0;
  } catch (e) {
    if (isUniqueViolation(e, 'scim_users_user_name_key')) throw new UserNameTakenError();
    throw e;
  }
}

export async function updateUser(u: Omit<ScimUser, 'createdAt' | 'updatedAt'>, now: number): Promise<boolean> {
  try {
    const rows = await query(
      `UPDATE scim_users SET user_name = $3, external_id = $4, email = $5, given_name = $6, family_name = $7, display_name = $8, active = $9, updated_at = $10
       WHERE workspace_id = $1 AND user_id = $2 RETURNING 1`,
      [u.workspaceId, u.userId, u.userName, u.externalId, u.email, u.givenName, u.familyName, u.displayName, u.active, new Date(now)],
    );
    return rows.length > 0;
  } catch (e) {
    if (isUniqueViolation(e, 'scim_users_user_name_key')) throw new UserNameTakenError();
    throw e;
  }
}

export async function getUser(workspaceId: string, userId: string): Promise<ScimUser | null> {
  const r = await one<UserRow>(`SELECT * FROM scim_users WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
  return r ? toUser(r) : null;
}

export async function listUsers(workspaceId: string): Promise<ScimUser[]> {
  return (await query<UserRow>(`SELECT * FROM scim_users WHERE workspace_id = $1 ORDER BY created_at, user_id`, [workspaceId])).map(toUser);
}

export async function usersOf(userId: string): Promise<ScimUser[]> {
  return (await query<UserRow>(`SELECT * FROM scim_users WHERE user_id = $1`, [userId])).map(toUser);
}

/** Deletes the person's record and their group memberships in the workspace. */
export async function deleteUser(workspaceId: string, userId: string): Promise<boolean> {
  await query(`DELETE FROM scim_group_members WHERE user_id = $2 AND group_id IN (SELECT id FROM scim_groups WHERE workspace_id = $1)`, [workspaceId, userId]);
  return (await query(`DELETE FROM scim_users WHERE workspace_id = $1 AND user_id = $2 RETURNING 1`, [workspaceId, userId])).length > 0;
}

// ---- groups ----

export interface ScimGroup {
  id: string;
  workspaceId: string;
  displayName: string;
  externalId: string | null;
  mapping: ScimGroupMapping | null;
  createdAt: number;
  updatedAt: number;
}
interface GroupRow {
  id: string;
  workspace_id: string;
  display_name: string;
  external_id: string | null;
  mapping_kind: 'role' | 'project' | null;
  mapping_role: 'admin' | 'member' | 'guest' | null;
  mapping_project_id: string | null;
  created_at: Date;
  updated_at: Date;
}
const toGroup = (r: GroupRow): ScimGroup => ({
  id: r.id,
  workspaceId: r.workspace_id,
  displayName: r.display_name,
  externalId: r.external_id,
  mapping:
    r.mapping_kind === 'role' && r.mapping_role
      ? { kind: 'role', role: r.mapping_role }
      : r.mapping_kind === 'project' && r.mapping_project_id
        ? { kind: 'project', projectId: r.mapping_project_id }
        : null,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

export class GroupNameTakenError extends Error {}

export async function insertGroup(g: { id: string; workspaceId: string; displayName: string; externalId: string | null }, now: number): Promise<void> {
  try {
    await query(`INSERT INTO scim_groups (id, workspace_id, display_name, external_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`, [
      g.id,
      g.workspaceId,
      g.displayName,
      g.externalId,
      new Date(now),
    ]);
  } catch (e) {
    if (isUniqueViolation(e, 'scim_groups_display_name_key')) throw new GroupNameTakenError();
    throw e;
  }
}

export async function updateGroup(workspaceId: string, id: string, patch: { displayName: string; externalId: string | null }, now: number): Promise<boolean> {
  try {
    return (
      await query(`UPDATE scim_groups SET display_name = $3, external_id = $4, updated_at = $5 WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [
        workspaceId,
        id,
        patch.displayName,
        patch.externalId,
        new Date(now),
      ])
    ).length > 0;
  } catch (e) {
    if (isUniqueViolation(e, 'scim_groups_display_name_key')) throw new GroupNameTakenError();
    throw e;
  }
}

export async function setMapping(workspaceId: string, id: string, m: ScimGroupMapping | null, now: number): Promise<boolean> {
  try {
    return (
      await query(
        `UPDATE scim_groups SET mapping_kind = $3, mapping_role = $4, mapping_project_id = $5, updated_at = $6 WHERE workspace_id = $1 AND id = $2 RETURNING 1`,
        [workspaceId, id, m?.kind ?? null, m?.kind === 'role' ? m.role : null, m?.kind === 'project' ? m.projectId : null, new Date(now)],
      )
    ).length > 0;
  } catch (e) {
    if (isForeignKeyViolation(e)) return false;
    throw e;
  }
}

export async function getGroup(workspaceId: string, id: string): Promise<ScimGroup | null> {
  const r = await one<GroupRow>(`SELECT * FROM scim_groups WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
  return r ? toGroup(r) : null;
}

export async function listGroups(workspaceId: string): Promise<ScimGroup[]> {
  return (await query<GroupRow>(`SELECT * FROM scim_groups WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toGroup);
}

export async function deleteGroup(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM scim_groups WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [workspaceId, id])).length > 0;
}

/** groupId -> member user ids, for every group of the workspace. */
export async function membersByGroup(workspaceId: string): Promise<Map<string, string[]>> {
  const rows = await query<{ group_id: string; user_id: string }>(
    `SELECT m.group_id, m.user_id FROM scim_group_members m JOIN scim_groups g ON g.id = m.group_id WHERE g.workspace_id = $1 ORDER BY m.user_id`,
    [workspaceId],
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.group_id, [...(out.get(r.group_id) ?? []), r.user_id]);
  return out;
}

export async function groupMemberIds(groupId: string): Promise<string[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM scim_group_members WHERE group_id = $1 ORDER BY user_id`, [groupId])).map((r) => r.user_id);
}

/** Adds and removes members (only people provisioned in the group's workspace can be added). */
export async function changeMembers(groupId: string, workspaceId: string, add: string[], remove: string[]): Promise<void> {
  if (remove.length) await query(`DELETE FROM scim_group_members WHERE group_id = $1 AND user_id = ANY($2::text[])`, [groupId, remove]);
  if (add.length)
    await query(
      `INSERT INTO scim_group_members (group_id, user_id)
       SELECT $1, u.user_id FROM scim_users u WHERE u.workspace_id = $2 AND u.user_id = ANY($3::text[])
       ON CONFLICT DO NOTHING`,
      [groupId, workspaceId, add],
    );
}

/** The groups (of the workspace) a person is in. */
export async function groupsOfUser(workspaceId: string, userId: string): Promise<ScimGroup[]> {
  return (
    await query<GroupRow>(
      `SELECT g.* FROM scim_groups g JOIN scim_group_members m ON m.group_id = g.id WHERE g.workspace_id = $1 AND m.user_id = $2 ORDER BY g.created_at`,
      [workspaceId, userId],
    )
  ).map(toGroup);
}
