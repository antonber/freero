import { generate } from 'otplib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, mailedLink, mailIdle, openTestDb, outboxMails } from '../../platform/testing';
import { confirmEmailChange, requestEmailChange, revertEmailChange } from './emails';
import * as repo from './repo';
import { checkCredentials, createUser, hashToken, newToken } from './service';
import { beginTwoFactorSetup, enableTwoFactor, regenerateRecoveryCodes } from './twoFactor';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const email = (label: string) => `${label}-${++n}@notices.test.freero.app`;

const mailsTo = (to: string) => outboxMails().filter((m) => m.to === to);
const mailedToken = (to: string, route: string) => mailedLink(to, new RegExp(`${route}\\?token=([A-Za-z0-9_-]+)`));
/** Notices are sent after the answer (sendMailLater): wait until those sends are done. */
const settle = mailIdle;

async function session(userId: string): Promise<string> {
  const key = hashToken(newToken());
  await repo.insertSession({ id: key.slice(0, 20), tokenHash: key, userId, now: Date.now(), expiresAt: Date.now() + 60_000, userAgent: '', ip: '' });
  return key;
}

it('a hijacked email change is undone from the previous address: address back, intruder’s password, sessions and authenticator gone; the link works once', async () => {
  const owner = email('owner');
  const intruder = email('intruder');
  const user = await createUser({ name: 'Owner', email: owner, password: 'password-123' }, { emailVerified: true });
  // Someone with the password (and a session) moves the account to their address...
  const theirs = await session(user.id);
  await requestEmailChange(null, user.id, intruder, 'password-123');
  await confirmEmailChange(null, await mailedToken(intruder, '/confirm-email'));
  // ... and locks it with their own authenticator.
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  await enableTwoFactor(null, user.id, theirs, await generate({ secret }));

  const revert = await mailedToken(owner, '/revert-email');
  // A rejected password must not use the link up.
  await expect(revertEmailChange(revert, 'short')).rejects.toMatchObject({ status: 400 });
  await revertEmailChange(revert, 'owner-password-2');

  expect((await repo.findUserById(user.id))?.email).toBe(owner);
  expect(await repo.twoFactorEnabled(user.id)).toBe(false);
  expect(await repo.listSessions(user.id, Date.now())).toHaveLength(0);
  await expect(checkCredentials(owner, 'owner-password-2')).resolves.toMatchObject({ id: user.id });
  await expect(checkCredentials(owner, 'password-123')).rejects.toMatchObject({ status: 401 });
  await expect(revertEmailChange(revert, 'intruder-password')).rejects.toMatchObject({ status: 400 });
});

it('an email change gives a never-verified previous address no way to take the account', async () => {
  const typo = email('typo');
  const real = email('real');
  const user = await createUser({ name: 'Typo', email: typo, password: 'password-123' });
  await requestEmailChange(null, user.id, real, 'password-123');
  await confirmEmailChange(null, await mailedToken(real, '/confirm-email'));
  await settle();
  expect(mailsTo(typo).some((m) => m.text.includes('/revert-email'))).toBe(false);
});

it('two-step notices go out once per change and never carry the secret or the recovery codes they announce', async () => {
  const to = email('codes');
  const user = await createUser({ name: 'Codes', email: to, password: 'password-123' });
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  const first = await enableTwoFactor(null, user.id, 'no-session', await generate({ secret }));
  const second = await regenerateRecoveryCodes(null, user.id, 'password-123', first[0], Date.now());
  await settle();

  const notices = mailsTo(to);
  expect(notices.map((m) => m.subject).sort()).toEqual(['New recovery codes for your Freero account', 'Two-step verification is on for your Freero account']);
  const secrets = [secret, ...first, ...second].flatMap((c) => [c, c.replace('-', '')]);
  for (const m of notices) for (const s of secrets) expect(`${m.text}${m.html}`).not.toContain(s);
});
