// Boards and projects shared with groups (#63): access follows the group — leaving it closes a board
// shared only with it on the next request and on an open socket; a group grant is never a way around
// the workspace's guest-invite policy; leaving the workspace leaves its groups.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { admitSocket } from '../realtime/index';
import {
  changeWorkspaceRole,
  createProject,
  createTeamWorkspace,
  inviteToWorkspace,
  createGroup,
  removeWorkspaceMember,
  setGroupMember,
  setProjectGroup,
} from '../workspaces/index';
import { shareBoardWithGroup } from './groups';

let wss: WebSocketServer;
let url = '';
/** Who the next socket is admitted as (the test's stand-in for a signed-in browser). */
let admitAs: { userId: string; boardId: string } | null = null;

beforeAll(async () => {
  await openTestDb();
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  wss.on('connection', (ws) => {
    const who = admitAs!;
    void admitSocket(ws, `s-${who.userId}`, async () => ({
      ...who,
      role: (await getBoardAccess(who.boardId, who.userId)).role ?? 'viewer',
      sessionKey: `s-${who.userId}`,
      identity: { id: who.userId, name: 'Someone', color: '#1C7ED6', avatarUrl: null },
    }));
  });
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => wss.close(r));
  await closeTestDb();
});

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@groups.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team(owner: Account, people: Array<[Account, 'admin' | 'member' | 'guest']>) {
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  for (const [u, role] of people) await inviteToWorkspace(null, ws, owner, { email: u.email, role });
  return ws;
}

it('taking someone out of a group closes a board shared only with that group, on their next request and on their open socket', async () => {
  const [owner, designer] = await Promise.all(['Owner', 'Designer'].map(user));
  const ws = await team(owner, [[designer, 'guest']]);
  const board = await createBoard(owner.id, 'Design review', '', 'none', { workspaceId: ws });
  expect((await getBoardAccess(board.id, designer.id)).role).toBeNull();

  const group = await createGroup(ws, owner.id, { name: 'Design' });
  await setGroupMember(group.id, owner.id, designer.id, true);
  await shareBoardWithGroup(board.id, owner.id, group.id, 'commenter');
  expect((await getBoardAccess(board.id, designer.id)).role).toBe('commenter');

  admitAs = { userId: designer.id, boardId: board.id };
  const socket = new WebSocket(`${url}/${board.id}`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise((r) => setTimeout(r, 100)); // admitted and in the room

  await setGroupMember(group.id, owner.id, designer.id, false);
  expect((await getBoardAccess(board.id, designer.id)).role).toBeNull();
  expect(await closed).toBe(4403);
});

it('a group grant is no way around the guest-invite policy: a member can’t share with a group that has guests in it while only admins invite guests', async () => {
  const [owner, member, colleague, contractor, contentAdmin] = await Promise.all(['Owner', 'Member', 'Colleague', 'Contractor', 'ContentAdmin'].map(user));
  const ws = await team(owner, [
    [member, 'member'],
    [colleague, 'member'],
    [contractor, 'guest'],
    [contentAdmin, 'admin'],
  ]);
  await changeWorkspaceRole(ws, owner.id, contentAdmin.id, 'admin', ['content']);
  // Making and filling groups is the members admins'.
  await expect(createGroup(ws, contentAdmin.id, { name: 'Nope' })).rejects.toMatchObject({ status: 403, code: 'admin_scope_required' });

  const staff = await createGroup(ws, owner.id, { name: 'Staff' });
  await setGroupMember(staff.id, owner.id, colleague.id, true);
  const outside = await createGroup(ws, owner.id, { name: 'Contractors' });
  await setGroupMember(outside.id, owner.id, contractor.id, true);
  const project = await createProject(ws, member.id, { name: 'Private', access: 'private' });
  const board = await createBoard(member.id, 'Plan', '', 'none', { workspaceId: ws, projectId: project.id });

  await shareBoardWithGroup(board.id, member.id, staff.id, 'editor');
  expect((await getBoardAccess(board.id, colleague.id)).role).toBe('editor');
  await expect(shareBoardWithGroup(board.id, member.id, outside.id, 'viewer')).rejects.toMatchObject({ status: 403 });
  expect((await getBoardAccess(board.id, contractor.id)).role).toBeNull();
  // The workspace's owners may invite guests, so they may share with the group.
  await shareBoardWithGroup(board.id, owner.id, outside.id, 'viewer');
  expect((await getBoardAccess(board.id, contractor.id)).role).toBe('viewer');
});

it('a project shared with a group opens its boards to the group’s members, and leaving the workspace leaves its groups', async () => {
  const [owner, analyst] = await Promise.all(['Owner', 'Analyst'].map(user));
  const ws = await team(owner, [[analyst, 'member']]);
  const project = await createProject(ws, owner.id, { name: 'Finance', access: 'private' });
  const board = await createBoard(owner.id, 'Budget', '', 'none', { workspaceId: ws, projectId: project.id });
  const shared = await createBoard(owner.id, 'Shared budget', '', 'none', { workspaceId: ws });
  const group = await createGroup(ws, owner.id, { name: 'Finance team' });
  await setGroupMember(group.id, owner.id, analyst.id, true);
  expect((await getBoardAccess(board.id, analyst.id)).role).toBeNull();

  await setProjectGroup(project.id, owner.id, group.id, true);
  await shareBoardWithGroup(shared.id, owner.id, group.id, 'editor');
  expect((await getBoardAccess(board.id, analyst.id)).role).toBe('editor');

  await removeWorkspaceMember(ws, owner.id, analyst.id);
  expect((await getBoardAccess(board.id, analyst.id)).role).toBeNull();
  // Not even by the board's grant: the group no longer holds them (and outside access stays open here).
  expect((await getBoardAccess(shared.id, analyst.id)).role).toBeNull();
});
