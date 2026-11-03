// #108: an organisation's provisioning — its directory groups grant membership of its workspaces,
// and deprovisioning someone closes every one of them at once.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser as createAccount } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { verifyDomainForTests } from '../sso/index';
import { attachWorkspace, createOrganisation, createTeamWorkspace, workspaceRole } from '../workspaces/index';
import { createGroup, createUser, replaceUser, setGroupMembers } from './service';
import { mapGroup } from './settings';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

it('a directory group mapped to one of the organisation’s workspaces brings its members in and takes them out again; deprovisioning closes all its workspaces; a workspace outside it can’t be mapped', async () => {
  const domain = `scim-org-${Date.now()}.test`;
  const owner = await createAccount({ name: 'Owner', email: `owner@${domain}`, password: 'password-123' }, { emailVerified: true });
  const org = await createOrganisation(owner.id, 'Directory Co');
  const [design, outside] = [await createTeamWorkspace(owner.id, 'Design'), await createTeamWorkspace(owner.id, 'Not in it')];
  await attachWorkspace(org.id, design.id, owner.id);
  await verifyDomainForTests(org.id, owner.id, domain);
  const board = await createBoard(owner.id, 'Sketches', '', 'none', { workspaceId: design.id, projectId: null });

  const alice = await createUser(org.id, { userName: `alice@${domain}`, emails: [{ value: `alice@${domain}`, primary: true }], active: true });
  const group = await createGroup(org.id, { displayName: 'Designers', members: [{ value: alice.userId }] });
  await expect(mapGroup(org.id, owner.id, group.id, { mapping: { kind: 'workspace', workspaceId: outside.id, role: 'member' } })).rejects.toMatchObject({ status: 400 });
  expect(await workspaceRole(outside.id, alice.userId)).toBeNull();

  await mapGroup(org.id, owner.id, group.id, { mapping: { kind: 'workspace', workspaceId: design.id, role: 'member' } });
  expect(await workspaceRole(design.id, alice.userId)).toBe('member');
  expect((await getBoardAccess(board.id, alice.userId)).role).toBe('editor');

  await setGroupMembers(org.id, group.id, []);
  expect(await workspaceRole(design.id, alice.userId)).toBeNull();

  await setGroupMembers(org.id, group.id, [alice.userId]);
  await replaceUser(org.id, alice.userId, { userName: `alice@${domain}`, emails: [{ value: `alice@${domain}`, primary: true }], active: false });
  // Still a member of Design, but the organisation-wide deactivation closes it.
  expect(await workspaceRole(design.id, alice.userId)).toBe('member');
  expect((await getBoardAccess(board.id, alice.userId)).role).toBeNull();
});
