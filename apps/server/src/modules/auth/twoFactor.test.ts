import { generate } from 'otplib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser } from './service';
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, useSecondFactor } from './twoFactor';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const nowS = () => Math.floor(Date.now() / 1000);

async function enrolled() {
  const user = await createUser({ name: 'Two', email: `two-${++n}@auth.test.freero.app`, password: 'password-123' });
  const { secret } = await beginTwoFactorSetup(user.id, 'password-123', Date.now());
  const enrolCode = await generate({ secret });
  const recoveryCodes = await enableTwoFactor(user.id, 'no-session', enrolCode);
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

  await expect(disableTwoFactor(user.id, 'wrong-password', recoveryCodes[1], Date.now())).rejects.toMatchObject({ status: 403 });
  await expect(disableTwoFactor(user.id, 'password-123', '123456', Date.now())).rejects.toMatchObject({ status: 403 });
  expect(await repo.twoFactorEnabled(user.id)).toBe(true);
  await disableTwoFactor(user.id, 'password-123', recoveryCodes[1], Date.now());
  expect(await repo.twoFactorEnabled(user.id)).toBe(false);
  // The remaining recovery codes went with it.
  expect(await useSecondFactor(user.id, recoveryCodes[2])).toBeNull();
});
