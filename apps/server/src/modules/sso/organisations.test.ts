// #108: an organisation's single sign-on — its verified domain, its identity provider, "Enforce SSO"
// — applies to the people of every workspace attached to it.
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { applyDirectoryMembership, attachWorkspace, createOrganisation, createTeamWorkspace } from '../workspaces/index';
import { saveConnection, setEnforcement, ssoMethod } from './connections';
import { setTxtLookupForTests, txtName, txtValue } from './dns';
import { addDomain, verifyDomain } from './domains';
import { enforcedSsoRestriction } from './policy';
import * as repo from './repo';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());
afterEach(() => setTxtLookupForTests(null));

let n = 0;
const at = (domain: string, label: string): Promise<Account> =>
  createUser({ name: label, email: `${label}-${++n}@${domain}`, password: 'password-123' }, { emailVerified: true });

it('the organisation’s "Enforce SSO" refuses password and provider sign-in for its domain’s people in every attached workspace, and sends them to the organisation’s identity provider', async () => {
  const domain = `group-${Date.now()}.test`;
  const [owner, alice, bob] = [await at(domain, 'owner'), await at(domain, 'alice'), await at(domain, 'bob')];
  const org = await createOrganisation(owner.id, 'Group');
  const [design, sales] = [await createTeamWorkspace(owner.id, 'Design'), await createTeamWorkspace(owner.id, 'Sales')];
  await attachWorkspace(org.id, design.id, owner.id);
  await attachWorkspace(org.id, sales.id, owner.id);
  // Alice works only in Sales and Bob only in Design: neither is in the organisation's directory yet.
  await applyDirectoryMembership(sales.id, alice.id, 'member', { overwrite: false });
  await applyDirectoryMembership(design.id, bob.id, 'member', { overwrite: false });

  await addDomain(org.id, owner.id, domain);
  const claim = (await repo.listDomains(org.id))[0];
  setTxtLookupForTests(async (name) => (name === txtName(domain) ? [txtValue(claim.token)] : []));
  await verifyDomain(org.id, claim.id, owner.id);
  await saveConnection(org.id, owner.id, { protocol: 'oidc', enabled: true, oidcIssuer: 'https://idp.group.example', oidcClientId: 'c', oidcClientSecret: 's' });
  await repo.markTested(org.id, Date.now(), (await repo.getConnection(org.id))!.updatedAt);
  await setEnforcement(org.id, { id: owner.id, role: 'owner' }, { enforced: true, breakGlassUserId: owner.id });

  for (const person of [alice, bob]) {
    for (const method of ['password', 'google', ssoMethod(sales.id)]) {
      const r = await enforcedSsoRestriction({ email: person.email, userId: person.id, method });
      expect(r?.ssoUrl, `${person.email} via ${method}`).toContain(`/api/sso/${org.id}/start`);
    }
    expect(await enforcedSsoRestriction({ email: person.email, userId: person.id, method: ssoMethod(org.id) })).toBeNull();
  }
  // The break-glass owner of the organisation keeps password sign-in for repairs.
  expect(await enforcedSsoRestriction({ email: owner.email, userId: owner.id, method: 'password' })).toBeNull();
  // A workspace of the organisation can't take the domain for an identity provider of its own.
  await addDomain(sales.id, owner.id, domain);
  const second = (await repo.listDomains(sales.id))[0];
  setTxtLookupForTests(async (name) => (name === txtName(domain) ? [txtValue(second.token)] : []));
  await expect(verifyDomain(sales.id, second.id, owner.id)).rejects.toMatchObject({ status: 409 });
});
