// IdP-initiated SAML (#107): the identity provider's app tile posts an unsolicited response to the
// workspace's ACS. Driven over real HTTP against the sso routes, with responses signed by a real
// key (scripts/lib/mock-saml.mjs) and validated by the real SAML stack.
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import { createTeamWorkspace, workspaceRole } from '../workspaces/index';
import { saveConnection } from './connections';
import { setTxtLookupForTests, txtName, txtValue } from './dns';
import { addDomain, verifyDomain } from './domains';
import * as repo from './repo';
import ssoRoutes from './routes';
import { unsolicitedReturnPath } from './signIn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

interface MockIdp {
  entityId: string;
  metadataXml(): string;
  buildResponse(o: Record<string, unknown>): string;
  close(): Promise<void>;
}

let server: http.Server;
let base = '';
let idp: MockIdp;
let other: MockIdp; // another identity provider, with its own key
const domain = `tile-${Date.now()}.test`;
let ws: { id: string };
let owner: { id: string };

beforeAll(async () => {
  const config = await openTestDb();
  const app = createApp(config);
  app.use('/api', ssoRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { startMockSaml } = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/mock-saml.mjs')).href)) as { startMockSaml: () => Promise<MockIdp> };
  [idp, other] = await Promise.all([startMockSaml(), startMockSaml()]);

  owner = await createUser({ name: 'Owner', email: `owner@${domain}`, password: 'password-123' }, { emailVerified: true });
  ws = await createTeamWorkspace(owner.id, 'Tile Co');
  await addDomain(ws.id, owner.id, domain);
  const claim = (await repo.listDomains(ws.id))[0];
  setTxtLookupForTests(async (name) => (name === txtName(domain) ? [txtValue(claim.token)] : []));
  await verifyDomain(ws.id, claim.id, owner.id);
  setTxtLookupForTests(null);
  await saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, samlMetadataXml: idp.metadataXml() });
});
afterAll(async () => {
  await Promise.all([idp?.close(), other?.close()]);
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

const acsUrl = () => `${base}/api/sso/${ws.id}/saml/acs`;
const audience = () => `${base}/api/sso/${ws.id}/saml/metadata`;
/** An unsolicited response (no InResponseTo), as an IdP tile sends it; fields can be overridden. */
const tile = (email: string, o: Record<string, unknown> = {}, from: MockIdp = idp) =>
  from.buildResponse({ email, acsUrl: acsUrl(), audience: audience(), ...o });

/** The IdP's page auto-posts the form cross-site; then the browser follows the 303 to …/finish. */
async function postFromTile(samlResponse: string, relay = '') {
  const acs = await fetch(acsUrl(), {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: 'http://idp.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relay }).toString(),
  });
  const location = acs.headers.get('location') ?? '';
  const binding = acs.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (!location.includes('/saml/finish')) return { acs: location, landed: location, session: false };
  const fin = await fetch(base + location, { redirect: 'manual', headers: { cookie: binding } });
  const session = fin.headers.getSetCookie().some((c) => c.startsWith('freero_session=') && !/Max-Age=0/i.test(c));
  return { acs: location, landed: fin.headers.get('location') ?? '', session };
}

const setIdpInitiated = (on: boolean) => saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, idpInitiated: on });

it('an unsolicited SAML response is refused with its own error while "Allow sign-in from the identity provider" is off (the default), and signs nobody in', async () => {
  const email = `off@${domain}`;
  expect((await repo.getConnection(ws.id))?.idpInitiated).toBe(false);
  const r = await postFromTile(tile(email));
  expect(r).toMatchObject({ landed: '/login?error=sso_unsolicited', session: false });
  const refused = await listAuditEvents({ workspaceId: ws.id, actions: ['sso.login_refused'] }, 5);
  expect(refused.some((e) => e.targetLabel === email && /IdP-initiated/.test(String(e.metadata.reason)))).toBe(true);
});

it('IdP-initiated sign-in: a signed unsolicited response signs the person in once (just in time, audited as started by the IdP); posting the same response again is refused as a replay', async () => {
  await setIdpInitiated(true);
  const email = `tile-user@${domain}`;
  const response = tile(email);
  const first = await postFromTile(response, '/board/abc?item=1');
  expect(first).toMatchObject({ landed: '/board/abc?item=1', session: true });
  const replay = await postFromTile(response, '/board/abc?item=1');
  expect(replay).toMatchObject({ landed: '/login?error=sso_failed', session: false });

  const logins = await listAuditEvents({ workspaceId: ws.id, actions: ['sso.login'] }, 10);
  const mine = logins.filter((e) => e.targetLabel === email);
  expect(mine).toHaveLength(1);
  expect(mine[0].metadata.initiatedBy).toBe('identity_provider');
  expect(await workspaceRole(ws.id, mine[0].actorId!)).toBe('member');
});

it("IdP-initiated responses that fail validation sign nobody in: another IdP's key, another audience, another Recipient, a Destination other than this ACS, past NotOnOrAfter", async () => {
  await setIdpInitiated(true);
  const email = `mallory@${domain}`;
  const past = Date.now() - 30 * 60_000;
  const cases: Record<string, string> = {
    'another key': tile(email, {}, other),
    'another audience': tile(email, { audience: 'https://elsewhere.example/sp' }),
    'another recipient': tile(email, { recipient: 'https://elsewhere.example/acs' }),
    'another destination': tile(email, { acsUrl: `${base}/api/sso/someone-else/saml/acs`, recipient: acsUrl() }),
    expired: tile(email, { now: past, issueInstant: past, notOnOrAfter: past + 5 * 60_000 }),
  };
  const accepted: string[] = [];
  for (const [name, response] of Object.entries(cases)) {
    const r = await postFromTile(response);
    if (r.session || r.landed !== '/login?error=sso_failed') accepted.push(`${name}: ${r.acs} -> ${r.landed}`);
  }
  expect(accepted).toEqual([]);
});

it('the RelayState of an IdP-initiated sign-in is honoured only as a same-origin path (no open redirect)', () => {
  const dashboard = '/app?ws=w1';
  for (const relay of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', '/\t/evil.example', ' /board/x', 'javascript:alert(1)', '/api/auth/logout', ''])
    expect(unsolicitedReturnPath(relay, 'w1'), relay).toBe(dashboard);
  expect(unsolicitedReturnPath('/board/abc?item=1', 'w1')).toBe('/board/abc?item=1');
});
