// SCIM users: the directory's `active` flag and the workspace's deactivation stay in step.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser as createAccount } from '../auth/index';
import { verifyDomainForTests } from '../sso/index';
import { createTeamWorkspace, isDeactivatedMember } from '../workspaces/index';
import * as repo from './repo';
import { createUser, replaceUser } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

it('a deprovisioning and a reactivation the directory sends at once never leave the person active in the directory but locked out of the workspace', async () => {
  const domain = `scim-race-${Date.now()}.test`;
  const owner = await createAccount({ name: 'Owner', email: `owner@${domain}`, password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Corp');
  await verifyDomainForTests(ws.id, owner.id, domain);
  const body = (active: boolean) => ({ userName: `alice@${domain}`, emails: [{ value: `alice@${domain}`, primary: true }], active });
  const alice = await createUser(ws.id, body(true));

  for (const order of [
    [false, true],
    [true, false],
    [false, true],
  ]) {
    await Promise.all(order.map((active) => replaceUser(ws.id, alice.userId, body(active))));
    const recorded = (await repo.getUser(ws.id, alice.userId))!.active;
    expect({ order, recorded, locked: await isDeactivatedMember(ws.id, alice.userId) }).toEqual({ order, recorded, locked: !recorded });
  }
});
