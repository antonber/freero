import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, signupRefusal } from '../auth/index';
import initWorkspaces from './init';
import { inviteToWorkspace } from './invites';
import { createTeamWorkspace } from './service';

const shutdown: Array<() => void> = [];
beforeAll(async () => {
  const config = await openTestDb({ SIGNUPS: 'invite-only', SIGNUP_DOMAINS: 'allowed.test' });
  initWorkspaces({ config, onShutdown: (fn) => void shutdown.push(fn) }); // registers "an invited address is expected"
});
afterAll(async () => {
  for (const fn of shutdown) fn();
  await closeTestDb();
});

it('an invite-only server lets an address with a live workspace invite sign up', async () => {
  expect(await signupRefusal('guest@nowhere.test')).not.toBeNull();
  const owner = await createUser({ name: 'Owner', email: 'owner@allowed.test', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Team');
  await inviteToWorkspace(null, ws.id, owner, { email: 'guest@nowhere.test', role: 'member' });
  expect(await signupRefusal('guest@nowhere.test')).toBeNull();
});
