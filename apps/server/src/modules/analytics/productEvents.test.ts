// PostHog product events (POSTHOG_KEY) against a local stand-in for PostHog's capture endpoint: the
// real posthog-node client, the real routes and the modules that write each fact.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createContext } from '../../platform/context';
import { createApp, errorHandler, handle } from '../../platform/http';
import { runWithRequestContext, type RequestContext } from '../../platform/requestContext';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, currentUser, requireUser } from '../auth/index';
import { createBoard, recordBoardOpen } from '../boards/index';
import { appendMarkdown, createDoc } from '../docs/index';
import { changeBoard, decideSuggestions, proposeSuggestions } from '../realtime/index';
import init from './init';
import { flushProductEvents, pseudonym } from './productEvents';
import analyticsRoutes, { mountPath } from './routes';
import { flushUsage, noteBoardChange, noteComment } from './usage';

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

const DAY = 86_400_000;
/** `fn` as if handling a request through `surface` (whose browser sends GPC when `privacySignal`). */
const onRequest = <T>(surface: NonNullable<RequestContext['surface']>, fn: () => Promise<T>, privacySignal = false) =>
  runWithRequestContext({ reqId: 'test', userId: null, ip: null, userAgent: null, surface, privacySignal }, fn);
const sticky = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text, color: 'yellow' }) as never;
/** A change from a board socket, as realtime reports one (the socket's door: the app). */
const socketChange = (boardId: string, actorId: string, changes: Array<[string, 'add' | 'remove', string]>, privacySignal = false) => ({
  boardId,
  actorId,
  actorName: 'Someone',
  layer: 'shared' as const,
  changes: changes.map(([id, op, type]) => ({ id, op, type, frameId: null })),
  frameTitles: {},
  door: { surface: 'app' as const, privacySignal },
});
const socketComment = (boardId: string, authorId: string, messageId: string, privacySignal = false) => ({
  boardId,
  authorId,
  threadId: 't1',
  messageId,
  text: 'Our Q3 pricing',
  previousText: null,
  participantIds: [],
  layer: 'shared' as const,
  door: { surface: 'app' as const, privacySignal },
});

it('opening the same board twice in a day sends one board_opened, for the person who opened it — the next day one more — and never says which board', async () => {
  const [owner, reader] = [await person('Owner'), await person('Reader')];
  const board = await createBoard(owner.id, 'Acme roadmap', '', 'viewer');
  const morning = Math.floor(Date.now() / DAY) * DAY + 3_600_000;
  await recordBoardOpen(board.id, reader.id, morning);
  await recordBoardOpen(board.id, reader.id, morning + 5 * 3_600_000);
  await recordBoardOpen(board.id, reader.id, morning + DAY);
  await flushProductEvents();
  expect(eventsOf(reader.id, 'board_opened').map((e) => e.properties.kind)).toEqual(['board', 'board']);
  expect(eventsOf(owner.id, 'board_opened')).toHaveLength(0);
  const everything = bodies.join('\n');
  for (const secret of [board.id, 'Acme']) expect(everything).not.toContain(secret);
});

it('items added are sent per type and door once the window closes — one event for many items, none for an item removed again — never the board, the items or their text', async () => {
  const ann = await person('Ann');
  const board = await createBoard(ann.id, 'Acme launch plan', '', 'none');
  const actor = { userId: ann.id, role: 'owner' as const, name: ann.name, via: { kind: 'app' as const, id: 'frc_claude', name: 'Claude' } };
  await onRequest('mcp', () => changeBoard(board.id, actor, () => ({ change: { create: [sticky('s1', 'Secret pricing'), sticky('s2', 'b'), sticky('gone', 'c')] } })));
  await onRequest('mcp', () => changeBoard(board.id, actor, () => ({ change: { remove: ['gone'] } })));
  await flushProductEvents();
  expect(eventsOf(ann.id, 'items_added')).toHaveLength(0); // still gathering
  await flushUsage();
  await flushProductEvents();
  expect(eventsOf(ann.id, 'items_added').map((e) => e.properties)).toEqual([
    expect.objectContaining({ type: 'sticky', count: 2, via: 'mcp', workspace: expect.stringMatching(/^[0-9a-f]{64}$/) }),
  ]);
  const everything = bodies.join('\n');
  for (const secret of [board.id, 'Secret pricing', 'Acme', 'Claude']) expect(everything).not.toContain(secret);
});

