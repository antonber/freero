// SAML hardening (#13): the service provider's own key pairs (encrypted assertions, signed
// AuthnRequests) and single logout. Driven over real HTTP against the sso routes, with messages
// signed and encrypted by a real key pair (scripts/lib/mock-saml.mjs) and validated by the real
// SAML stack (node-saml).
import { createPublicKey, verify as rsaVerify } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler, handle } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, onSessionStarted, onSignOutRedirect, sessionKeyFromCookieHeader, userFromCookieHeader } from '../auth/index';
import { createTeamWorkspace } from '../workspaces/index';
import { saveConnection } from './connections';
import { setTxtLookupForTests, txtName, txtValue } from './dns';
import { addDomain, verifyDomain } from './domains';
import { recordSamlSession, samlSignOutRedirect } from './logout';
import * as repo from './repo';
import ssoRoutes from './routes';
import { createSpKey, promoteSpKey, usableKeys } from './spKeys';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

interface KeyPair {
  privateKeyPem: string;
  certPem: string;
}
interface MockIdp {
  entityId: string;
  certPem: string;
  sloUrl: string;
  metadataXml(): string;
  buildResponse(o: Record<string, unknown>): string;
  buildLogoutRequest(o: Record<string, unknown>): Promise<{ id: string; query?: string; body?: string }>;
  readLogoutRequest(url: URL): Promise<{ id: string; nameId: string | null; sessionIndex: string | null; destination: string | null }>;
  buildLogoutResponse(o: { inResponseTo: string; destination: string; sign?: boolean }): Promise<string>;
  close(): Promise<void>;
}

let server: http.Server;
let base = '';
let idp: MockIdp;
let stranger: MockIdp; // another identity provider, another key
let selfSigned: (cn: string) => KeyPair;
const stamp = Date.now();
const domainA = `slo-a-${stamp}.test`;
const domainB = `slo-b-${stamp}.test`;
let wsA: { id: string };
let wsB: { id: string };
let ownerA: { id: string };

async function verifiedTeam(ownerEmail: string, domain: string, name: string) {
  const owner = await createUser({ name: 'Owner', email: ownerEmail, password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, name);
  await addDomain(ws.id, owner.id, domain);
  const claim = (await repo.listDomains(ws.id))[0];
  setTxtLookupForTests(async (n) => (n === txtName(domain) ? [txtValue(claim.token)] : []));
  await verifyDomain(ws.id, claim.id, owner.id);
  setTxtLookupForTests(null);
  // IdP-initiated responses keep these tests short; what is checked is the same either way.
  await saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, samlMetadataXml: idp.metadataXml(), idpInitiated: true });
  return { owner, ws };
}

