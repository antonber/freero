// Organisations above team workspaces (#108): who may attach a workspace, the floors an attached
// workspace can't get out from under, and what an organisation role does NOT give.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { inviteToWorkspace } from './invites';
import { addOrganisationMember, attachWorkspace, createOrganisation, detachWorkspace, organisationWorkspaceMembers, organisationWorkspaces } from './organisations';
import { createProject } from './projects';
import { boardAccess, changeRole, createTeamWorkspace, listWorkspaces, sessionLimitsFor, updateSettings, updateWorkspace } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@org.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team(owner: Account, people: Array<[Account, 'admin' | 'member' | 'guest']> = []) {
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  for (const [u, role] of people) await inviteToWorkspace(null, ws.id, owner, { email: u.email, role });
  return ws.id;
}

const placeOf = (id: string) => ({ workspaceId: id, projectId: null });
const organisationOf = async (u: Account, ws: string) => (await listWorkspaces(u.id)).find((w) => w.id === ws)?.organisation?.id ?? null;

it('only an owner of the workspace who also runs the organisation can attach it: not its admin, not an owner outside the organisation, not an org admin outside the workspace', async () => {
  const [wsOwner, wsAdmin, orgOwner] = await Promise.all(['WsOwner', 'WsAdmin', 'OrgOwner'].map(user));
  const ws = await team(wsOwner, [[wsAdmin, 'admin']]);
  const org = await createOrganisation(orgOwner.id, 'Acme');
  await expect(attachWorkspace(org.id, ws, orgOwner.id)).rejects.toMatchObject({ status: 404 }); // not in the workspace
  await expect(attachWorkspace(org.id, ws, wsOwner.id)).rejects.toMatchObject({ status: 404 }); // not in the organisation
  // The workspace's admin, even as an admin of the organisation, is not its owner.
  await addOrganisationMember(org.id, orgOwner.id, { email: wsAdmin.email, role: 'admin' });
  await expect(attachWorkspace(org.id, ws, wsAdmin.id)).rejects.toMatchObject({ status: 403 });
  // A plain member of the organisation who owns the workspace doesn't run the organisation.
  await addOrganisationMember(org.id, orgOwner.id, { email: wsOwner.email, role: 'member' });
  await expect(attachWorkspace(org.id, ws, wsOwner.id)).rejects.toMatchObject({ status: 403 });
  expect(await organisationOf(wsOwner, ws)).toBeNull();
  // Owner of the workspace and admin of the organisation: attached, and not into a second one.
  await addOrganisationMember(org.id, orgOwner.id, { email: wsOwner.email, role: 'admin' });
  await attachWorkspace(org.id, ws, wsOwner.id);
  expect(await organisationOf(wsOwner, ws)).toBe(org.id);
  const other = await createOrganisation(wsOwner.id, 'Other');
  await expect(attachWorkspace(other.id, ws, wsOwner.id)).rejects.toMatchObject({ status: 409 });
  expect(await organisationOf(wsOwner, ws)).toBe(org.id);
});

