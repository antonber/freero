// Public API of modules/scim [S2]: SCIM 2.0 provisioning per team workspace (the protocol under
// /scim/v2 and its admin API are this module's routes.ts).
import * as repo from './repo';

/** For a person's data export: what each workspace's directory sent about them. */
export async function scimRecordsOf(userId: string): Promise<unknown[]> {
  return (await repo.usersOf(userId)).map((u) => ({
    workspaceId: u.workspaceId,
    userName: u.userName,
    externalId: u.externalId,
    email: u.email,
    givenName: u.givenName,
    familyName: u.familyName,
    displayName: u.displayName,
    active: u.active,
    provisionedAt: new Date(u.createdAt).toISOString(),
    updatedAt: new Date(u.updatedAt).toISOString(),
  }));
}

/** For a workspace export: provisioned people and directory groups (no tokens). */
export async function scimExportOf(workspaceId: string): Promise<unknown> {
  const [users, groups, members] = await Promise.all([repo.listUsers(workspaceId), repo.listGroups(workspaceId), repo.membersByGroup(workspaceId)]);
  return {
    users: users.map((u) => ({ userId: u.userId, userName: u.userName, externalId: u.externalId, email: u.email, active: u.active })),
    groups: groups.map((g) => ({ id: g.id, displayName: g.displayName, externalId: g.externalId, mapping: g.mapping, memberIds: members.get(g.id) ?? [] })),
  };
}