beforeAll(async () => {
  const config = await openTestDb();
  const app = createApp(config);
  // A password session through auth's one way in (completeSignIn), for "not a password session".
  app.get('/test/password-session/:userId', handle(async (req, res) => void res.json(await completeSignIn(req, res, req.params.userId, 'password'))));
  app.use('/api', ssoRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mock = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/mock-saml.mjs')).href)) as { startMockSaml: () => Promise<MockIdp> };
  ({ selfSignedCertificate: selfSigned } = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/test-cert.mjs')).href)) as { selfSignedCertificate: (cn: string) => KeyPair });
  [idp, stranger] = await Promise.all([mock.startMockSaml(), mock.startMockSaml()]);
  // What sso/init.ts registers in the app.
  onSessionStarted(recordSamlSession);
  onSignOutRedirect(samlSignOutRedirect);
  ({ owner: ownerA, ws: wsA } = await verifiedTeam(`owner@${domainA}`, domainA, 'SLO A'));
  ({ ws: wsB } = await verifiedTeam(`owner@${domainB}`, domainB, 'SLO B'));
});
afterAll(async () => {
  await Promise.all([idp?.close(), stranger?.close()]);
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

const acs = (ws: { id: string }) => `${base}/api/sso/${ws.id}/saml/acs`;
const slo = (ws: { id: string }) => `${base}/api/sso/${ws.id}/saml/slo`;
const audience = (ws: { id: string }) => `${base}/api/sso/${ws.id}/saml/metadata`;
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

/** Signs in through the workspace's ACS with a response the IdP built; the session cookie, or null. */
async function samlSignIn(ws: { id: string }, o: Record<string, unknown>, from: MockIdp = idp): Promise<string | null> {
  const response = from.buildResponse({ acsUrl: acs(ws), audience: audience(ws), ...o });
  const post = await fetch(acs(ws), {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: 'http://idp.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: response, RelayState: '' }).toString(),
  });
  const location = post.headers.get('location') ?? '';
  if (!location.includes('/saml/finish')) return null;
  const fin = await fetch(base + location, { redirect: 'manual', headers: { cookie: cookiesOf(post) } });
  const session = fin.headers.getSetCookie().find((c) => c.startsWith('freero_session=') && !/Max-Age=0/i.test(c));
  return session ? session.split(';')[0] : null;
}

async function passwordSession(userId: string): Promise<string> {
  const r = await fetch(`${base}/test/password-session/${userId}`, { redirect: 'manual' });
  return r.headers.getSetCookie().find((c) => c.startsWith('freero_session='))!.split(';')[0];
}

const alive = async (cookie: string | null) => !!cookie && (await userFromCookieHeader(cookie)) !== null;

/** The IdP's LogoutRequest arriving at `ws`'s SLO endpoint, over either binding. */
async function sendLogout(ws: { id: string }, o: Record<string, unknown>, from: MockIdp = idp) {
  const m = await from.buildLogoutRequest({ destination: slo(ws), ...o });
  return m.query !== undefined
    ? fetch(`${slo(ws)}?${m.query}`, { redirect: 'manual' })
    : fetch(slo(ws), {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: 'http://idp.example', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLRequest: m.body! }).toString(),
      });
}

it("the IdP's signed LogoutRequest ends only the SAML sessions of its NameID in that workspace — not the same person's password session, not another workspace's session with that NameID — and is answered at the IdP", async () => {
  const email = `lena@${domainA}`;
  const samlA = await samlSignIn(wsA, { email, nameId: 'employee-7' });
  const samlA2 = await samlSignIn(wsA, { email, nameId: 'employee-7' }); // a second browser
  const colleague = await samlSignIn(wsA, { email: `kai@${domainA}`, nameId: 'employee-8' });
  const user = await userFromCookieHeader(samlA!);
  const password = await passwordSession(user!.id);
  // Another workspace that trusts the same IdP and happens to know someone by the same NameID.
  const elsewhere = await samlSignIn(wsB, { email: `lena@${domainB}`, nameId: 'employee-7' });
  expect(await Promise.all([samlA, samlA2, colleague, password, elsewhere].map(alive))).toEqual([true, true, true, true, true]);

  const r = await sendLogout(wsA, { nameId: 'employee-7' });
  expect(r.status).toBe(303);
  // Answered with a LogoutResponse at the IdP's single logout service (its metadata named it).
  const answer = new URL(r.headers.get('location')!);
  expect(`${answer.origin}${answer.pathname}`).toBe(idp.sloUrl);
  expect(answer.searchParams.has('SAMLResponse')).toBe(true);
  expect(await Promise.all([samlA, samlA2, colleague, password, elsewhere].map(alive))).toEqual([false, false, true, true, true]);
});

it('a LogoutRequest naming a SessionIndex (HTTP-POST binding) ends only the sign-in it names', async () => {
  const email = `omar@${domainA}`;
  const laptop = await samlSignIn(wsA, { email, nameId: 'employee-9', sessionIndex: '_laptop' });
  const phone = await samlSignIn(wsA, { email, nameId: 'employee-9', sessionIndex: '_phone' });
  const r = await sendLogout(wsA, { nameId: 'employee-9', sessionIndex: '_phone', binding: 'post' });
  expect(r.status).toBe(303);
  expect([await alive(laptop), await alive(phone)]).toEqual([true, false]);
});

it('a LogoutRequest that is unsigned, signed by another key, from another issuer, addressed to another service provider, issued long ago, or replayed ends no session', async () => {
  const email = `mallory-target@${domainA}`;
  const victim = await samlSignIn(wsA, { email, nameId: 'employee-10' });
  const old = Date.now() - 30 * 60_000;
  const cases: Record<string, Record<string, unknown>> = {
    'unsigned (redirect)': { sign: false },
    'unsigned (post)': { sign: false, binding: 'post' },
    'another key': { key: selfSigned('Not the IdP') },
    'another issuer': { issuer: 'https://evil.example/idp' },
    'another service provider': { destination: 'https://other-app.example/saml/slo' },
    'issued long ago': { issueInstant: old },
  };
  const ended: string[] = [];
  for (const [name, o] of Object.entries(cases)) {
    const r = await sendLogout(wsA, { nameId: 'employee-10', ...o });
    if (!(await alive(victim)) || !(r.headers.get('location') ?? '').startsWith('/login')) ended.push(name);
  }
  expect(ended).toEqual([]);

  // A captured valid request works once; replayed after the person signed in again, it ends nothing.
  const captured = await idp.buildLogoutRequest({ destination: slo(wsA), nameId: 'employee-10' });
  await fetch(`${slo(wsA)}?${captured.query}`, { redirect: 'manual' });
  expect(await alive(victim)).toBe(false);
  const again = await samlSignIn(wsA, { email, nameId: 'employee-10' });
  const replay = await fetch(`${slo(wsA)}?${captured.query}`, { redirect: 'manual' });
  expect(replay.headers.get('location')).toBe('/login?error=sso_failed');
  expect(await alive(again)).toBe(true);
});

it('signing out of a SAML session sends the browser on to the IdP with a LogoutRequest for that NameID and SessionIndex, signed with the key the metadata publishes; the IdP’s answer lands on the sign-in page', async () => {
  await createSpKey(wsA.id, ownerA.id);
  await saveConnection(wsA.id, ownerA.id, { protocol: 'saml', enabled: true, signRequests: true });
  const cookie = await samlSignIn(wsA, { email: `sam@${domainA}`, nameId: 'employee-11', sessionIndex: '_desk' });
  const redirect = await samlSignOutRedirect(sessionKeyFromCookieHeader(cookie!)!, { protocol: 'http', get: () => new URL(base).host } as never);
  const url = new URL(redirect!);
  expect(`${url.origin}${url.pathname}`).toBe(idp.sloUrl);
  const sent = await idp.readLogoutRequest(url);
  expect([sent.nameId, sent.sessionIndex]).toEqual(['employee-11', '_desk']);
  expect(verifiesWithPublishedCert(url.search.slice(1), 'SAMLRequest', await metadataCerts(wsA))).toBe(true);
  // The IdP's signed answer to it, and an answer to a request we never sent.
  const answer = await idp.buildLogoutResponse({ inResponseTo: sent.id, destination: slo(wsA) });
  expect((await fetch(`${slo(wsA)}?${answer}`, { redirect: 'manual' })).headers.get('location')).toBe('/login');
});

// ---- the service provider's keys ----

/** The certificates our SP metadata publishes (base64 DER bodies). */
async function metadataCerts(ws: { id: string }): Promise<string[]> {
  const xml = await (await fetch(audience(ws))).text();
  return [...xml.matchAll(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/g)].map((m) => m[1]);
}

/** Whether a redirect-binding query is signed (SigAlg + Signature) by one of these certificates. */
function verifiesWithPublishedCert(query: string, param: 'SAMLRequest' | 'SAMLResponse', certs: string[]): boolean {
  const parts = Object.fromEntries(query.split('&').map((kv) => [kv.split('=')[0], kv.slice(kv.indexOf('=') + 1)]));
  if (!parts.Signature || !parts.SigAlg) return false;
  const octets = [param, 'RelayState', 'SigAlg'].filter((k) => parts[k] !== undefined).map((k) => `${k}=${parts[k]}`).join('&');
  const signature = Buffer.from(decodeURIComponent(parts.Signature), 'base64');
  return certs.some((c) => rsaVerify('sha256', Buffer.from(octets), createPublicKey(`-----BEGIN CERTIFICATE-----\n${c}\n-----END CERTIFICATE-----`), signature));
}

it('with "Sign requests" the AuthnRequest is signed by a key whose certificate the SP metadata publishes; without it, it goes unsigned', async () => {
  const { ws, owner } = await verifiedTeam(`owner@signed-${stamp}.test`, `signed-${stamp}.test`, 'Signed');
  const start = async () => new URL((await fetch(`${base}/api/sso/${ws.id}/start`, { redirect: 'manual' })).headers.get('location')!);
  expect((await start()).searchParams.has('Signature')).toBe(false);
  await createSpKey(ws.id, owner.id);
  await saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, signRequests: true });
  const url = await start();
  expect(verifiesWithPublishedCert(url.search.slice(1), 'SAMLRequest', await metadataCerts(ws))).toBe(true);
  // Signed by some other key: the published certificate doesn't verify it.
  expect(verifiesWithPublishedCert(url.search.slice(1), 'SAMLRequest', [stranger.certPem.replace(/-----[A-Z ]+-----|\s/g, '')])).toBe(false);
  expect(await (await fetch(audience(ws))).text()).toContain('AuthnRequestsSigned="true"');
});

