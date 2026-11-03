// Usage trends (#65): one point per day the rollup ran, never double-counted, API calls by app from
// the audit log, and nothing left of a deleted workspace.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { recordAudit } from '../audit/index';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createTeamWorkspace, deleteWorkspace, inviteToWorkspace } from '../workspaces/index';
import { rollUpUsage, usageHistory } from './usage';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const DAY = 86_400_000;
let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@usage.test.freero.app`, password: 'password-123' }, { emailVerified: true });

it('after the rollup ran on N days the history has N points, and a second run on the same day replaces that day instead of adding to it', async () => {
  const [owner, guest] = await Promise.all(['Owner', 'Guest'].map(user));
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  await inviteToWorkspace(null, ws, owner, { email: guest.email, role: 'guest' });
  await createBoard(owner.id, 'Today', '', 'none', { workspaceId: ws });
  for (const app of ['Planner bot', 'Planner bot', 'Sync']) await recordAudit({ action: 'api.call', workspaceId: ws, actorId: owner.id, metadata: { credentialName: app } });

  const now = Date.now();
  await rollUpUsage(now);
  await recordAudit({ action: 'api.call', workspaceId: ws, actorId: owner.id, metadata: { credentialName: 'Planner bot' } });
  await rollUpUsage(now); // the same day again: its row is measured anew, not added to
  const [today] = await usageHistory(ws, 1, now);
  expect(today).toMatchObject({ boardsCreated: 1, members: 1, guests: 1, apiCalls: { 'Planner bot': 3, Sync: 1 } });

  await rollUpUsage(now + DAY);
  await rollUpUsage(now + 2 * DAY);
  const days = await usageHistory(ws, 90, now + 2 * DAY);
  expect(days).toHaveLength(3);
  expect(days.map((d) => d.boardsCreated)).toEqual([1, 0, 0]);
});

it('a deleted workspace’s rollups go with it', async () => {
  const owner = await user('Owner');
  const ws = await createTeamWorkspace(owner.id, `Gone ${++n}`);
  await rollUpUsage();
  expect(await usageHistory(ws.id, 7)).toHaveLength(1);
  await deleteWorkspace(null, ws.id, owner.id, ws.name);
  expect(await usageHistory(ws.id, 7)).toEqual([]);
});