it('items and comments from a request or a socket whose browser sends GPC or the opt-out cookie are not counted at all', async () => {
  const bo = await person('Bo');
  const board = await createBoard(bo.id, 'Plan', '', 'none');
  await onRequest('api', () => changeBoard(board.id, { userId: bo.id, role: 'owner' }, () => ({ change: { create: [sticky('r1', 'a')] } })), true);
  noteBoardChange(socketChange(board.id, bo.id, [['w1', 'add', 'shape']], true));
  noteComment(socketComment(board.id, bo.id, 'm1', true));
  await flushUsage();
  await flushProductEvents();
  expect(events().filter((e) => e.distinct_id === pseudonym('account', bo.id) && ['items_added', 'comment_added'].includes(e.event))).toEqual([]);

  // The same from a socket that sends no signal is counted.
  noteBoardChange(socketChange(board.id, bo.id, [['w2', 'add', 'shape']]));
  noteComment(socketComment(board.id, bo.id, 'm2'));
  noteComment(socketComment(board.id, bo.id, 'm3'));
  await flushUsage();
  await flushProductEvents();
  expect(eventsOf(bo.id, 'items_added').map((e) => [e.properties.type, e.properties.count, e.properties.via])).toEqual([['shape', 1, 'app']]);
  expect(eventsOf(bo.id, 'comment_added').map((e) => [e.properties.count, e.properties.via])).toEqual([[2, 'app']]);
  expect(bodies.join('\n')).not.toContain('Q3 pricing');
});

it('an item type outside the element types (a client writes it) is dropped, never sent', async () => {
  const cy = await person('Cy');
  const board = await createBoard(cy.id, 'Plan', '', 'none');
  noteBoardChange(socketChange(board.id, cy.id, [['a', 'add', 'sticky'], ['b', 'add', 'Q3 plan for Initech']]));
  await flushUsage();
  await flushProductEvents();
  expect(eventsOf(cy.id, 'items_added').map((e) => [e.properties.type, e.properties.count])).toEqual([['sticky', 1]]);
  expect(bodies.join('\n')).not.toContain('Initech');
});

it('accepting an app’s proposed changes sends one agent_proposal_resolved with how many, for the person who decided', async () => {
  const dee = await person('Dee');
  const board = await createBoard(dee.id, 'Plan', '', 'none');
  const editor = { userId: dee.id, role: 'owner' as const };
  const author = { kind: 'app' as const, name: 'Planner bot', userId: dee.id, userName: dee.name, credentialId: 'tok1' };
  const { records } = await proposeSuggestions(board.id, editor, { author, description: 'Ideas' }, () => ({ change: { create: [sticky('p1', 'x'), sticky('p2', 'y'), sticky('p3', 'z')] } }));
  await onRequest('api', () => decideSuggestions(board.id, editor, { groupId: records[0].groupId, status: 'accepted' }));
  await flushUsage();
  await flushProductEvents();
  expect(eventsOf(dee.id, 'agent_proposal_resolved').map((e) => [e.properties.outcome, e.properties.proposer, e.properties.count])).toEqual([['accepted', 'app', 3]]);
});

it('editing the same doc twice in a day sends one doc_edited, never which doc', async () => {
  const eve = await person('Eve');
  const doc = await createDoc(eve.id, { title: 'Initech notes' });
  const actor = { userId: eve.id, role: 'owner' as const, name: eve.name };
  await onRequest('api', () => appendMarkdown(doc.id, actor, 'First line'));
  await onRequest('api', () => appendMarkdown(doc.id, actor, 'Second line'));
  await flushUsage();
  await flushProductEvents();
  expect(eventsOf(eve.id, 'doc_edited').map((e) => e.properties.via)).toEqual(['api']);
  const everything = bodies.join('\n');
  for (const secret of [doc.id, 'Initech', 'First line']) expect(everything).not.toContain(secret);
});

it('events still queued when the server shuts down are sent before it stops', async () => {
  const late = await person('Late');
  await ctx.shutdown(); // no flush before: the client batches for 10 s
  expect(eventsOf(late.id, 'signed_up')).toHaveLength(1);
});
