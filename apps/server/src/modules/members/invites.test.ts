import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { User } from '@freero/shared';
import { closeTestDb, openTestDb, outboxMails } from '../../platform/testing';
import { createUser, markEmailVerified, onEmailVerified } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { acceptInvite, convertInvitesFor, inviteByEmail, previewInvite, resendInvite } from './invites';
import * as repo from './repo';

let owner: User;
let n = 0;
const email = (label: string) => `${label}-${++n}@invites.test.freero.app`;

beforeAll(async () => {
  await openTestDb();
  onEmailVerified(convertInvitesFor); // what members/init.ts registers at startup
  owner = await createUser({ name: 'Owner', email: email('owner'), password: 'password-123' }, { emailVerified: true });
});
afterAll(() => closeTestDb());
afterEach(() => vi.useRealTimers());

/** The token of the latest invite link mailed to `to` (dev outbox). */
function inviteToken(to: string): string {
  const m = /\/invite\/([A-Za-z0-9_-]+)/.exec(outboxMails().filter((mail) => mail.to === to).at(-1)?.text ?? '');
  if (!m) throw new Error(`no invite mailed to ${to}`);
  return m[1];
}

async function invite(to: string, role: 'editor' | 'commenter' | 'viewer' = 'editor') {
  const board = await createBoard(owner.id, `Board for ${to}`, '');
  const out = await inviteByEmail(null, { boardId: board.id, boardTitle: board.title, email: to, role, inviter: owner, mayChangeRole: true });
  if (typeof out === 'string') throw new Error(out);
  return { board, invite: out, token: inviteToken(to) };
}

it('an invite link grants access once: of two simultaneous accepts exactly one succeeds', async () => {
  const to = email('once');
  const { board, token } = await invite(to, 'commenter');
  const a = await createUser({ name: 'A', email: to, password: 'password-123' });
  const b = await createUser({ name: 'B', email: email('other'), password: 'password-123' });
  const results = await Promise.allSettled([acceptInvite(token, a), acceptInvite(token, b)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const roles = [(await getBoardAccess(board.id, a.id)).role, (await getBoardAccess(board.id, b.id)).role];
  expect(roles.filter((r) => r === 'commenter')).toHaveLength(1);
  expect(roles.filter((r) => r === null)).toHaveLength(1);
  await expect(acceptInvite(token, a)).rejects.toMatchObject({ status: 404 });
});

it('an expired or revoked invite grants nothing', async () => {
  const expiredTo = email('expired');
  const expired = await invite(expiredTo);
  const revokedTo = email('revoked');
  const revoked = await invite(revokedTo);
  expect(await repo.deleteInvite(revoked.board.id, revoked.invite.id, null)).toBe(true);

  const user = await createUser({ name: 'Late', email: email('late'), password: 'password-123' });
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 15 * 24 * 3600_000 });
  await expect(previewInvite(expired.token)).rejects.toMatchObject({ status: 404 });
  await expect(acceptInvite(expired.token, user)).rejects.toMatchObject({ status: 404 });
  vi.useRealTimers();
  await expect(acceptInvite(revoked.token, user)).rejects.toMatchObject({ status: 404 });
  expect((await getBoardAccess(expired.board.id, user.id)).role).toBeNull();
  expect((await getBoardAccess(revoked.board.id, user.id)).role).toBeNull();
});

it('resending an invite kills the link that was mailed before', async () => {
  const to = email('resend');
  const { board, invite: pending, token: first } = await invite(to);
  await resendInvite(null, board.id, board.title, pending.id, owner);
  const second = inviteToken(to);
  expect(second).not.toBe(first);
  const user = await createUser({ name: 'R', email: to, password: 'password-123' });
  await expect(acceptInvite(first, user)).rejects.toMatchObject({ status: 404 });
  expect((await acceptInvite(second, user)).role).toBe('editor');
});

it('signing up without the link converts pending invites only once the address is verified', async () => {
  const to = email('verify');
  const { board } = await invite(to, 'viewer');
  const user = await createUser({ name: 'V', email: to, password: 'password-123' });
  // Anyone can sign up with any address: an unverified one must not pick up its invites.
  expect((await getBoardAccess(board.id, user.id)).role).toBeNull();
  await markEmailVerified(user.id, to);
  expect((await getBoardAccess(board.id, user.id)).role).toBe('viewer');
});

it('accepting a weaker invite never lowers the role someone already has', async () => {
  const to = email('keep');
  const { board, token } = await invite(to, 'viewer');
  const user = await createUser({ name: 'K', email: to, password: 'password-123' });
  await repo.upsertMember(board.id, user.id, 'editor', Date.now());
  expect((await acceptInvite(token, user)).role).toBe('editor');
});
