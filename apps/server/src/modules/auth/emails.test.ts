import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, mailedLink, openTestDb } from '../../platform/testing';
import { changePassword, confirmEmailChange, requestEmailChange, requestPasswordReset, resetPassword } from './emails';
import * as repo from './repo';
import { checkCredentials, createUser, hashToken, newToken } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const email = (label: string) => `${label}-${++n}@auth.test.freero.app`;

const mailedToken = (to: string, route: string) => mailedLink(to, new RegExp(`${route}\\?token=([A-Za-z0-9_-]+)`));

async function session(userId: string): Promise<string> {
  const key = hashToken(newToken());
  await repo.insertSession({ id: key.slice(0, 20), tokenHash: key, userId, now: Date.now(), expiresAt: Date.now() + 60_000, userAgent: '', ip: '' });
  return key;
}

it('a password reset link works once and signs the account out everywhere', async () => {
  const to = email('reset');
  const user = await createUser({ name: 'Reset', email: to, password: 'old-password' });
  await session(user.id);
  await session(user.id);
  requestPasswordReset(null, to);
  const token = await mailedToken(to, '/reset-password');

  await resetPassword(null, token, 'new-password-1');
  expect(await repo.listSessions(user.id, Date.now())).toHaveLength(0);
  await expect(checkCredentials(to, 'old-password')).rejects.toMatchObject({ status: 401 });
  await expect(checkCredentials(to, 'new-password-1')).resolves.toMatchObject({ id: user.id, emailVerified: true });
  // Replaying the link (a leaked mail, browser history) must not reset it again.
  await expect(resetPassword(null, token, 'attacker-password')).rejects.toMatchObject({ status: 400 });
  await expect(checkCredentials(to, 'attacker-password')).rejects.toMatchObject({ status: 401 });
});

it('changing the password signs out the other devices but keeps this one', async () => {
  const user = await createUser({ name: 'Change', email: email('change'), password: 'old-password' });
  const here = await session(user.id);
  await session(user.id);
  await expect(changePassword(null, user.id, here, 'wrong-password', 'new-password-1')).rejects.toMatchObject({ status: 403 });
  await changePassword(null, user.id, here, 'old-password', 'new-password-1');
  expect((await repo.listSessions(user.id, Date.now())).map((s) => s.tokenHash)).toEqual([here]);
});

// The "your email is changing" notice tells the owner to change their password if it wasn't them:
// doing so (by reset link or signed in) must kill the confirmation link the other person holds.
it('an email change someone else started can not be confirmed once the owner reset the password', async () => {
  const owner = email('owner');
  const thief = email('thief');
  const user = await createUser({ name: 'Owner', email: owner, password: 'password-123' }, { emailVerified: true });
  await requestEmailChange(null, user.id, thief, 'password-123');
  const change = await mailedToken(thief, '/confirm-email');
  requestPasswordReset(null, owner);
  await resetPassword(null, await mailedToken(owner, '/reset-password'), 'brand-new-password-1');

  await expect(confirmEmailChange(null, change)).rejects.toMatchObject({ status: 400 });
  expect((await repo.findUserById(user.id))?.email).toBe(owner);
});

it('an email change someone else started can not be confirmed once the owner changed the password', async () => {
  const owner = email('owner');
  const thief = email('thief');
  const user = await createUser({ name: 'Owner', email: owner, password: 'password-123' }, { emailVerified: true });
  const here = await session(user.id);
  await requestEmailChange(null, user.id, thief, 'password-123');
  const change = await mailedToken(thief, '/confirm-email');
  await changePassword(null, user.id, here, 'password-123', 'brand-new-password-1');

  await expect(confirmEmailChange(null, change)).rejects.toMatchObject({ status: 400 });
  expect((await repo.findUserById(user.id))?.email).toBe(owner);
});

it('an email change to an address someone took meanwhile fails and keeps the old address', async () => {
  const from = email('from');
  const to = email('to');
  const user = await createUser({ name: 'Mover', email: from, password: 'password-123' });
  await requestEmailChange(null, user.id, to, 'password-123');
  const token = await mailedToken(to, '/confirm-email');
  await createUser({ name: 'Squatter', email: to, password: 'password-123' });
  await expect(confirmEmailChange(null, token)).rejects.toMatchObject({ status: 409 });
  expect((await repo.findUserById(user.id))?.email).toBe(from);
});
