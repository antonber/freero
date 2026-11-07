import { generate } from 'otplib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, mailedLink, openTestDb } from '../../platform/testing';
import { confirmEmailChange, requestEmailChange } from './emails';
import type { ProviderClaims } from './oidc';
import {
  connectIdentity,
  disconnectIdentity,
  linkProvider,
  provisionDirectoryAccount,
  resolveDirectoryLogin,
  resolveProviderLogin,
} from './providers';
import * as repo from './repo';
import { checkCredentials, confirmPassword, createUser, hashToken, newToken, RECENT_AUTH_MS } from './service';
import { beginTwoFactorSetup, enableTwoFactor } from './twoFactor';

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
  // Already before the second step (one the squatter may have set up) and the connection.
  await expect(checkCredentials(address, 'squatter-pw')).rejects.toMatchObject({ status: 401 });
  expect(await repo.listSessions(squatter.id, Date.now())).toHaveLength(0);
  expect((await repo.findUserById(squatter.id))?.emailVerified).toBe(true);
  await connectIdentity(null, r.userId, r.link!);
  // From now on that provider account signs in to it directly.
  expect(await resolveProviderLogin('google', claims(address, true))).toMatchObject({ userId: squatter.id, link: null });
});

it('the last way into a passwordless account can not be disconnected, even by two racing requests', async () => {
  const address = email('passwordless');
  const r = await resolveProviderLogin('google', claims(address, true));
  if ('error' in r) throw new Error(r.error);
  expect(r.created).toBe(true);
  expect(await linkProvider(null, r.userId, 'microsoft', claims(email('ms'), true, 'https://ms.test'))).toBeNull();
  const [a, b] = await repo.listIdentities(r.userId);

  const results = await Promise.allSettled([disconnectIdentity(null, r.userId, a.id), disconnectIdentity(null, r.userId, b.id)]);
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

/**
 * Someone registers an address they don't own (never verified) and sets up every way back in they
 * can: a password, a session, two-step verification, their own provider sign-in, and a pending
 * move of the account to their own address.
 */
async function squat(address: string) {
  const user = await createUser({ name: 'Squatter', email: address, password: 'squatter-pw' });
  const key = hashToken(newToken());
  await repo.insertSession({ id: key.slice(0, 20), tokenHash: key, userId: user.id, now: Date.now(), expiresAt: Date.now() + 60_000, userAgent: '', ip: '' });
  const { secret } = await beginTwoFactorSetup(user.id, 'squatter-pw', Date.now());
  await enableTwoFactor(null, user.id, 'no-session', await generate({ secret }));
  expect(await linkProvider(null, user.id, 'github', claims(email('squatter-gh'), false, 'https://gh.test'))).toBeNull();
  const away = email('squatter-own');
  await requestEmailChange(null, user.id, away, 'squatter-pw');
  const moveLink = await mailedLink(away, /\/confirm-email\?token=([A-Za-z0-9_-]+)/);
  return { user, moveLink };
}

it("a workspace's directory (provisioning or single sign-on) never takes over an account whose address was never verified with what its creator set up", async () => {
  const provisioned = await squat(email('scim'));
  const signingIn = await squat(email('sso'));

  expect(await provisionDirectoryAccount(provisioned.user.email, 'Alice')).toEqual({ userId: provisioned.user.id, created: false });
  const r = await resolveDirectoryLogin('sso:ws-1', { issuer: 'https://idp.corp.test', subject: 'alice', email: signingIn.user.email, name: 'Alice' });
  expect(r.userId).toBe(signingIn.user.id);

  for (const { user, moveLink } of [provisioned, signingIn]) {
    // Before the workspace grants anything: the creator's password, sessions, second step, own
    // sign-in and pending address change are gone, and the address counts as proven.
    await expect(checkCredentials(user.email, 'squatter-pw')).rejects.toMatchObject({ status: 401 });
    expect(await repo.listSessions(user.id, Date.now())).toHaveLength(0);
    expect(await repo.twoFactorEnabled(user.id)).toBe(false);
    expect(await repo.listIdentities(user.id)).toHaveLength(0);
    await expect(confirmEmailChange(null, moveLink)).rejects.toMatchObject({ status: 400 });
    expect(await repo.findUserById(user.id)).toMatchObject({ email: user.email, emailVerified: true });
  }
});
