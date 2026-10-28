import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { applyDirectoryMembership, createTeamWorkspace, transferWorkspace } from '../workspaces/index';
import { saveConnection, setEnforcement, ssoMethod } from './connections';
import { setTxtLookupForTests, txtName, txtValue } from './dns';
import { addDomain, verifyDomain } from './domains';
import { enforcedSsoRestriction } from './policy';
import * as repo from './repo';
import { parseIdpMetadata } from './saml';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());
afterEach(() => setTxtLookupForTests(null));

// A self-signed certificate (scripts/lib/test-cert.mjs); parsing never checks its validity dates.
const CERT =
  'MIICsDCCAZigAwIBAgIMJv8BsDIVp6gsUOEMMA0GCSqGSIb3DQEBCwUAMBYxFDASBgNVBAMMC0ZpeHR1cmUgSWRQMB4XDTI2MTAyNzE5MDcyMVoXDTM2MTAyNTE5MDcyMVowFjEUMBIGA1UEAwwLRml4dHVyZSBJZFAwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCiWSUmoPHq2Lgx18IZ/5KWJNHWyrINprLOSpAmrVaJK+TYc1wrP1kXdS3Zmi1jmcsaTVtdFMpgRsroy7wd8kFoHsgf1EhOKWjXPKHW52q9I6hLXOyYPl7S8G3N6jCdsNphmV3bJuc9/qpYN2GjtX8UuG4bIRsBu68W42oZrQqCmyD5v3UCpSDkAo/TI4JVuJuhD8WkkJfMWwuUcnr/M1/7hiScFLWAX6ZwMTTvnczT3xs0L2SlcL7zl9Z2yNdpVmOI70jVOncozlT2aGqX7BN8WjSYdnXjYaqyi2eWqJ0BFWyf/BXv4roP0qnHkkuXPRSPBvcdilQlu4PFDHJC39+VAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAJc9CZOuDYHl1BeHzkAqocCEfrAwAmdTyocqwHa+PMNiEWo0cLgxKSIWy2/wqEkC9uIMQ8/PZBuy0ffn1mnD3zDpAhkrTg/cbYktl3EGzQgmG7fLSFbCE569YeY+0fjLeG7C2D2e12yoAivo8Yb86oAbfSCFVgIvDibv9u/zQMl/3E6fG/Ggj5ccMAVU7VylunOThP9GZXU34iYSCFXGxohBZ1vNiMbCRGo2/aGxI7wWjbnh34v3KM4gkvAG0zB7Z9isCI40pGm0aWiFBe6QrI2eEwIWzQ048+PPIhX08JCt+uX0/Ef8euXfepu4zrWzfKmg4T8BpygvDTJUQ+p3nC4=';

const metadata = (extra = '') => `<?xml version="1.0"?>${extra}
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://idp.example/entity">
 <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
  <md:KeyDescriptor use="encryption"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${CERT.replace('MIIC', 'MIID')}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
  <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>
   ${CERT.match(/.{1,76}/g)!.join('\n   ')}
  </ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
  <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example/post"/>
  <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example/redirect"/>
 </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

it("IdP metadata yields its entity ID, the Redirect-binding SSO URL and only its SIGNING certificate; a DOCTYPE (entity expansion) is refused", () => {
  const m = parseIdpMetadata(metadata());
  expect(m.entityId).toBe('https://idp.example/entity');
  expect(m.ssoUrl).toBe('https://idp.example/redirect');
  expect(m.certs).toHaveLength(1);
  expect(m.certs[0].replace(/-----[A-Z ]+-----|\s/g, '')).toBe(CERT);
  expect(() => parseIdpMetadata(metadata('<!DOCTYPE x [<!ENTITY e "boom">]>'))).toThrow(/DOCTYPE/);
  expect(() => parseIdpMetadata(metadata().replace(/<md:KeyDescriptor use="signing">[\s\S]*?<\/md:KeyDescriptor>/, ''))).toThrow(/signing certificate/);
});

let n = 0;
const at = (domain: string, label: string): Promise<Account> =>
  createUser({ name: label, email: `${label}-${++n}@${domain}`, password: 'password-123' }, { emailVerified: true });

it('"Enforce SSO" refuses other ways in for the domain; the break-glass exemption ends when that person is no longer an owner', async () => {
  const domain = `enforced-${Date.now()}.test`;
  const [owner, other] = [await at(domain, 'owner'), await at(domain, 'other')];
  const ws = await createTeamWorkspace(owner.id, 'Enforced');
  await applyDirectoryMembership(ws.id, other.id, 'member', { overwrite: false });
  await addDomain(ws.id, domain);
  const claim = (await repo.listDomains(ws.id))[0];
  setTxtLookupForTests(async (name) => (name === txtName(domain) ? [txtValue(claim.token)] : []));
  await verifyDomain(ws.id, claim.id, owner.id);
  await saveConnection(ws.id, owner.id, { protocol: 'oidc', enabled: true, oidcIssuer: 'https://idp.example', oidcClientId: 'c', oidcClientSecret: 's' });
  await repo.markTested(ws.id, Date.now());
  await setEnforcement(ws.id, { id: owner.id, role: 'owner' }, { enforced: true, breakGlassUserId: owner.id });

  const attempt = (u: Account, method: string) => enforcedSsoRestriction({ email: u.email, userId: u.id, method });
  expect(await attempt(other, 'password')).not.toBeNull();
  expect(await attempt(other, 'google')).not.toBeNull();
  expect(await attempt(other, ssoMethod(ws.id))).toBeNull();
  expect(await enforcedSsoRestriction({ email: `new@${domain}`, userId: null, method: 'password' })).not.toBeNull();
  expect(await enforcedSsoRestriction({ email: 'someone@elsewhere.test', userId: null, method: 'password' })).toBeNull();
  expect(await attempt(owner, 'password')).toBeNull();
  // Handing the workspace over makes the break-glass person an admin: no more exemption.
  await transferWorkspace(ws.id, owner.id, other.id);
  expect(await attempt(owner, 'password')).not.toBeNull();
});

it('pointing the connection at another identity provider turns enforcement off until a sign-in proves the new one', async () => {
  const domain = `switch-${Date.now()}.test`;
  const owner = await at(domain, 'owner');
  const ws = await createTeamWorkspace(owner.id, 'Switching');
  const conn = { protocol: 'oidc' as const, enabled: true, oidcIssuer: 'https://idp-a.example', oidcClientId: 'c', oidcClientSecret: 's' };
  const actor = { id: owner.id, role: 'owner' as const };
  await saveConnection(ws.id, owner.id, conn);
  await repo.markTested(ws.id, Date.now());
  await setEnforcement(ws.id, actor, { enforced: true, breakGlassUserId: owner.id });
  await saveConnection(ws.id, owner.id, { ...conn, sessionHours: 4 }); // same provider: still enforced
  expect((await repo.getConnection(ws.id))?.enforced).toBe(true);
  await saveConnection(ws.id, owner.id, { ...conn, oidcIssuer: 'https://idp-b.example' });
  const after = await repo.getConnection(ws.id);
  expect([after?.enforced, after?.testedAt]).toEqual([false, null]);
  await expect(setEnforcement(ws.id, actor, { enforced: true, breakGlassUserId: owner.id })).rejects.toMatchObject({ status: 409 });
});
