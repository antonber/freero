import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getConfig } from '../../platform/config';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { purgeDueAccounts } from '../accounts/index';
import { createUser, getUser, scheduleAccountDeletion } from '../auth/index';
import { boardForModeration, createBoard, getBoardAccess } from '../boards/index';
import { isUploadRemoved, saveUpload, uploadForModeration } from '../uploads/index';
import { createTeamWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { act, purgeExpiredKeptCopies, submitAppeal, appealToken } from './service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-holds-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@holds.test.freero.app`, password: 'password-123' });
const afterGrace = () => Date.now() + getConfig().accountDeletionGraceMs + 60_000;

// KAI-178: deleting an account must not destroy content an operator is reviewing.
it('a taken-down board and a removed file outlive their owner’s account deletion: the purge waits until the operator deletes the board for good, and the record still names the owner', async () => {
  const operator = await user('HoldOp');
  const owner = await user('Held');
  const bystander = await user('Bystander');
  const personal = await createBoard(owner.id, 'Under review', '');
  const team = await createTeamWorkspace(owner.id, 'Solo team');
  const teamBoard = await createBoard(owner.id, 'Team board under review', '', 'none', { workspaceId: team.id });
  const file = (await saveUpload(PNG, 'image/png', owner.id)).slice('/uploads/'.length);
  const theirs = await createBoard(bystander.id, 'Someone else’s', '');
  const takeDown = await act(operator.id, { action: 'board.take_down', targetId: personal.id, reason: 'illegal', statement: 'Unlawful content.' });
  await act(operator.id, { action: 'board.take_down', targetId: teamBoard.id, reason: 'illegal', statement: 'Unlawful content.' });
  await act(operator.id, { action: 'upload.remove', targetId: file, reason: 'illegal', statement: 'Unlawful image.' });

  await scheduleAccountDeletion(null, owner.id, 'password-123');
  const others = await user('PurgedAnyway'); // due at the same time, with nothing held
  await scheduleAccountDeletion(null, others.id, 'password-123');
  expect(await purgeDueAccounts(afterGrace())).toBe(1); // the held account never blocks the others
  expect(await getUser(others.id)).toBeNull();
  expect(await getUser(owner.id)).not.toBeNull();
  expect(await boardForModeration(personal.id)).not.toBeNull();
  expect(await boardForModeration(teamBoard.id)).not.toBeNull(); // its lone team was not deleted with it
  expect((await getBoardAccess(theirs.id, bystander.id)).role).toBe('owner');

  // Ending the review of the personal board alone is not enough: the team board is still held.
  await act(operator.id, { action: 'board.delete', targetId: personal.id, reason: 'illegal', statement: 'Deleted after review.' });
  expect(await boardForModeration(personal.id)).toBeNull();
  expect(await purgeDueAccounts(afterGrace())).toBe(0);
  await act(operator.id, { action: 'board.restore', targetId: teamBoard.id, reason: 'other', statement: '' });
  expect(await purgeDueAccounts(afterGrace())).toBe(1);
  expect(await getUser(owner.id)).toBeNull();

  // The removed file is still a tombstone with its kept copy, now owned by nobody.
  expect(await isUploadRemoved(file)).toBe(true);
  expect(await uploadForModeration(file)).toMatchObject({ ownerId: null, restorable: true });
  // Only a board that is taken down can be deleted for good.
  await expect(act(operator.id, { action: 'board.delete', targetId: theirs.id, reason: 'spam', statement: 'x' })).rejects.toMatchObject({ status: 409 });
  const [record] = (await repo.actionsAbout(personal.id)).filter((a) => a.id === takeDown.id);
  expect(record).toMatchObject({ subjectUserId: null, subjectEmail: owner.email, subjectName: owner.name });
});

// KAI-180: a spam account with many link-shared boards is one action, and so is undoing it.
it('suspending with “take its boards down” takes down every board the account has in service, and lifting the suspension brings back exactly those not decided on since', async () => {
  const operator = await user('SuspOp');
  const spammer = await user('Spammer');
  const visitor = await user('LinkFollower');
  const a = await createBoard(spammer.id, 'Spam A', '', 'viewer');
  const b = await createBoard(spammer.id, 'Spam B', '', 'viewer');
  const c = await createBoard(spammer.id, 'Spam C', '', 'viewer');
  const earlier = await createBoard(spammer.id, 'Taken down before', '', 'viewer');
  await act(operator.id, { action: 'board.take_down', targetId: earlier.id, reason: 'spam', statement: 'Spam.' });

  const suspension = await act(operator.id, { action: 'user.suspend', targetId: spammer.id, reason: 'spam', statement: 'Spam account.', boards: 'take_down' });
  for (const board of [a, b, c]) expect(await getBoardAccess(board.id, visitor.id)).toMatchObject({ role: null });
  const children = await repo.childActions(suspension.id);
  expect(children.map((x) => [x.action, x.targetId]).sort()).toEqual([a, b, c].map((x) => ['board.take_down', x.id]).sort());

  // Decided on separately meanwhile: B was restored, C deleted for good.
  await act(operator.id, { action: 'board.restore', targetId: b.id, reason: 'other', statement: '' });
  await act(operator.id, { action: 'board.delete', targetId: c.id, reason: 'spam', statement: 'Deleted.' });

  const lift = await act(operator.id, { action: 'user.restore', targetId: spammer.id, reason: 'other', statement: '' });
  expect((await getBoardAccess(a.id, visitor.id)).role).toBe('viewer');
  expect((await getBoardAccess(b.id, visitor.id)).role).toBe('viewer');
  expect(await boardForModeration(c.id)).toBeNull();
  // A board taken down on its own decision stays down.
  expect((await boardForModeration(earlier.id))?.removedAt).not.toBeNull();
  expect((await repo.childActions(lift.id)).map((x) => [x.action, x.targetId])).toEqual([['board.restore', a.id]]);
});

// KAI-179: kept copies of removed files must not stay forever, nor vanish while someone appeals.
it('kept copies of removed files are deleted for good once their retention is over — except one whose removal is being appealed — and each deletion is recorded', async () => {
  const operator = await user('KeepOp');
  const owner = await user('Uploader');
  const [expired, appealed] = await Promise.all([saveUpload(PNG, 'image/png', owner.id), saveUpload(PNG, 'image/png', owner.id)]).then((urls) => urls.map((u) => u.slice('/uploads/'.length)));
  await act(operator.id, { action: 'upload.remove', targetId: expired, reason: 'illegal', statement: 'Unlawful image.' });
  const contested = await act(operator.id, { action: 'upload.remove', targetId: appealed, reason: 'copyright', statement: 'Reported as a copy.' });
  await submitAppeal({ token: appealToken(contested.id), message: 'I made this picture.' });

  await purgeExpiredKeptCopies(Date.now()); // within the retention: both kept
  expect(await uploadForModeration(expired)).toMatchObject({ restorable: true });
  const later = Date.now() + getConfig().moderationKeepRemovedMs + 60_000;
  expect(await purgeExpiredKeptCopies(later)).toBeGreaterThan(0);
  expect(await uploadForModeration(expired)).toMatchObject({ restorable: false });
  expect(await isUploadRemoved(expired)).toBe(true); // still 410
  expect(await uploadForModeration(appealed)).toMatchObject({ restorable: true });
  const [record] = (await repo.actionsAbout(expired)).filter((a) => a.action === 'upload.purge');
  expect(record).toMatchObject({ operatorId: null, subjectEmail: owner.email, reason: 'illegal' });
  expect(await purgeExpiredKeptCopies(later)).toBe(0); // idempotent
});