it('an attached workspace can’t get out from under its organisation’s floors: not by asking for less, not through a looser value it stored before, not by its owner detaching it', async () => {
  const [owner, outsider, member, teamOwner] = await Promise.all(['Owner', 'Outsider', 'Member', 'TeamOwner'].map(user));
  const ws = await team(owner, [[member, 'member']]);
  // Before joining, the team let links edit and anyone download.
  await updateWorkspace(ws, owner.id, { policies: { linkSharing: 'editor', downloads: 'anyone' } });
  const board = await createBoard(owner.id, 'Plan', '', 'editor', placeOf(ws));
  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('editor');

  const org = await createOrganisation(owner.id, 'Floors Inc');
  await attachWorkspace(org.id, ws, owner.id);
  await updateWorkspace(org.id, owner.id, { policies: { linkSharing: 'viewer', downloads: 'members' } });
  await updateSettings(org.id, owner.id, { sessionMaxHours: 8 });

  // The stored "editor" no longer counts: the floor holds where access is decided.
  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('viewer');
  expect((await boardAccess(member.id, placeOf(ws))).policies.downloads).toBe('members');
  expect((await sessionLimitsFor(member.id)).maxHours).toBe(8);
  // Asking for something looser is refused; stricter is fine.
  await expect(updateWorkspace(ws, owner.id, { policies: { linkSharing: 'editor' } })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await expect(updateSettings(ws, owner.id, { sessionMaxHours: 24 })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await expect(updateSettings(ws, owner.id, { sessionMaxHours: null })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await updateWorkspace(ws, owner.id, { policies: { linkSharing: 'none' } });
  expect((await getBoardAccess(board.id, outsider.id)).role).toBeNull();
  // The link policy too: a password required beats optional, the shorter lifetime wins.
  await updateWorkspace(ws, owner.id, { policies: { linkMaxDays: 90 } });
  await updateWorkspace(org.id, owner.id, { policies: { linkPassword: 'required', linkMaxDays: 30 } });
  expect((await boardAccess(member.id, placeOf(ws))).policies).toMatchObject({ linkPassword: 'required', linkMaxDays: 30 });
  await expect(updateWorkspace(ws, owner.id, { policies: { linkMaxDays: null } })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await expect(updateWorkspace(ws, owner.id, { policies: { linkPassword: 'optional' } })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await updateWorkspace(ws, owner.id, { policies: { linkMaxDays: 7 } });
  expect((await boardAccess(member.id, placeOf(ws))).policies.linkMaxDays).toBe(7);

  // A team owner who no longer runs the organisation can't detach their team to escape the floors.
  const ws2 = await team(teamOwner);
  await addOrganisationMember(org.id, owner.id, { email: teamOwner.email, role: 'admin' });
  await attachWorkspace(org.id, ws2, teamOwner.id);
  await changeRole(org.id, owner.id, teamOwner.id, 'member');
  await expect(detachWorkspace(org.id, ws2, teamOwner.id)).rejects.toMatchObject({ status: 403 });
  expect(await organisationOf(teamOwner, ws2)).toBe(org.id);
  // An organisation admin can detach; then the team's own (stricter) choices are what's left.
  await detachWorkspace(org.id, ws, owner.id);
  expect((await boardAccess(member.id, placeOf(ws))).policies.downloads).toBe('anyone');
  expect((await getBoardAccess(board.id, outsider.id)).role).toBeNull();
});

it('an organisation role reaches no board, no project and no workspace listing: its admins see who is in a workspace, not what is in it', async () => {
  const [owner, orgOwner] = await Promise.all(['Owner', 'OrgOwner'].map(user));
  const ws = await team(owner);
  const board = await createBoard(owner.id, 'Private plans', '', 'none', placeOf(ws));
  const org = await createOrganisation(orgOwner.id, 'Watchers');
  await addOrganisationMember(org.id, orgOwner.id, { email: owner.email, role: 'admin' });
  await attachWorkspace(org.id, ws, owner.id);

  expect((await organisationWorkspaces(org.id, orgOwner.id)).map((w) => [w.id, w.yourRole])).toEqual([[ws, null]]);
  expect((await organisationWorkspaceMembers(org.id, ws, orgOwner.id)).map((m) => m.userId)).toEqual([owner.id]);
  expect((await getBoardAccess(board.id, orgOwner.id)).role).toBeNull();
  // The organisation is not a workspace: not listed, and nothing that holds content goes into it.
  expect((await listWorkspaces(orgOwner.id)).some((w) => w.id === org.id)).toBe(false);
  await expect(createBoard(orgOwner.id, 'Sneaky', '', 'none', placeOf(org.id))).rejects.toMatchObject({ status: 404 });
  await expect(createProject(org.id, orgOwner.id, { name: 'Sneaky' })).rejects.toMatchObject({ status: 404 });
  await expect(inviteToWorkspace(null, org.id, orgOwner, { email: owner.email, role: 'member' })).rejects.toMatchObject({ status: 404 });
});
