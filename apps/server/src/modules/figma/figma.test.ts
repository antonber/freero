// Place from Figma (#171) against a stand-in Figma (scripts/lib/mock-figma.mjs) on a real HTTP
// server: the consent round trip, a frame rendered and copied into the placer's uploads, tokens
// that lapse or are revoked.
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { uploadBytesUsed } from '../uploads/index';
import * as repo from './repo';
import figmaRoutes from './routes';

type MockFigma = {
  url: string;
  renders: string;
  revokeAll(): void;
  expireAccess(): void;
  holdRefreshes(): { readonly waiting: number; release(o?: { refuse?: boolean }): void };
  close(): Promise<void>;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

let figma: MockFigma;
let FILE = '';
let server: http.Server;
let base = '';

beforeAll(async () => {
  const mock = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/mock-figma.mjs')).href)) as { startMockFigma: () => Promise<MockFigma>; MOCK_FILE_KEY: string };
  figma = await mock.startMockFigma();
  FILE = mock.MOCK_FILE_KEY;
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test', FIGMA_CLIENT_ID: 'freero-test', FIGMA_CLIENT_SECRET: 'secret', FIGMA_API_URL: figma.url, FIGMA_OAUTH_URL: `${figma.url}/oauth` });
  initStorage(config);
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', figmaRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await figma.close();
  await closeTestDb();
});

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]);

let people = 0;
/** A signed-in person who connected Figma the way the picker does: start, Figma's consent, the callback in the same browser. */
async function connected(name: string) {
  const user = await createUser({ name, email: `${name.toLowerCase()}-${++people}@figma.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const session = cookiesOf(await fetch(`${base}/test/sign-in/${user.id}`, { method: 'POST', headers: { origin: base } }));
  const board = await createBoard(user.id, 'Checkout review', '');
  await connect(session.join('; '), board.id);
  return { user, board, cookie: session.join('; ') };
}
async function connect(session: string, boardId: string) {
  const start = await fetch(`${base}/api/integrations/figma/oauth/start?return=${encodeURIComponent(`/board/${boardId}`)}`, { headers: { cookie: session }, redirect: 'manual' });
  const consent = await fetch(start.headers.get('location')!, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  const cookie = [session, ...cookiesOf(start)].join('; ');
  const done = await fetch(`${base}${callback.pathname}${callback.search}`, { headers: { cookie }, redirect: 'manual' });
  expect(done.headers.get('location')).toBe(`/board/${boardId}?figma=connected`);
}

const place = (cookie: string, boardId: string, nodeId: string) =>
  fetch(`${base}/api/boards/${boardId}/figma/place`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ fileKey: FILE, nodeId }) });

it('a frame placed from Figma becomes the placer’s own upload with a link back, and a render that isn’t really a PNG is refused by the upload checks, storing nothing', async () => {
  const { user, board, cookie } = await connected('Ada');
  const frames = (await (await fetch(`${base}/api/integrations/figma/files/${FILE}/frames`, { headers: { cookie } })).json()) as { frames: Array<{ id: string; name: string }> };
  // Frames, components and sections at the top of a page — not a sticky note lying beside them.
  expect(frames.frames.map((f) => f.name)).toEqual(['Cart', 'Payment', 'Button']);

  const res = await place(cookie, board.id, '1:2');
  expect(res.status).toBe(201);
  const placed = (await res.json()) as { url: string; w: number; h: number; link: string; name: string };
  expect(placed).toMatchObject({ w: 780, h: 1688, name: 'Cart', link: `https://www.figma.com/design/${FILE}/?node-id=1-2` });
  expect(placed.url).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.png$/);
  const used = await uploadBytesUsed(user.id);
  expect(used).toBeGreaterThan(0);

  figma.renders = 'html';
  try {
    const refused = await place(cookie, board.id, '1:3');
    expect(refused.status).toBe(400);
    expect(await uploadBytesUsed(user.id)).toBe(used);
  } finally {
    figma.renders = 'png';
  }
});

it('Figma access that lapsed is renewed without asking the person again; access revoked in Figma drops the connection and asks them to connect again', async () => {
  const { board, cookie } = await connected('Grace');
  figma.expireAccess();
  expect((await place(cookie, board.id, '1:3')).status).toBe(201);

  figma.revokeAll();
  const res = await place(cookie, board.id, '1:3');
  expect(res.status).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe('figma_reconnect');
  expect(await (await fetch(`${base}/api/integrations/figma/me`, { headers: { cookie } })).json()).toEqual({ connected: null });
});

it('a Figma connection made while an older one’s token refresh was in flight stays as it was, whether Figma then renews the old tokens or refuses them', async () => {
  const { user, board, cookie } = await connected('Lin');
  for (const refuse of [false, true]) {
    figma.expireAccess();
    const refreshes = figma.holdRefreshes();
    const placing = place(cookie, board.id, '1:2');
    await vi.waitFor(() => expect(refreshes.waiting).toBe(1));
    // Meanwhile the person connects Figma again.
    await connect(cookie, board.id);
    const fresh = await repo.account(user.id);
    refreshes.release({ refuse });
    await placing;
    expect(await repo.account(user.id)).toEqual(fresh);
  }
});
