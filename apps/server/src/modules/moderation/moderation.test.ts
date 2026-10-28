import { afterAll, beforeAll, expect, it } from 'vitest';
import { BOARD_REMOVED } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess, requireBoardAccess } from '../boards/index';
import { act, appealInfo, appealToken, queue, submitAppeal, submitReport } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });
const report = (boardId: string, userId: string | null, extra: Record<string, unknown> = {}) =>
  submitReport({ boardId, target: { kind: 'board' }, reason: 'spam', ...extra }, { userId, ip: '203.0.113.7' });
const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => 'accepted',
    (e: { status?: number; message?: string }) => `${e.status} ${e.message}`,
  );

it('reports cannot probe for boards: an unknown id and a board the reporter cannot open get the same answer', async () => {
  const owner = await user('Owner');
  const stranger = await user('Stranger');
  const hidden = await createBoard(owner.id, 'Private plans', '');
  const shared = await createBoard(owner.id, 'Public page', '', 'viewer');

  const unknown = await statusOf(report('no-such-board', stranger.id));
  expect(unknown).toMatch(/^404/);
  expect(await statusOf(report(hidden.id, stranger.id))).toBe(unknown);
  expect(await statusOf(report(hidden.id, null))).toBe(unknown); // a visitor without an account
  // What the link opens can be reported by anyone holding it, signed in or not.
  expect(await statusOf(report(shared.id, stranger.id))).toBe('accepted');
  expect(await statusOf(report(shared.id, null, { contactEmail: 'visitor@example.com' }))).toBe('accepted');
});

it('reporting the same thing again while the first report is open does not add to the queue', async () => {
  const owner = await user('Flooded');
  const board = await createBoard(owner.id, 'Flooded', '', 'viewer');
  const reporter = await user('Repeater');
  for (let i = 0; i < 3; i++) await report(board.id, reporter.id);
  await report(board.id, reporter.id, { target: { kind: 'element', id: 'el-1' } }); // something else on it: a new item
  expect((await queue('open')).filter((i) => i.boardId === board.id)).toHaveLength(2);
});

it('a taken-down board is closed to everyone who could open it, owner included, until an operator restores it', async () => {
  const operator = await user('Operator');
  const owner = await user('Author');
  const member = await user('Reader');
  const stranger = await user('Passerby');
  const board = await createBoard(owner.id, 'Spam board', '', 'viewer');

  await act(operator.id, { action: 'board.take_down', targetId: board.id, reason: 'spam', statement: 'Advertising spam.' });
  for (const u of [owner, member]) {
    // getBoardAccess admits sockets; requireBoardAccess guards every REST route on the board.
    expect(await getBoardAccess(board.id, u.id)).toMatchObject({ role: null, removed: true });
    await expect(requireBoardAccess(board.id, u.id)).rejects.toMatchObject({ status: 451, code: BOARD_REMOVED });
  }
  // Someone who could never open a taken-down board learns nothing about it.
  const hidden = await createBoard(owner.id, 'Private spam', '');
  await act(operator.id, { action: 'board.take_down', targetId: hidden.id, reason: 'spam', statement: 'Spam.' });
  expect(await getBoardAccess(hidden.id, stranger.id)).toMatchObject({ role: null, removed: false });
  await expect(requireBoardAccess(hidden.id, stranger.id)).rejects.toMatchObject({ status: 404 });
  // Doing it twice is refused (nothing to do), not recorded twice.
  await expect(act(operator.id, { action: 'board.take_down', targetId: board.id, reason: 'spam', statement: 'Again.' })).rejects.toMatchObject({ status: 409 });

  await act(operator.id, { action: 'board.restore', targetId: board.id, reason: 'spam', statement: '' });
  expect((await getBoardAccess(board.id, member.id)).role).toBe('viewer');
  expect((await getBoardAccess(board.id, owner.id)).role).toBe('owner');
});

it('blocking a board’s link cuts access that came only from the link, and restoring brings back the owner’s setting', async () => {
  const operator = await user('Op');
  const owner = await user('Linker');
  const visitor = await user('LinkVisitor');
  const board = await createBoard(owner.id, 'Linked', '', 'commenter');
  expect((await getBoardAccess(board.id, visitor.id)).role).toBe('commenter');

  await act(operator.id, { action: 'board.disable_link', targetId: board.id, reason: 'phishing', statement: 'Phishing link.' });
  expect((await getBoardAccess(board.id, visitor.id)).role).toBeNull();
  expect((await getBoardAccess(board.id, owner.id)).role).toBe('owner');
  // And visitors without an account can no longer report through it either.
  await expect(report(board.id, null)).rejects.toMatchObject({ status: 404 });

  await act(operator.id, { action: 'board.restore_link', targetId: board.id, reason: 'phishing', statement: '' });
  expect((await getBoardAccess(board.id, visitor.id)).role).toBe('commenter');
});

it('the appeal link works without a session, cannot be forged for another action, and takes one open appeal per action', async () => {
  const operator = await user('Mod');
  const owner = await user('Appellant');
  const board = await createBoard(owner.id, 'Contested', '');
  const { id } = await act(operator.id, { action: 'board.take_down', targetId: board.id, reason: 'copyright', statement: 'Reported as a copy.' });
  const other = await createBoard(owner.id, 'Other', '');
  const second = await act(operator.id, { action: 'board.take_down', targetId: other.id, reason: 'spam', statement: 'Spam.' });

  const token = appealToken(id);
  expect(await appealInfo(token)).toMatchObject({ action: 'board.take_down', boardTitle: 'Contested', pending: false, reversed: false });
  // Another action's id under this action's signature is not a valid link.
  const forged = `${second.id}.${token.split('.')[1]}`;
  await expect(appealInfo(forged)).rejects.toMatchObject({ status: 404 });

  await submitAppeal({ token, message: 'It is my own work.' });
  await expect(submitAppeal({ token, message: 'Please!' })).rejects.toMatchObject({ status: 409 });
  expect(await appealInfo(token)).toMatchObject({ pending: true });
  const appeal = (await queue('open')).find((i) => i.kind === 'appeal' && i.action?.id === id);
  expect(appeal).toMatchObject({ message: 'It is my own work.', reporter: { id: owner.id } });
});
