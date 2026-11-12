// The console's "Public links" view (/operator?view=public-links): boards whose link grants access
// right now, for operators only, each read in Freero's audit log; turning a link off from it works
// like everywhere else in the console.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PublicLinksResponse } from '@freero/shared';
import { onAuditEvent, type AuditEvent } from '../../platform/audit';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import moderationRoutes from './routes';

const OPERATOR = 'op@public-links.test.freero.app';
const UNPROVEN = 'unproven@public-links.test.freero.app';
let server: http.Server;
let base = '';
const audited: AuditEvent[] = [];
let stopAudit = () => {};

beforeAll(async () => {
  const config = await openTestDb({ OPERATOR_EMAILS: `${OPERATOR}, ${UNPROVEN}` });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use(moderationRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stopAudit = onAuditEvent((e) => void audited.push(e));
});
afterAll(async () => {
  stopAudit();
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

let n = 0;
async function person(email = `person${++n}@public-links.test.freero.app`, verified = true): Promise<{ id: string; cookie: string }> {
  const { id } = await createUser({ name: email.split('@')[0], email, password: 'password-123' }, { emailVerified: verified });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  expect(res.status, await res.clone().text()).toBe(200);
  return { id, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
let op: { id: string; cookie: string } | null = null;
const operator = async () => (op ??= await person(OPERATOR));

const send = (p: string, cookie: string, json?: unknown) =>
  fetch(base + p, {
    method: json === undefined ? 'GET' : 'POST',
    headers: { origin: base, cookie, ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
async function listedIds(cookie: string): Promise<string[]> {
  const ids: string[] = [];
  let before: string | null = null;
  do {
    const res = await send(`/api/moderation/public-links?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`, cookie);
    expect(res.status).toBe(200);
    const page = (await res.json()) as PublicLinksResponse;
    ids.push(...page.boards.map((b) => b.id));
    before = page.nextBefore;
  } while (before);
  return ids;
}

it('a non-operator gets 404 from the public-links list — an ordinary account and an unverified operator address alike — and only an operator’s read is audited', async () => {
  const owner = await person();
  const board = await createBoard(owner.id, 'Our public roadmap', '', 'viewer');
  const unproven = await person(UNPROVEN, false);
  const views = () => audited.filter((e) => e.action === 'moderation.public_links.viewed').length;

  for (const who of [owner, unproven]) expect((await send('/api/moderation/public-links', who.cookie)).status).toBe(404);
  expect(views()).toBe(0);

  const res = await send('/api/moderation/public-links', (await operator()).cookie);
  const { boards } = (await res.json()) as PublicLinksResponse;
  expect(boards.find((b) => b.id === board.id)).toMatchObject({
    title: 'Our public roadmap',
    linkAccess: 'viewer',
    url: expect.stringMatching(new RegExp(`/board/${board.id}$`)),
    owner: { id: owner.id },
    workspace: { personal: true },
  });
  // In Freero's own log (no account: it lists many people's boards), with the operator as actor.
  expect(audited.filter((e) => e.action === 'moderation.public_links.viewed')).toEqual([
    expect.objectContaining({ userId: '', actor: { kind: 'user', userId: (await operator()).id } }),
  ]);
});

it('turning a link off from the list removes it from the list and the link stops working', async () => {
  const owner = await person();
  const visitor = await person();
  const board = await createBoard(owner.id, 'Shared by link', '', 'editor');
  const { cookie } = await operator();
  expect(await listedIds(cookie)).toContain(board.id);
  expect((await getBoardAccess(board.id, visitor.id)).role).toBe('editor');

  // What the row's "Turn off link" sends: the console's action, with a statement for the owner.
  const off = await send('/api/moderation/actions', cookie, { action: 'board.disable_link', targetId: board.id, reason: 'spam', statement: 'The board advertises a scam.' });
  expect(off.status, await off.clone().text()).toBe(200);

  expect(await listedIds(cookie)).not.toContain(board.id);
  expect((await getBoardAccess(board.id, visitor.id)).role).toBeNull();
  expect((await getBoardAccess(board.id, owner.id)).role).toBe('owner');
});
