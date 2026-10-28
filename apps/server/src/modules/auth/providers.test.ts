import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import type { ProviderClaims } from './oidc';
import { connectIdentity, disconnectIdentity, linkProvider, resolveProviderLogin } from './providers';
import * as repo from './repo';
import { checkCredentials, confirmPassword, createUser, hashToken, newToken, RECENT_AUTH_MS } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const email = (label: string) => `${label}-${++n}@providers.test.freero.app`;
const claims = (address: string, emailVerified: boolean, issuer = 'https://idp.test'): ProviderClaims => ({
  issuer,
  subject: `sub-${address}`,
  email: address,
  emailVerified,
  name: 'Person',
});

it('a provider that does not vouch for an address can not sign in to the account that uses it', async () => {
  const address = email('unvouched');
  const owner = await createUser({ name: 'Owner', email: address, password: 'password-123' }, { emailVerified: true });
  expect(await resolveProviderLogin('google', claims(address, false))).toEqual({ error: 'email_in_use' });
  expect(await repo.listIdentities(owner.id)).toHaveLength(0);
});

it('a provider-verified sign-in takes over an account whose address was never confirmed: the old password and sessions stop working', async () => {
  const address = email('squatted');
  // Someone registered the address without proving it, and is signed in.
  const squatter = await createUser({ name: 'Squatter', email: address, password: 'squatter-pw' });
  const key = hashToken(newToken());
  await repo.insertSession({ id: key.slice(0, 20), tokenHash: key, userId: squatter.id, now: Date.now(), expiresAt: Date.now() + 60_000, userAgent: '', ip: '' });

  const r = await resolveProviderLogin('google', claims(address, true));
  if ('error' in r) throw new Error(r.error);
  expect(r.userId).toBe(squatter.id);
  await connectIdentity(r.userId, r.link!);

  await expect(checkCredentials(address, 'squatter-pw')).rejects.toMatchObject({ status: 401 });
  expect(await repo.listSessions(squatter.id, Date.now())).toHaveLength(0);
  expect((await repo.findUserById(squatter.id))?.emailVerified).toBe(true);
  // From now on that provider account signs in to it directly.
  expect(await resolveProviderLogin('google', claims(address, true))).toMatchObject({ userId: squatter.id, link: null });
});

it('the last way into a passwordless account can not be disconnected, even by two racing requests', async () => {
  const address = email('passwordless');
  const r = await resolveProviderLogin('google', claims(address, true));
  if ('error' in r) throw new Error(r.error);
  expect(r.created).toBe(true);
  expect(await linkProvider(r.userId, 'microsoft', claims(email('ms'), true, 'https://ms.test'))).toBeNull();
  const [a, b] = await repo.listIdentities(r.userId);

  const results = await Promise.allSettled([disconnectIdentity(r.userId, a.id), disconnectIdentity(r.userId, b.id)]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((x) => x.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  expect(await repo.listIdentities(r.userId)).toHaveLength(1);
});

it('a passwordless account has no password to guess and confirms sensitive changes only with a recent sign-in', async () => {
  const address = email('recent');
  const r = await resolveProviderLogin('google', claims(address, true));
  if ('error' in r) throw new Error(r.error);
  await expect(checkCredentials(address, '')).rejects.toMatchObject({ status: 401 });
  await expect(confirmPassword(r.userId, undefined, Date.now() - RECENT_AUTH_MS - 1000)).rejects.toMatchObject({
    status: 403,
    code: 'reauth_required',
  });
  await expect(confirmPassword(r.userId, undefined, Date.now() - 60_000)).resolves.toMatchObject({ id: r.userId });
});
