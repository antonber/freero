// Admin roles (#151): members, content and security admins each without the others' powers, in a
// workspace and in an organisation; only owners hand out scopes.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, AdminScope } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import {
  addOrganisationMember,
  changeWorkspaceRole,
  createOrganisation,
  createProject,
  createTeamWorkspace,
  inviteToWorkspace,
  setMemberDeactivated,
  updateWorkspace,
  updateWorkspaceSettings,
} from '../workspaces/index';
import { auditPage, requireAdmin } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@scopes.test.freero.app`, password: 'password-123' }, { emailVerified: true });

/** A team with `owner`, and each of `admins` an admin of just the scopes given. */
async function team(owner: Account, admins: Array<[Account, AdminScope[]]>, members: Account[] = []) {
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  for (const [u, scopes] of admins) {
    await inviteToWorkspace(null, ws, owner, { email: u.email, role: 'admin' });
    await changeWorkspaceRole(ws, owner.id, u.id, 'admin', scopes);
  }
  for (const u of members) await inviteToWorkspace(null, ws, owner, { email: u.email, role: 'member' });
  return ws;
}

const scopeRefusal = { status: 403, code: 'admin_scope_required' };

it('a content admin can’t touch security settings or the audit log, a security admin can’t change sharing or deactivate people, a members admin only manages people', async () => {
  const [owner, content, security, people, member] = await Promise.all(['Owner', 'Content', 'Security', 'People', 'Member'].map(user));
  const ws = await team(
    owner,
    [
      [content, ['content']],
      [security, ['security']],
      [people, ['members']],
    ],
    [member],
  );

  await expect(updateWorkspaceSettings(ws, content.id, { requireTwoFactor: false })).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspaceSettings(ws, content.id, { sessionMaxHours: 12 })).rejects.toMatchObject(scopeRefusal);
  await expect(requireAdmin(ws, content.id, { scope: 'security' })).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspaceSettings(ws, content.id, { trashRetentionDays: 10 })).resolves.toMatchObject({ trashRetentionDays: 10 });
  await expect(updateWorkspace(ws, content.id, { policies: { downloads: 'members' } })).resolves.toBeTruthy();

  await expect(updateWorkspace(ws, security.id, { policies: { linkSharing: 'editor' } })).rejects.toMatchObject(scopeRefusal);
  await expect(setMemberDeactivated(ws, security.id, member.id, true)).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspaceSettings(ws, security.id, { sessionMaxHours: 12 })).resolves.toMatchObject({ sessionMaxHours: 12 });
  // A settings change that mixes scopes is refused whole: nothing of it is stored.
  await expect(updateWorkspaceSettings(ws, security.id, { sessionMaxHours: 6, trashRetentionDays: 3 })).rejects.toMatchObject(scopeRefusal);

  await expect(updateWorkspaceSettings(ws, people.id, { sessionIdleMinutes: 60 })).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspace(ws, people.id, { policies: { downloads: 'anyone' } })).rejects.toMatchObject(scopeRefusal);
  await setMemberDeactivated(ws, people.id, member.id, true);

  // Every admin still reads what isn't anyone's to change (usage, the member list).
  for (const a of [content, security, people]) await expect(requireAdmin(ws, a.id)).resolves.toBeTruthy();
});

it('only an owner decides what an admin administers: an admin can’t widen their own scopes, and every change is in the log', async () => {
  const [owner, people] = await Promise.all(['Owner', 'People'].map(user));
  const ws = await team(owner, [[people, ['members']]]);
  await expect(changeWorkspaceRole(ws, people.id, people.id, 'admin', null)).rejects.toMatchObject({ status: 403 });
  await expect(changeWorkspaceRole(ws, people.id, people.id, 'admin', ['members', 'security'])).rejects.toMatchObject({ status: 403 });
  await expect(updateWorkspaceSettings(ws, people.id, { requireTwoFactor: false })).rejects.toMatchObject(scopeRefusal);

  await changeWorkspaceRole(ws, owner.id, people.id, 'admin', ['members', 'security']);
  await expect(updateWorkspaceSettings(ws, people.id, { sessionMaxHours: 24 })).resolves.toBeTruthy();
  const log = await auditPage({ workspaceId: ws, actions: ['member.admin_scopes_changed'] }, 10);
  expect(log.events[0]).toMatchObject({ actor: { id: owner.id }, metadata: { from: 'members', to: 'members,security' } });
  // Made a member and an admin again: they start over with everything, not the old scopes.
  await changeWorkspaceRole(ws, owner.id, people.id, 'member');
  await changeWorkspaceRole(ws, owner.id, people.id, 'admin');
  await expect(updateWorkspace(ws, people.id, { policies: { downloads: 'admins' } })).resolves.toBeTruthy();
});

it('an admin who doesn’t administer content opens boards like a member: nothing in a private project, the team’s level elsewhere', async () => {
  const [owner, security, content] = await Promise.all(['Owner', 'Security', 'Content'].map(user));
  const ws = await team(owner, [
    [security, ['security', 'members']],
    [content, ['content']],
  ]);
  await updateWorkspace(ws, owner.id, { policies: { teamAccess: 'viewer' } });
  const project = await createProject(ws, owner.id, { name: 'Board of directors', access: 'private' });
  const secret = await createBoard(owner.id, 'Secret', '', 'none', { workspaceId: ws, projectId: project.id });
  const open = await createBoard(owner.id, 'Open', '', 'none', { workspaceId: ws });

  expect((await getBoardAccess(secret.id, security.id)).role).toBeNull();
  expect((await getBoardAccess(open.id, security.id)).role).toBe('viewer');
  expect((await getBoardAccess(secret.id, content.id)).role).toBe('editor');
  expect((await getBoardAccess(open.id, content.id)).role).toBe('editor');
});

it('an organisation’s content admin can’t change its security floors, and its security admin can’t change its sharing floors', async () => {
  const [owner, content, security] = await Promise.all(['Owner', 'Content', 'Security'].map(user));
  const org = await createOrganisation(owner.id, `Org ${++n}`);
  for (const u of [content, security]) await addOrganisationMember(org.id, owner.id, { email: u.email, role: 'admin' });
  await changeWorkspaceRole(org.id, owner.id, content.id, 'admin', ['content']);
  await changeWorkspaceRole(org.id, owner.id, security.id, 'admin', ['security']);

  await expect(updateWorkspaceSettings(org.id, content.id, { requireTwoFactor: false })).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspace(org.id, security.id, { policies: { downloads: 'admins' } })).rejects.toMatchObject(scopeRefusal);
  await expect(updateWorkspace(org.id, content.id, { policies: { downloads: 'admins' } })).resolves.toBeTruthy();
});
