// Push notifications to the phone and tablet apps (#177), against stand-in push services on real
// sockets: APNs over HTTP/2 (cleartext, the same requests Apple gets) and FCM's HTTP v1 API with its
// OAuth token endpoint. Devices register through the real routes, signed in with real sessions.
import http from 'node:http';
import http2 from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, endSessionsOf, sessionKeyFromCookieHeader } from '../auth/index';
import { notify } from '../notifications/index';
import initMobile from './init';
import mobileRoutes from './routes';
import { devicesOf } from './repo';

type Got = { platform: 'ios' | 'android'; token: string; title: string; path: string };
let got: Got[] = [];
const deadApnsTokens = new Set<string>();
let apns: http2.Http2Server;
const apnsSessions = new Set<http2.ServerHttp2Session>();
let fcm: http.Server;
let server: http.Server;
let base = '';

const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

const listen = async (s: http.Server | http2.Http2Server) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  apns = http2.createServer();
  apns.on('session', (s) => apnsSessions.add(s));
  apns.on('stream', (stream, headers) => {
    let body = '';
    stream.on('data', (c: Buffer) => (body += c));
    stream.on('end', () => {
      // Apple checks the provider token: an ES256 JWT signed with the auth key.
      const [h, c, sig] = String(headers.authorization ?? '').replace(/^bearer /, '').split('.');
      const signed = !!sig && verify('sha256', Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
      const token = decodeURIComponent(String(headers[':path']).replace('/3/device/', ''));
      if (!signed) return stream.respond({ ':status': 403 }), stream.end('{"reason":"InvalidProviderToken"}');
      if (deadApnsTokens.has(token)) return stream.respond({ ':status': 410 }), stream.end('{"reason":"Unregistered"}');
      const m = JSON.parse(body) as { aps: { alert: { title: string } }; path: string };
      got.push({ platform: 'ios', token, title: m.aps.alert.title, path: m.path });
      stream.respond({ ':status': 200 });
      stream.end();
    });
  });
  fcm = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      if (req.url === '/token') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
      if (req.headers.authorization !== 'Bearer ya29.test') return res.writeHead(401).end('{}');
      const m = JSON.parse(body) as { message: { token: string; notification: { title: string }; data: { path: string } } };
      got.push({ platform: 'android', token: m.message.token, title: m.message.notification.title, path: m.message.data.path });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"name":"projects/p/messages/1"}');
    });
  });
  const apnsUrl = await listen(apns);
  const fcmUrl = await listen(fcm);
  const config = await openTestDb({
    PUSH_APNS_KEY: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    PUSH_APNS_KEY_ID: 'ABC123DEFG',
    PUSH_APNS_TEAM_ID: 'TEAM123456',
    PUSH_APNS_URL: apnsUrl,
    PUSH_FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'freero-test', client_email: 'push@freero-test.iam.gserviceaccount.com', private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: `${fcmUrl}/token` }),
    PUSH_FCM_URL: fcmUrl,
  });
  const ctx = { config, onShutdown: () => undefined };
  initMobile(ctx);
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/', mobileRoutes(ctx));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  base = await listen(server);
});
afterAll(async () => {
  for (const s of [server, fcm]) s.closeAllConnections();
  for (const s of apnsSessions) s.destroy();
  await new Promise((r) => server.close(r));
  await new Promise((r) => fcm.close(r));
  await new Promise((r) => apns.close(r));
  await closeTestDb();
});
beforeEach(() => {
  got = [];
});

let people = 0;
async function person(name: string) {
  return createUser({ name, email: `${name.toLowerCase()}-${++people}@push.test.freero.app`, password: 'password-123' }, { emailVerified: true });
}
async function session(userId: string): Promise<string> {
  const res = await fetch(`${base}/test/sign-in/${userId}`, { method: 'POST', headers: { origin: base } });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const register = (cookie: string, device: { platform: string; token: string; off?: string[] }) =>
  fetch(`${base}/api/mobile/push/devices`, { method: 'PUT', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ off: [], ...device }) });

const invite = (userId: string, inviterId: string) =>
  notify({ userId, type: 'workspace.invite', actorId: inviterId, boardId: null, data: { workspaceId: 'ws1', workspaceName: 'Design', role: 'member' } });
const tokensOf = async (userId: string) => (await devicesOf(userId)).map((d) => d.token).sort();

it('a phone stops getting notifications once its session is signed out, while the same person’s tablet, signed in on its own, still gets them', async () => {
  const ana = await person('Ana');
  const ben = await person('Ben');
  const phone = await session(ana.id);
  const tablet = await session(ana.id);
  expect((await register(phone, { platform: 'android', token: 'fcm-phone-token-0001' })).status).toBe(200);
  expect((await register(tablet, { platform: 'ios', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' })).status).toBe(200);

  await invite(ana.id, ben.id);
  await vi.waitFor(() => expect(got).toHaveLength(2));
  expect(got.map((g) => [g.platform, g.token, g.path])).toEqual(
    expect.arrayContaining([
      ['android', 'fcm-phone-token-0001', '/app?ws=ws1'],
      ['ios', 'a1b2c3d4e5f60718293a4b5c6d7e8f90', '/app?ws=ws1'],
    ]),
  );
  expect(got[0].title).toMatch(/Ben/);

  got = [];
  // "Sign out other devices" on the tablet: the phone's session ends, and its registration with it.
  await endSessionsOf(ana.id, sessionKeyFromCookieHeader(tablet));
  await vi.waitFor(async () => expect(await tokensOf(ana.id)).toEqual(['a1b2c3d4e5f60718293a4b5c6d7e8f90']));
  await invite(ana.id, ben.id);
  await vi.waitFor(() => expect(got).toHaveLength(1));
  expect(got[0].token).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
});

it('a device gets only the types left on there, and a token Apple says is dead is forgotten', async () => {
  const cy = await person('Cy');
  const di = await person('Di');
  const cookie = await session(cy.id);
  await register(cookie, { platform: 'android', token: 'fcm-quiet-token-0002', off: ['workspace.invite'] });
  await register(cookie, { platform: 'ios', token: 'deadbeefdeadbeefdeadbeefdeadbeef' });
  deadApnsTokens.add('deadbeefdeadbeefdeadbeefdeadbeef');

  await invite(cy.id, di.id);
  // Apple's 410 for the iPad's token: it is forgotten (the push run is over once it is).
  await vi.waitFor(async () => expect(await tokensOf(cy.id)).toEqual(['fcm-quiet-token-0002']));
  expect(got).toEqual([]); // and the phone that turned invitations off got nothing
});