it('an assertion encrypted to the workspace’s key signs in, one encrypted to another key is refused, and during a rotation both the old and the new key decrypt', async () => {
  const domain = `enc-${stamp}.test`;
  const { ws, owner } = await verifiedTeam(`owner@${domain}`, domain, 'Encrypted');
  await createSpKey(ws.id, owner.id);
  const pem = (b64: string) => `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
  const [first] = (await metadataCerts(ws)).map(pem);
  expect(await samlSignIn(ws, { email: `a@${domain}`, encryptTo: first })).not.toBeNull();
  expect(await samlSignIn(ws, { email: `b@${domain}`, encryptTo: selfSigned('Someone else').certPem })).toBeNull();

  // Rotation: the next key is published next to the current one; once it's current, an IdP still
  // encrypting to the old certificate keeps working until the old key is removed.
  await createSpKey(ws.id, owner.id);
  const next = (await repo.listSpKeys(ws.id)).find((k) => !k.current)!;
  await promoteSpKey(ws.id, next.id, owner.id);
  expect(await samlSignIn(ws, { email: `c@${domain}`, encryptTo: first })).not.toBeNull();
  expect(await samlSignIn(ws, { email: `d@${domain}`, encryptTo: next.certificate })).not.toBeNull();
});

it('with "Require encrypted assertions" a signed assertion that arrives in the clear is refused', async () => {
  const domain = `req-${stamp}.test`;
  const { ws, owner } = await verifiedTeam(`owner@${domain}`, domain, 'Required');
  await expect(saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, requireEncryptedAssertions: true })).rejects.toMatchObject({ status: 400 });
  await createSpKey(ws.id, owner.id);
  await saveConnection(ws.id, owner.id, { protocol: 'saml', enabled: true, requireEncryptedAssertions: true });
  const cert = (await repo.listSpKeys(ws.id))[0].certificate;
  expect(await samlSignIn(ws, { email: `clear@${domain}` })).toBeNull();
  expect(await samlSignIn(ws, { email: `sealed@${domain}`, encryptTo: cert })).not.toBeNull();
});

it('the SP private key is stored sealed and no answer — settings or metadata — carries it', async () => {
  const domain = `secret-${stamp}.test`;
  const { ws, owner } = await verifiedTeam(`owner@${domain}`, domain, 'Secret');
  await createSpKey(ws.id, owner.id);
  const cookie = await passwordSession(owner.id);
  const answers = [
    await (await fetch(`${base}/api/workspaces/${ws.id}/sso`, { headers: { cookie } })).text(),
    await (await fetch(`${base}/api/workspaces/${ws.id}/sso/sp-keys`, { method: 'POST', headers: { cookie, origin: base } })).text(),
    await (await fetch(audience(ws))).text(),
  ];
  const keys = await usableKeys(ws.id);
  expect(keys).toHaveLength(2);
  const stored = await repo.listSpKeys(ws.id);
  expect(answers[0]).toContain('BEGIN CERTIFICATE');
  for (const k of keys) {
    // A distinctive run of the key's own bytes: in no answer, and not in the stored (sealed) row.
    const secret = k.privateKeyPem.replace(/-----[A-Z ]+-----|\s/g, '').slice(200, 260);
    for (const a of answers) expect(a.replace(/\\n|\s/g, '')).not.toContain(secret);
    expect(stored.find((s) => s.id === k.id)!.privateKey).not.toContain(secret);
  }
  for (const a of answers) expect(a).not.toMatch(/PRIVATE KEY|privateKey/);
});

it('an SP certificate whose random serial starts with a zero byte still parses (about 1 key in 128 failed with "illegal padding")', async () => {
  const { derInteger } = await import('./spKeys');
  // 00 12 ... must encode minimally as 02 01 12 ..., never keep the leading zero; 00 92 keeps it (top bit set).
  expect([...derInteger(Buffer.from([0x00, 0x12, 0x34]))]).toEqual([0x02, 0x02, 0x12, 0x34]);
  expect([...derInteger(Buffer.from([0x00, 0x92]))]).toEqual([0x02, 0x02, 0x00, 0x92]);
  expect([...derInteger(Buffer.from([0x92]))]).toEqual([0x02, 0x02, 0x00, 0x92]);
});
