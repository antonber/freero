import { generate } from 'otplib';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { loadConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser } from './service';
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, resealTwoFactorSecrets, useSecondFactor } from './twoFactor';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());
afterEach(() => {
  vi.useRealTimers();
  useSecrets(null);
});

let n = 0;
const nowS = () => Math.floor(Date.now() / 1000);

const SECRET_A = 'rotation-test-secret-A-0123456789abcdefghij';
const SECRET_B = 'rotation-test-secret-B-0123456789abcdefghij';
const SECRET_C = 'rotation-test-secret-C-0123456789abcdefghij';
/** Restarts the config with these secrets (null: the test default). */
function useSecrets(current: string | null, previous: string[] = []) {
  loadConfig({
    NODE_ENV: 'test',
    FREERO_DATA_DIR: 'memory',
    ...(current ? { SESSION_SECRET: current } : {}),
    ...(previous.length ? { SESSION_SECRET_PREVIOUS: previous.join(',') } : {}),
  });
}
/** Moves the clock on, so the authenticator shows a code that has not been used yet. */
function nextCodePeriod() {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now + 30_000);
}

async function enrolled() {
  const user = await createUser({ name: 'Two', email: `two-${++n}@auth.test.freero.app`, password: 'password-123' });
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  const enrolCode = await generate({ secret });
  const recoveryCodes = await enableTwoFactor(null, user.id, 'no-session', enrolCode);
  return { user, secret, enrolCode, recoveryCodes };
}

it('an authenticator code works once: a replayed (or older) code is refused, the next one is accepted', async () => {
  const { user, secret, enrolCode } = await enrolled();
  // Someone who saw the code typed at enrolment can't sign in with it.
  expect(await useSecondFactor(user.id, enrolCode)).toBeNull();
  const next = await generate({ secret, epoch: nowS() + 30 });
  expect(await useSecondFactor(user.id, next)).toBe('totp');
  expect(await useSecondFactor(user.id, next)).toBeNull();
  expect(await useSecondFactor(user.id, await generate({ secret, epoch: nowS() }))).toBeNull();
});

it('each recovery code works once, and turning two-factor off takes the password and a valid code', async () => {
  const { user, recoveryCodes } = await enrolled();
  expect(recoveryCodes).toHaveLength(10);
  expect(new Set(recoveryCodes).size).toBe(10);
  // Typed back loosely (case, no dash) it still matches — once.
  expect(await useSecondFactor(user.id, recoveryCodes[0].toUpperCase().replace('-', ''))).toBe('recovery');
  expect(await useSecondFactor(user.id, recoveryCodes[0])).toBeNull();

  await expect(disableTwoFactor(null, user.id, 'wrong-password', recoveryCodes[1], Date.now())).rejects.toMatchObject({ status: 403 });
  await expect(disableTwoFactor(null, user.id, 'password-123', '123456', Date.now())).rejects.toMatchObject({ status: 403 });
  expect(await repo.twoFactorEnabled(user.id)).toBe(true);
  await disableTwoFactor(null, user.id, 'password-123', recoveryCodes[1], Date.now());
  expect(await repo.twoFactorEnabled(user.id)).toBe(false);
  // The remaining recovery codes went with it.
  expect(await useSecondFactor(user.id, recoveryCodes[2])).toBeNull();
});

it('rotating SESSION_SECRET locks nobody out: the old secret still verifies codes, re-seals on use, and can then be dropped', async () => {
  useSecrets(SECRET_A);
  const { user, secret } = await enrolled();
  const sealedUnderA = (await repo.findTotp(user.id))!.secret;

  useSecrets(SECRET_B, [SECRET_A]);
  nextCodePeriod();
  expect(await useSecondFactor(user.id, await generate({ secret }))).toBe('totp');
  expect((await repo.findTotp(user.id))!.secret).not.toBe(sealedUnderA);

  useSecrets(SECRET_B);
  nextCodePeriod();
  expect(await useSecondFactor(user.id, await generate({ secret }))).toBe('totp');
});

it('people who do not sign in during a rotation are re-sealed by the job before the previous secret is dropped', async () => {
  useSecrets(SECRET_A);
  const idle = await enrolled();
  useSecrets(SECRET_C);
  const orphan = await enrolled(); // under a secret the rotation below never lists

  useSecrets(SECRET_B, [SECRET_A]);
  const first = await resealTwoFactorSecrets(1); // a batch of 1: paging must not skip anyone
  expect(first.resealed).toBeGreaterThanOrEqual(1);
  expect(first.unreadable).toBeGreaterThanOrEqual(1);
  expect((await resealTwoFactorSecrets()).resealed).toBe(0);

  useSecrets(SECRET_B);
  nextCodePeriod();
  expect(await useSecondFactor(idle.user.id, await generate({ secret: idle.secret }))).toBe('totp');
  // Unreadable: a refused code (the recovery codes still work), never an error.
  expect(await useSecondFactor(orphan.user.id, await generate({ secret: orphan.secret }))).toBeNull();
  expect(await useSecondFactor(orphan.user.id, orphan.recoveryCodes[0])).toBe('recovery');
});
