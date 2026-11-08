// PostHog product events (POSTHOG_KEY) against a local stand-in for PostHog's capture endpoint: the
// real posthog-node client, the real routes and the modules that write each fact.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createContext } from '../../platform/context';
import { createApp, errorHandler, handle } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, currentUser, requireUser } from '../auth/index';
import { createBoard, recordBoardOpen } from '../boards/index';
import init from './init';
import { flushProductEvents, pseudonym } from './productEvents';
import analyticsRoutes, { mountPath } from './routes';

interface Captured {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

/** Everything the stand-in PostHog received: the raw request bodies, and the events in them. */
const bodies: string[] = [];
const events = (): Captured[] => bodies.flatMap((b) => (JSON.parse(b) as { batch: Captured[] }).batch);
const eventsOf = (accountId: string, name: string) => events().filter((e) => e.event === name && e.distinct_id === pseudonym('account', accountId));

let posthog: http.Server;
let server: http.Server;
let base = '';
let ctx: ReturnType<typeof createContext>;

beforeAll(async () => {
  posthog = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      bodies.push((req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":1}');
    });
  });
  await new Promise<void>((r) => posthog.listen(0, '127.0.0.1', r));
  const config = await openTestDb({
    POSTHOG_KEY: 'phc_testtesttesttesttesttest1234',
    POSTHOG_HOST: `http://127.0.0.1:${(posthog.address() as AddressInfo).port}`,
  });
  ctx = createContext(config);
  init(ctx);
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  // A board made by the app for the signed-in person, as POST /api/boards does.
  app.post(
    '/api/test/boards',
    requireUser,
    handle(async (req, res) => res.json(await createBoard(currentUser(req).id, 'Plan', '', 'none'))),
  );
  app.use(mountPath, analyticsRoutes(ctx));
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await ctx.shutdown();
  await new Promise((r) => server.close(r));
  await new Promise((r) => posthog.close(r));
  await closeTestDb();
});

let n = 0;
async function person(name: string, discoverySource?: string) {
  const email = `${name.toLowerCase().replace(/\W/g, '')}-${++n}@product-events.test.freero.app`;
  const { id } = await createUser({ name, email, password: 'password-123', discoverySource }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { id, name, email, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
const send = (who: { cookie: string }, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { origin: base, cookie: who.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

it('a sign-up reaches PostHog under a pseudonym: no email, name or account id anywhere in what is sent, and no IP to locate', async () => {
  const ada = await person('Ada Lovelace', 'colleague');
  await flushProductEvents();
  const [signup] = eventsOf(ada.id, 'signed_up');
  expect(signup.properties).toMatchObject({ method: 'password', discovery_source: 'colleague', $geoip_disable: true });
  expect(signup.distinct_id).toMatch(/^[0-9a-f]{64}$/);
  expect(signup.properties).not.toHaveProperty('$ip');
  const everything = bodies.join('\n');
  for (const secret of [ada.id, ada.email, 'Lovelace']) expect(everything).not.toContain(secret);
});

it('an account that turned analytics off sends nothing from any request, a request whose browser says "don’t track" (GPC, the opt-out cookie) sends nothing, and turning it back on resumes', async () => {
  const kai = await person('Kai');
  const boards = () => eventsOf(kai.id, 'board_created').length;

  expect((await send(kai, 'PUT', '/api/analytics/opt-out', { optedOut: true })).status).toBe(204);
  expect((await send(kai, 'POST', '/api/test/boards')).status).toBe(200);
  await flushProductEvents();
  expect(boards()).toBe(0);

  expect((await send(kai, 'PUT', '/api/analytics/opt-out', { optedOut: false })).status).toBe(204);
  await send(kai, 'POST', '/api/test/boards', undefined, { 'sec-gpc': '1' });
  await send({ cookie: `${kai.cookie}; freero_analytics_off=1` }, 'POST', '/api/test/boards');
  await flushProductEvents();
  expect(boards()).toBe(0);

  await send(kai, 'POST', '/api/test/boards');
  await flushProductEvents();
  expect(eventsOf(kai.id, 'board_created').map((e) => e.properties)).toEqual([expect.objectContaining({ via: 'app', copy: false, workspace: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
});

it('the app can report only an event of the closed list, with exactly its fields', async () => {
  const lin = await person('Lin');
  for (const body of [
    { name: 'signed_up', method: 'password' }, // the server's own events
    { name: 'board_created', template: 'kanban' },
    { name: 'template_used', template: 'kanban', board: 'b1' }, // a field it doesn't carry
    { name: 'template_used', template: 'Q3 plan for Acme' }, // not a public template id
    { name: 'page_viewed', path: '/board/b1' },
  ])
    expect((await send(lin, 'POST', '/api/analytics/events', body)).status).toBe(400);
  expect((await send(lin, 'POST', '/api/analytics/events', { name: 'template_used', template: 'kanban' })).status).toBe(204);
  await flushProductEvents();
  const reported = events().filter((e) => e.distinct_id === pseudonym('account', lin.id) && e.event !== 'signed_up' && e.event !== 'logged_in');
  expect(reported.map((e) => [e.event, e.properties.template_id])).toEqual([['template_used', 'kanban']]);
});

it('a collaborator joining is counted once, for the board’s owner, the first time someone else opens it', async () => {
  const [owner, guest] = [await person('Owner'), await person('Guest')];
  const board = await createBoard(owner.id, 'Retro', '', 'viewer');
  await recordBoardOpen(board.id, owner.id);
  await recordBoardOpen(board.id, guest.id);
  await recordBoardOpen(board.id, guest.id);
  await flushProductEvents();
  expect(eventsOf(owner.id, 'collaborator_joined')).toHaveLength(1);
  expect(eventsOf(guest.id, 'collaborator_joined')).toHaveLength(0);
});

it('events still queued when the server shuts down are sent before it stops', async () => {
  const late = await person('Late');
  await ctx.shutdown(); // no flush before: the client batches for 10 s
  expect(eventsOf(late.id, 'signed_up')).toHaveLength(1);
});
