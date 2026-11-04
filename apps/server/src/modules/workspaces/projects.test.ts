// Nested projects (#129): access is inherited and only ever narrows on the way down.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { inviteToWorkspace } from './invites';
import { addProjectMember, createProject, deleteProject, listProjects, updateProject } from './projects';
import { createTeamWorkspace, teamMemberIds } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@projects.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team(owner: Account, members: Account[]) {
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  for (const u of members) await inviteToWorkspace(null, ws.id, owner, { email: u.email, role: 'member' });
  return ws.id;
}
const role = async (boardId: string, u: Account) => (await getBoardAccess(boardId, u.id)).role;
const sees = async (ws: string, u: Account, projectId: string) => (await listProjects(ws, u.id)).some((p) => p.id === projectId);

it('moving an open project into a private one closes its boards to everyone outside the private project, and its creator can’t lift it back out', async () => {
  const [owner, lead, insider, outsider] = await Promise.all(['Owner', 'Lead', 'Insider', 'Outsider'].map(user));
  const ws = await team(owner, [lead, insider, outsider]);
  const secret = await createProject(ws, owner.id, { name: 'Secret', access: 'private' });
  await addProjectMember(secret.id, owner.id, insider.id);
  await addProjectMember(secret.id, owner.id, lead.id);
  // The lead's own open project: the whole team reaches its board.
  const open = await createProject(ws, lead.id, { name: 'Roadmap' });
  const board = await createBoard(lead.id, 'Plan', '', 'none', { workspaceId: ws, projectId: open.id });
  expect(await role(board.id, outsider)).toBe('editor');

  await updateProject(open.id, lead.id, { parentId: secret.id });

  // Still "open", but only inside the private project now: the board, the project and the
  // people the team gives the board (share dialog, notifications) all follow.
  expect(await role(board.id, outsider)).toBeNull();
  expect(await sees(ws, outsider, open.id)).toBe(false);
  expect(await teamMemberIds({ workspaceId: ws, projectId: open.id })).not.toContain(outsider.id);
  expect(await role(board.id, insider)).toBe('editor');
  // Taking it out again would reopen it to the team: only whoever manages "Secret" may.
  await expect(updateProject(open.id, lead.id, { parentId: null })).rejects.toMatchObject({ status: 403 });
  expect(await role(board.id, outsider)).toBeNull();
});

it('a sub-project can’t give the team a higher access level than the project it is in', async () => {
  const [owner, member] = await Promise.all([user('Owner'), user('Member')]);
  const ws = await team(owner, [member]);
  const parent = await createProject(ws, owner.id, { name: 'Read only', teamAccess: 'viewer' });
  const child = await createProject(ws, owner.id, { name: 'Child', parentId: parent.id, teamAccess: 'editor' });
  const board = await createBoard(owner.id, 'Inside', '', 'none', { workspaceId: ws, projectId: child.id });
  expect(await role(board.id, member)).toBe('viewer');
  // …while a stricter child narrows an open parent.
  await updateProject(parent.id, owner.id, { teamAccess: null });
  await updateProject(child.id, owner.id, { teamAccess: 'commenter' });
  expect(await role(board.id, member)).toBe('commenter');
});

it('deleting a project with boards moves them into its parent project, never out to the whole workspace', async () => {
  const [owner, member, outsider] = await Promise.all([user('Owner'), user('Member'), user('Outsider')]);
  const ws = await team(owner, [member, outsider]);
  const secret = await createProject(ws, owner.id, { name: 'Secret', access: 'private' });
  await addProjectMember(secret.id, owner.id, member.id);
  const child = await createProject(ws, owner.id, { name: 'Sprint', parentId: secret.id });
  const board = await createBoard(owner.id, 'Notes', '', 'none', { workspaceId: ws, projectId: child.id });

  // Without saying what happens to its boards, a project that holds some stays (older clients).
  await expect(deleteProject(child.id, owner.id)).rejects.toMatchObject({ status: 409 });
  // The parent can't go while it holds a sub-project: that would lift the child to the top.
  await expect(deleteProject(secret.id, owner.id, { boards: 'parent' })).rejects.toMatchObject({ status: 409 });

  await deleteProject(child.id, owner.id, { boards: 'parent' });

  expect(await role(board.id, member)).toBe('editor');
  expect(await role(board.id, outsider)).toBeNull();
  // Trashing other people's boards with it is for content admins, not the project's creator.
  const theirs = await createBoard(owner.id, 'Owner’s', '', 'none', { workspaceId: ws, projectId: secret.id });
  const mine = await createProject(ws, member.id, { name: 'Mine', parentId: secret.id });
  await createBoard(owner.id, 'Owner’s too', '', 'none', { workspaceId: ws, projectId: mine.id });
  await expect(deleteProject(mine.id, member.id, { boards: 'trash' })).rejects.toMatchObject({ status: 403 });
  expect(await role(theirs.id, member)).toBe('editor');
});
