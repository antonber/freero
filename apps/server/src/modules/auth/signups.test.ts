import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import initWorkspaces from '../workspaces/init';
import { resolveProviderLogin } from './providers';
import { createUser } from './service';
import { signupRefusal } from './signups';

const shutdown: Array<() => void> = [];
beforeAll(async () => {
  const config = await openTestDb({ SIGNUPS: 'invite-only', SIGNUP_DOMAINS: 'allowed.test', OPERATOR_EMAILS: 'ops@freero.test' });
  // workspaces/init.ts registers "an invited address is expected" (and its other startup work).
  initWorkspaces({ config, onShutdown: (fn) => void shutdown.push(fn) });
});
afterAll(async () => {
  for (const fn of shutdown) fn();
  await closeTestDb();
});

it('an invite-only server makes no account for an address nobody expects (password or a personal provider), but does for an invited address, an allowed domain and an operator', async () => {
  expect(await signupRefusal('stranger@nowhere.test')).toMatch(/by invitation/);
  const provider = await resolveProviderLogin('google', { issuer: 'https://accounts.google.test', subject: 's-1', email: 'stranger@nowhere.test', emailVerified: true, name: 'S' });
  expect(provider).toEqual({ error: 'signup_closed' });

  const owner = await createUser({ name: 'Owner', email: 'owner@allowed.test', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Team');
  await inviteToWorkspace(null, ws.id, owner, { email: 'guest@nowhere.test', role: 'member' });
  expect(await signupRefusal('guest@nowhere.test')).toBeNull();
  expect(await signupRefusal('anyone@allowed.test')).toBeNull();
  expect(await signupRefusal('ops@freero.test')).toBeNull();
});
