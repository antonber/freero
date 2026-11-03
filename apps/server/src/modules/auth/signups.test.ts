import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { resolveProviderLogin } from './providers';
import { signupRefusal } from './signups';

beforeAll(() => openTestDb({ SIGNUPS: 'invite-only', SIGNUP_DOMAINS: 'allowed.test', OPERATOR_EMAILS: 'ops@freero.test' }));
afterAll(() => closeTestDb());

it('an invite-only server makes no account for an address nobody expects, by password or a first personal-provider sign-in, but does for an allowed domain and an operator', async () => {
  expect(await signupRefusal('stranger@nowhere.test')).toMatch(/by invitation/);
  const provider = await resolveProviderLogin('google', { issuer: 'https://accounts.google.test', subject: 's-1', email: 'stranger@nowhere.test', emailVerified: true, name: 'S' });
  expect(provider).toEqual({ error: 'signup_closed' });
  expect(await signupRefusal('anyone@allowed.test')).toBeNull();
  expect(await signupRefusal('ops@freero.test')).toBeNull();
});
