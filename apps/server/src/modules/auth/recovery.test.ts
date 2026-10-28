import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { generate } from 'otplib';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { getConfig } from '../../platform/config';
import { outboxDir } from '../../platform/mail';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { confirmEmailChange, requestEmailChange, requestPasswordReset, resetPassword, revertEmailChange } from './emails';
import { finishTwoFactorRecovery, processTwoFactorRecoveries, startTwoFactorRecovery, undoTwoFactor } from './recovery';
import * as repo from './repo';
import { checkCredentials, createUser, hashToken, newToken } from './service';
import { beginTwoFactorSetup, enableTwoFactor, useSecondFactor } from './twoFactor';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());
afterEach(() => vi.useRealTimers());

let n = 0;
const email = (label: string) => `${label}-${++n}@recovery.test.freero.app`;
const nowS = () => Math.floor(Date.now() / 1000);

type Mail = { to: string; subject: string; text: string };
const mailsTo = (to: string): Mail[] => {
  const dir = outboxDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Mail)
    .filter((m) => m.to === to);
};

async function mailedToken(to: string, route: string, timeoutMs = 3000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const m = mailsTo(to)
      .map((t) => new RegExp(`${route}\\?token=([A-Za-z0-9_-]+)`).exec(t.text))
      .filter(Boolean)
      .at(-1);
    if (m) return m[1];
    if (Date.now() > end) throw new Error(`no ${route} link mailed to ${to}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A browser's request, as far as recovery needs one (where it came from, for the mails). */
const req = { get: (h: string) => (h === 'user-agent' ? 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0' : 'localhost'), ip: '203.0.113.9', protocol: 'http', socket: {} } as unknown as Request;

async function session(userId: string): Promise<string> {
  const key = hashToken(newToken());
  await repo.insertSession({ id: key.slice(0, 20), tokenHash: key, userId, now: Date.now(), expiresAt: Date.now() + 60_000, userAgent: '', ip: '' });
  return key;
}

/** A verified account with an authenticator on (enrolled from a session of someone with the password). */
async function locked(label: string) {
  const to = email(label);
  const user = await createUser({ name: label, email: to, password: 'password-123' }, { emailVerified: true });
  const enrolling = await session(user.id);
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  await enableTwoFactor(null, user.id, enrolling, await generate({ secret }));
  return { user, to, secret, enrolling };
}

const passwordSignIn = (userId: string): repo.Challenge => ({ userId, method: 'password', link: null });

it('the mailbox alone never starts a recovery: a reset link, a password chosen through one, or a provider not connected yet are refused', async () => {
  const { user, to, secret } = await locked('mailbox');
  // Someone reading the mail resets the password and signs in with it.
  requestPasswordReset(null, to);
  await resetPassword(null, await mailedToken(to, '/reset-password'), 'mailbox-password-1');
  await expect(startTwoFactorRecovery(req, { userId: user.id, method: 'email_link', link: null })).rejects.toMatchObject({ status: 403 });
  await expect(startTwoFactorRecovery(req, passwordSignIn(user.id))).rejects.toMatchObject({ status: 403 });
  const google = { provider: 'google', issuer: 'https://accounts.example', subject: 'x', email: to, emailVerified: true };
  await expect(startTwoFactorRecovery(req, { userId: user.id, method: 'google', link: google })).rejects.toMatchObject({ status: 403 });
  expect(await repo.findRecovery(user.id)).toBeNull();

  // Whoever passes the second step with that password is the owner: it may start one again.
  expect(await useSecondFactor(user.id, await generate({ secret, epoch: nowS() + 30 }))).toBe('totp');
  await expect(startTwoFactorRecovery(req, passwordSignIn(user.id))).resolves.toMatchObject({ readyAt: expect.any(Number) });
});

it('a recovery removes two-step verification only after its waiting period, through the address, once; the authenticator cancels it meanwhile', async () => {
  const delay = getConfig().twoFactorRecoveryDelayMs;
  const lost = await locked('lost');
  const { readyAt } = await startTwoFactorRecovery(req, passwordSignIn(lost.user.id));
  const found = await locked('found');
  await startTwoFactorRecovery(req, passwordSignIn(found.user.id));
  // The owner of `found` still has the authenticator and signs in with it.
  expect(await useSecondFactor(found.user.id, await generate({ secret: found.secret, epoch: nowS() + 30 }))).toBe('totp');
  expect(await repo.findRecovery(found.user.id)).toBeNull();

  await processTwoFactorRecoveries(readyAt - 1000);
  expect(mailsTo(lost.to).some((m) => m.text.includes('/recover-two-factor'))).toBe(false);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + delay + 60_000);
  await processTwoFactorRecoveries();
  const finish = await mailedToken(lost.to, '/recover-two-factor');
  expect(mailsTo(found.to).some((m) => m.text.includes('/recover-two-factor'))).toBe(false);

  await finishTwoFactorRecovery(null, finish, 'recovered-password-1');
  expect(await repo.twoFactorEnabled(lost.user.id)).toBe(false);
  expect(await repo.listSessions(lost.user.id, Date.now())).toHaveLength(0);
  await expect(checkCredentials(lost.to, 'recovered-password-1')).resolves.toMatchObject({ id: lost.user.id });
  await expect(checkCredentials(lost.to, 'password-123')).rejects.toMatchObject({ status: 401 });
  await expect(finishTwoFactorRecovery(null, finish, 'replayed-password-1')).rejects.toMatchObject({ status: 400 });
  expect(await repo.twoFactorEnabled(found.user.id)).toBe(true);
});

it('the two-step-on "this wasn’t me" link survives an intruder’s email change and takes the account back once the address is restored', async () => {
  const owner = email('owner');
  const user = await createUser({ name: 'Owner', email: owner, password: 'password-123' }, { emailVerified: true });
  const intruder = await session(user.id);
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  await enableTwoFactor(null, user.id, intruder, await generate({ secret }));
  const undo = await mailedToken(owner, '/undo-two-factor');
  // ... and then moves the account to their own address.
  const theirs = email('theirs');
  await requestEmailChange(null, user.id, theirs, 'password-123');
  await confirmEmailChange(null, await mailedToken(theirs, '/confirm-email'));

  // The undo link can't act while the account uses another address — and isn't used up by trying.
  await expect(undoTwoFactor(null, undo, 'owner-password-1')).rejects.toMatchObject({ status: 409 });
  await revertEmailChange(await mailedToken(owner, '/revert-email'), 'owner-password-1');
  expect(await repo.twoFactorEnabled(user.id)).toBe(true); // turned on before the change: the revert keeps it

  await undoTwoFactor(null, undo, 'owner-password-2');
  expect(await repo.twoFactorEnabled(user.id)).toBe(false);
  expect(await repo.listSessions(user.id, Date.now())).toHaveLength(0);
  await expect(checkCredentials(owner, 'owner-password-2')).resolves.toMatchObject({ id: user.id });
  await expect(undoTwoFactor(null, undo, 'intruder-password')).rejects.toMatchObject({ status: 400 });
});

it('an unverified address gets no "this wasn’t me" link: whoever reads it may not be the owner', async () => {
  const to = email('unverified');
  const user = await createUser({ name: 'Unverified', email: to, password: 'password-123' });
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  await enableTwoFactor(null, user.id, 'no-session', await generate({ secret }));
  await new Promise((r) => setTimeout(r, 300));
  const notice = mailsTo(to).find((m) => /Two-step verification is on/.test(m.subject));
  expect(notice).toBeDefined();
  expect(notice!.text).not.toContain('/undo-two-factor');
});
