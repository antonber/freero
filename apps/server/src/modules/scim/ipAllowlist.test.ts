// #156: an IP allowlist limits where people open boards from, not the directory — the identity
// provider's SCIM calls (and SSO's just-in-time joins, the same membership path) come from its own
// servers and keep working; what they provision still opens nothing from outside the networks.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { runWithRequestContext } from '../../platform/requestContext';
import { createUser as createAccount } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { verifyDomainForTests } from '../sso/index';
import { createTeamWorkspace, updateWorkspaceSettings, workspaceRole } from '../workspaces/index';
import { createGroup, createUser } from './service';
import { mapGroup } from './settings';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const IDP = '198.51.100.20';
const from = <T>(ip: string, fn: () => Promise<T>): Promise<T> => runWithRequestContext({ reqId: `test-${ip}`, userId: null, ip, userAgent: null }, fn);

it('provisioning from the identity provider works from outside the allowed networks, and what it provisions still opens nothing from there', async () => {
  const domain = `scim-ip-${Date.now()}.test`;
  const owner = await createAccount({ name: 'Owner', email: `owner@${domain}`, password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Locked down');
  await verifyDomainForTests(ws.id, owner.id, domain);
  await from('10.0.0.5', () => updateWorkspaceSettings(ws.id, owner.id, { ipAllowlist: ['10.0.0.0/8'] }));
  const board = await createBoard(owner.id, 'Plans', '', 'none', { workspaceId: ws.id, projectId: null });

  const bob = await from(IDP, () => createUser(ws.id, { userName: `bob@${domain}`, emails: [{ value: `bob@${domain}`, primary: true }], active: true }));
  const group = await from(IDP, () => createGroup(ws.id, { displayName: 'Everyone', members: [{ value: bob.userId }] }));
  await mapGroup(ws.id, owner.id, group.id, { mapping: { kind: 'role', role: 'member' } });
  expect(await workspaceRole(ws.id, bob.userId)).toBe('member');

  expect((await from(IDP, () => getBoardAccess(board.id, bob.userId))).role).toBeNull();
  expect((await from('10.1.2.3', () => getBoardAccess(board.id, bob.userId))).role).toBe('editor');
});
