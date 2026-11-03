// Retention of inactive boards (#154): owners are warned first and activity resets the clock; a rule
// never touches a held board, an archived one, or another workspace's; an organisation's rule is a
// floor. Rounds run at chosen times in the future instead of ageing the boards.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { RETENTION_NOTICE_DAYS, type Account } from '@freero/shared';
import { closeTestDb, mailIdle, openTestDb, outboxMails } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import {
  attachWorkspace,
  createOrganisation,
  createTeamWorkspace,
  getWorkspaceSettings,
  onWorkspaceDeletionHold,
  updateWorkspaceSettings,
} from '../workspaces/index';
import { getBoardAccess, recordBoardOpen } from './index';
import { applyRetentionLocked, onBoardRetentionHold } from './retention';
import { createBoard, setBoardArchived } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const DAY = 86_400_000;
let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@retention.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function teamWithRule(owner: Account, action: 'archive' | 'trash', days: number) {
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  await updateWorkspaceSettings(ws, owner.id, { inactiveBoardAction: action, inactiveBoardDays: days });
  return ws;
}
const state = async (boardId: string, userId: string) => {
  const a = await getBoardAccess(boardId, userId);
  return !a.exists ? 'gone' : a.role === 'viewer' ? 'archived' : 'live';
};

it('a board nobody uses is archived only after its owner was warned and the notice period passed, and opening it in between starts the clock again', async () => {
  const owner = await user('Owner');
  const ws = await teamWithRule(owner, 'archive', 60);
  const idle = await createBoard(owner.id, 'Old retro', '', 'none', { workspaceId: ws });
  const used = await createBoard(owner.id, 'Still useful', '', 'none', { workspaceId: ws });
  const t = Date.now() + 70 * DAY; // both untouched for 70 days

  await applyRetentionLocked(t);
  expect(await state(idle.id, owner.id)).toBe('live'); // warned, not archived
  await mailIdle();
  const mail = outboxMails().find((m) => m.to === owner.email && m.subject.includes('archived'));
  expect(mail?.text).toContain('Old retro');
  expect(mail?.text).toContain('Still useful');

  await applyRetentionLocked(t + DAY); // warned only a day ago: nothing yet
  expect(await state(idle.id, owner.id)).toBe('live');

  await recordBoardOpen(used.id, owner.id, t + 5 * DAY); // someone opened it after the notice
  await applyRetentionLocked(t + (RETENTION_NOTICE_DAYS + 1) * DAY);
  expect(await state(idle.id, owner.id)).toBe('archived');
  expect(await state(used.id, owner.id)).toBe('live');

  const [event] = await listAuditEvents({ workspaceId: ws, actions: ['board.archived'] }, 5);
  expect(event).toMatchObject({ actorId: null, targetId: idle.id, metadata: expect.objectContaining({ reason: 'retention' }) });
});

it('a trash rule never removes a board under a legal hold, an archived board, a board of another workspace, or anything in a workspace on hold', async () => {
  const owner = await user('Owner');
  const ws = await teamWithRule(owner, 'trash', 30);
  const plain = await createBoard(owner.id, 'Plain', '', 'none', { workspaceId: ws });
  const held = await createBoard(owner.id, 'Evidence', '', 'none', { workspaceId: ws });
  const kept = await createBoard(owner.id, 'Kept', '', 'none', { workspaceId: ws });
  await setBoardArchived(kept.id, owner.id, true);
  const elsewhere = (await createTeamWorkspace(owner.id, `Other ${++n}`)).id;
  const other = await createBoard(owner.id, 'Other team', '', 'none', { workspaceId: elsewhere });
  const holdOff = onBoardRetentionHold((ids) => new Set(ids.filter((id) => id === held.id)));

  const t = Date.now() + 40 * DAY;
  await applyRetentionLocked(t);
  await applyRetentionLocked(t + (RETENTION_NOTICE_DAYS + 1) * DAY);
  holdOff();
  expect(await state(plain.id, owner.id)).toBe('gone');
  expect(await state(held.id, owner.id)).toBe('live');
  expect(await state(kept.id, owner.id)).toBe('archived');
  expect(await state(other.id, owner.id)).toBe('live');

  // A hold on the workspace itself keeps every one of its boards.
  const onHold = await teamWithRule(owner, 'trash', 30);
  const caseFile = await createBoard(owner.id, 'Case file', '', 'none', { workspaceId: onHold });
  const off = onWorkspaceDeletionHold((id) => (id === onHold ? 'Legal hold: case 7' : null));
  await applyRetentionLocked(t);
  await applyRetentionLocked(t + (RETENTION_NOTICE_DAYS + 1) * DAY);
  off();
  expect(await state(caseFile.id, owner.id)).toBe('live');
});

it('an organisation’s retention rule is a floor: its workspaces get the stricter action and the shorter period, and can’t ask for less', async () => {
  const owner = await user('Owner');
  const ws = await teamWithRule(owner, 'trash', 365);
  const org = await createOrganisation(owner.id, `Org ${++n}`);
  await updateWorkspaceSettings(org.id, owner.id, { inactiveBoardAction: 'archive', inactiveBoardDays: 90 });
  await attachWorkspace(org.id, ws, owner.id);

  expect(await getWorkspaceSettings(ws, owner.id)).toMatchObject({ inactiveBoardAction: 'trash', inactiveBoardDays: 90 });
  await expect(updateWorkspaceSettings(ws, owner.id, { inactiveBoardAction: 'none' })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });
  await expect(updateWorkspaceSettings(ws, owner.id, { inactiveBoardDays: 400 })).rejects.toMatchObject({ status: 403, code: 'organisation_policy' });

  // The floor's period is what the job applies: a board idle for 100 days is warned now.
  const board = await createBoard(owner.id, 'Idle', '', 'none', { workspaceId: ws });
  const round = await applyRetentionLocked(Date.now() + 100 * DAY);
  expect(round.noticed).toBeGreaterThanOrEqual(1);
  expect(await state(board.id, owner.id)).toBe('live');
});
