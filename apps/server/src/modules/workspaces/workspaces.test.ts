import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { purgeDueAccounts } from '../accounts/index';
import { createUser, scheduleAccountDeletion } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { inviteToWorkspace } from './invites';
import { createProject, deleteProject } from './projects';
import { onWorkspaceDeletionHold } from './holds';
import { changeRole, createTeamWorkspace, deleteWorkspace, listWorkspaces, removeMember, updateWorkspace } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@ws.test.freero.app`, password: 'password-123' }, { emailVerified: true });

/** A team owned by `owner` with the others added in the given roles. */
async function team(owner: Account, people: Array<[Account, 'admin' | 'member' | 'guest']>) {
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  for (const [u, role] of people) await inviteToWorkspace(null, ws.id, owner, { email: u.email, role });
  return ws.id;
}

const role = async (boardId: string, u: Account) => (await getBoardAccess(boardId, u.id)).role;

it('team members reach the team’s boards except private projects they are not in; guests and outsiders only what they were invited to', async () => {
  const [owner, admin, member, guest, outsider] = await Promise.all(['Owner', 'Admin', 'Member', 'Guest', 'Outsider'].map(user));
  const ws = await team(owner, [
    [admin, 'admin'],
    [member, 'member'],
    [guest, 'guest'],
  ]);
  const secret = await createProject(ws, owner.id, { name: 'Secret', access: 'private' });
  const open = await createBoard(owner.id, 'Open', '', 'none', { workspaceId: ws });
  const hidden = await createBoard(owner.id, 'Hidden', '', 'none', { workspaceId: ws, projectId: secret.id });

  expect(await role(open.id, member)).toBe('editor');
  expect(await role(hidden.id, member)).toBeNull();
  expect(await role(hidden.id, admin)).toBe('editor');
  expect(await role(open.id, guest)).toBeNull();
  expect(await role(open.id, outsider)).toBeNull();
  // (Direct board invites on top of this: scripts/verify.mjs, through the real share flow.)
  // Guests can't put boards into the team.
  await expect(createBoard(guest.id, 'Mine', '', 'none', { workspaceId: ws })).rejects.toMatchObject({ status: 403 });
});

it('a workspace never loses its last owner, even when its two owners demote each other at the same moment', async () => {
  const [a, b] = await Promise.all([user('OwnerA'), user('OwnerB')]);
  const ws = await team(a, [[b, 'admin']]);
  await changeRole(ws, a.id, b.id, 'owner');
  const results = await Promise.allSettled([changeRole(ws, a.id, b.id, 'admin'), changeRole(ws, b.id, a.id, 'admin')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const roles = await Promise.all([a, b].map(async (u) => (await listWorkspaces(u.id)).find((w) => w.id === ws)!.role));
  expect(roles.filter((r) => r === 'owner')).toHaveLength(1);
  // …and the remaining owner can't leave either.
  const owner = roles[0] === 'owner' ? a : b;
  await expect(removeMember(ws, owner.id, owner.id)).rejects.toMatchObject({ status: 409 });
});

it('removing someone from a team ends their access to its boards, and the boards they owned stay with the team', async () => {
  const [owner, leaving] = await Promise.all([user('Boss'), user('Leaver')]);
  const ws = await team(owner, [[leaving, 'member']]);
  const theirs = await createBoard(leaving.id, 'Their board', '', 'none', { workspaceId: ws });

  await removeMember(ws, owner.id, leaving.id);

  expect(await role(theirs.id, leaving)).toBeNull();
  expect((await getBoardAccess(theirs.id, owner.id)).role).toBe('owner');
});

it('"external sharing: nobody" cuts outsiders’ link access, and links never exceed the workspace’s maximum role', async () => {
  const [owner, member, outsider] = await Promise.all([user('Strict'), user('Inside'), user('Outside')]);
  const ws = await team(owner, [[member, 'member']]);
  const linked = await createBoard(owner.id, 'Linked', '', 'editor', { workspaceId: ws });
  expect(await role(linked.id, outsider)).toBe('editor');

  await updateWorkspace(ws, owner.id, { policies: { linkSharing: 'viewer' } });
  expect(await role(linked.id, outsider)).toBe('viewer');

  await updateWorkspace(ws, owner.id, { policies: { externalSharing: 'none' } });
  expect(await role(linked.id, outsider)).toBeNull();
  expect(await role(linked.id, member)).toBe('editor'); // the team itself is unaffected
});

it('a project with boards in it can’t be deleted (its private boards would open up to the whole team)', async () => {
  const owner = await user('Folder');
  const ws = await team(owner, []);
  const p = await createProject(ws, owner.id, { name: 'Plans', access: 'private' });
  await createBoard(owner.id, 'Plan', '', 'none', { workspaceId: ws, projectId: p.id });
  await expect(deleteProject(p.id, owner.id)).rejects.toMatchObject({ status: 409 });
});

it('deleting the account of a team’s only owner hands the team and their boards to the longest-standing admin; a team of one is deleted', async () => {
  const [founder, admin, member] = await Promise.all([user('Founder'), user('Heir'), user('Stays')]);
  const ws = await team(founder, [
    [member, 'member'],
    [admin, 'admin'],
  ]);
  const solo = await team(founder, []);
  const board = await createBoard(founder.id, 'Roadmap', '', 'none', { workspaceId: ws });
  const soloBoard = await createBoard(founder.id, 'Alone', '', 'none', { workspaceId: solo });

  await scheduleAccountDeletion(null, founder.id, 'password-123');
  await purgeDueAccounts(Date.now() + getConfig().accountDeletionGraceMs + 60_000);

  expect((await listWorkspaces(admin.id)).find((w) => w.id === ws)?.role).toBe('owner');
  expect((await getBoardAccess(board.id, admin.id)).role).toBe('owner');
  expect((await getBoardAccess(board.id, member.id)).role).toBe('editor');
  expect((await getBoardAccess(soloBoard.id, admin.id)).exists).toBe(false);
});

it('a retention or legal hold keeps a workspace and its boards from being deleted; without it the deletion goes through', async () => {
  const owner = await user('Held');
  const ws = await team(owner, []);
  const name = (await listWorkspaces(owner.id)).find((w) => w.id === ws)!.name;
  const board = await createBoard(owner.id, 'Evidence', '', 'none', { workspaceId: ws });
  const release = onWorkspaceDeletionHold((id) => (id === ws ? 'legal hold for case 42' : null));
  await expect(deleteWorkspace(null, ws, owner.id, name)).rejects.toMatchObject({ status: 409 });
  expect((await getBoardAccess(board.id, owner.id)).role).toBe('owner');
  release();
  await deleteWorkspace(null, ws, owner.id, name);
  expect((await getBoardAccess(board.id, owner.id)).exists).toBe(false);
});
