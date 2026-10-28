import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { createProject, createTeamWorkspace, inviteToWorkspace, setMemberDeactivated, updateWorkspace } from '../workspaces/index';
import { decideRequest, listRequests, requestAccess, requestOutcomes, requestState } from './accessRequests';
import { onAccessRequested, type AccessRequestedEvent } from './events';

const requested: AccessRequestedEvent[] = [];
beforeAll(async () => {
  await openTestDb();
  onAccessRequested((e) => void requested.push(e));
});
afterAll(() => closeTestDb());

let n = 0;
const person = async (name: string): Promise<Account> =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@ask.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);

it('asking twice files one request; the first approver lets them in at the role they chose, a second decision is refused', async () => {
  const [owner, asker] = await Promise.all([person('Owner'), person('Asker')]);
  const board = await createBoard(owner.id, 'Plans', '', 'none');
  const both = await Promise.allSettled([requestAccess(board.id, asker, { role: 'editor', message: 'For the offsite' }), requestAccess(board.id, asker, { role: 'editor' })]);
  expect(both.every((r) => r.status === 'fulfilled')).toBe(true);
  expect(await listRequests(board.id, owner.id)).toHaveLength(1);
  expect(requested.filter((e) => e.boardId === board.id)).toHaveLength(1);

  await decideRequest(board.id, owner, asker.id, { decision: 'approve', role: 'commenter' });
  await expect(decideRequest(board.id, owner, asker.id, { decision: 'deny' })).rejects.toMatchObject({ status: 409 });
  expect((await getBoardAccess(board.id, asker.id)).role).toBe('commenter');
  expect(await requestState(board.id, asker.id)).toMatchObject({ status: 'granted', role: 'commenter' });
  // The owner's notification now shows the outcome instead of the buttons.
  const outcome = await requestOutcomes(owner.id, [{ boardId: board.id, requesterId: asker.id, createdAt: Date.now() }]);
  expect(outcome.get(`${board.id}:${asker.id}`)).toMatchObject({ status: 'approved', decidedRole: 'commenter', canDecide: false });
});

it('a declined request can’t be repeated right away, and gives no access', async () => {
  const [owner, asker] = await Promise.all([person('Keeper'), person('Curious')]);
  const board = await createBoard(owner.id, 'Merger', '', 'none');
  await requestAccess(board.id, asker, {});
  await decideRequest(board.id, owner, asker.id, { decision: 'deny' });

  expect(await requestState(board.id, asker.id)).toMatchObject({ status: 'denied', canRequest: false });
  await expect(requestAccess(board.id, asker, {})).rejects.toMatchObject({ status: 429 });
  expect((await getBoardAccess(board.id, asker.id)).role).toBeNull();
});

it('a private project’s board: its creator and the admins decide, the creator (not every admin) is told; plain members can’t decide', async () => {
  const [owner, admin, lead, member, asker] = await Promise.all([person('WsOwner'), person('WsAdmin'), person('Lead'), person('Plain'), person('Outsider')]);
  const ws = await createTeamWorkspace(owner.id, 'Acme');
  for (const [u, role] of [
    [admin, 'admin'],
    [lead, 'member'],
    [member, 'member'],
  ] as const)
    await inviteToWorkspace(null, ws.id, owner, { email: u.email, role });
  const project = await createProject(ws.id, lead.id, { name: 'Skunkworks', access: 'private' });
  const board = await createBoard(owner.id, 'Specs', '', 'none', { workspaceId: ws.id, projectId: project.id });

  await requestAccess(board.id, asker, { role: 'viewer' });
  expect(requested.find((e) => e.boardId === board.id)?.recipientIds.sort()).toEqual([owner.id, lead.id].sort());

  await expect(decideRequest(board.id, member, asker.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 });
  await expect(listRequests(board.id, asker.id)).rejects.toMatchObject({ status: 403 });
  await decideRequest(board.id, admin, asker.id, { decision: 'approve' });
  expect((await getBoardAccess(board.id, asker.id)).role).toBe('viewer');
});

it('when the team keeps its boards to its own people, outsiders can’t ask — and nobody can let them in', async () => {
  const [owner, asker] = await Promise.all([person('Closed'), person('Knocking')]);
  const ws = await createTeamWorkspace(owner.id, 'Vault');
  const board = await createBoard(owner.id, 'Ledger', '', 'none', { workspaceId: ws.id });
  await requestAccess(board.id, asker, {});
  await updateWorkspace(ws.id, owner.id, { policies: { externalSharing: 'none' } });

  expect(await requestState(board.id, asker.id)).toMatchObject({ canRequest: false });
  await expect(decideRequest(board.id, owner, asker.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 });
  expect((await getBoardAccess(board.id, asker.id)).role).toBeNull();
});

it('a deactivated member can neither ask for nor be let into a board of the team that paused them', async () => {
  const [owner, paused] = await Promise.all([person('Pauser'), person('Paused')]);
  const ws = await createTeamWorkspace(owner.id, 'Paused team');
  await inviteToWorkspace(null, ws.id, owner, { email: paused.email, role: 'member' });
  const project = await createProject(ws.id, owner.id, { name: 'Closed', access: 'private' });
  const board = await createBoard(owner.id, 'Plan', '', 'none', { workspaceId: ws.id, projectId: project.id });
  await requestAccess(board.id, paused, {}); // still active: a pending request
  await setMemberDeactivated(ws.id, owner.id, paused.id, true);

  expect(await requestState(board.id, paused.id)).toMatchObject({ canRequest: false });
  await expect(decideRequest(board.id, owner, paused.id, { decision: 'approve' })).rejects.toMatchObject({ status: 403 });
  expect((await getBoardAccess(board.id, paused.id)).role).toBeNull();
});
