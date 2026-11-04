// Import from Miro (#62) against a stand-in Miro (scripts/lib/mock-miro.mjs) on a real HTTP server:
// what the person's token may touch, and how much of a board one import reads.
import http from 'node:http';
import path from 'node:path';
import { inspect } from 'node:util';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { MiroImportResponse } from '@freero/shared';
import { MIRO_MAX_ITEMS } from '@freero/shared';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { logger } from '../../platform/log';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { uploadBytesUsed } from '../uploads/index';
import importersRoutes from './routes';

type MockMiro = { url: string; requests: Array<{ method: string; path: string; authorized: boolean }>; rateLimited: boolean; hugeBoard(n: number): string; close(): Promise<void> };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

let miro: MockMiro;
let BOARD = '';
let TOKEN = '';
let server: http.Server;
let base = '';
const logged: string[] = [];

beforeAll(async () => {
  const mock = (await import(pathToFileURL(path.join(ROOT, 'scripts/lib/mock-miro.mjs')).href)) as { startMockMiro: () => Promise<MockMiro>; MOCK_MIRO_BOARD: string; MOCK_MIRO_TOKEN: string };
  miro = await mock.startMockMiro();
  BOARD = mock.MOCK_MIRO_BOARD;
  TOKEN = mock.MOCK_MIRO_TOKEN;
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test', MIRO_API_URL: miro.url, LOG_LEVEL: 'trace' });
  initStorage(config);
  // Every line the server would log, whatever its level.
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => void logged.push(inspect(args, { depth: 8 }))) as never);
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', importersRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => server.close(r));
  await miro.close();
  await closeTestDb();
});

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]);
let people = 0;
async function signedIn(name: string) {
  const user = await createUser({ name, email: `${name.toLowerCase()}-${++people}@miro.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const cookie = cookiesOf(await fetch(`${base}/test/sign-in/${user.id}`, { method: 'POST', headers: { origin: base } })).join('; ');
  const board = await createBoard(user.id, 'Moving from Miro', '');
  return { user, board, cookie };
}
const importMiro = (cookie: string, boardId: string, body: unknown) =>
  fetch(`${base}/api/boards/${boardId}/import/miro`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('the person’s Miro token reaches only Miro’s API — never the picture host, the server’s logs or the answer — while the board and its picture come over', async () => {
  const { user, board, cookie } = await signedIn('Ada');
  miro.requests.length = 0;
  logged.length = 0;
  const res = await importMiro(cookie, board.id, { board: `https://miro.com/app/board/${BOARD}/?moveToWidget=1`, token: TOKEN });
  const raw = await res.text();
  expect(res.status).toBe(200);
  const answer = JSON.parse(raw) as MiroImportResponse;
  expect(answer.items.find((i) => i.type === 'sticky_note' && i.parentId)?.parentId).toBe(answer.items.find((i) => i.type === 'frame')?.id);
  expect(answer.connectors).toHaveLength(3);
  const picture = answer.items.find((i) => i.type === 'image')?.image;
  expect(picture?.url).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.png$/);
  expect(await uploadBytesUsed(user.id)).toBeGreaterThan(0);

  // The download link Miro hands out is fetched without the token; every API call carries it.
  const cdn = miro.requests.filter((r) => r.path.startsWith('/cdn/'));
  expect(cdn.length).toBe(1);
  expect(cdn.every((r) => !r.authorized)).toBe(true);
  expect(miro.requests.filter((r) => r.path.startsWith('/v2/')).every((r) => r.authorized)).toBe(true);
  expect(raw).not.toContain(TOKEN);
  expect(logged.length).toBeGreaterThan(0);
  expect(logged.join('\n')).not.toContain(TOKEN);

  // A token Miro refuses: said plainly, without repeating it.
  logged.length = 0;
  const refused = await importMiro(cookie, board.id, { board: BOARD, token: 'not-a-real-miro-token-123' });
  expect(refused.status).toBe(400); // not 401: the person's Freero session is fine
  const err = await refused.text();
  expect(JSON.parse(err).code).toBe('miro_token_refused');
  expect(err + logged.join('\n')).not.toContain('not-a-real-miro-token-123');
});

it('a huge Miro board is read page by page and stops at the cap instead of reading the whole board', async () => {
  const { board, cookie } = await signedIn('Grace');
  const huge = miro.hugeBoard(MIRO_MAX_ITEMS * 3);
  miro.requests.length = 0;
  const res = await importMiro(cookie, board.id, { board: huge, token: TOKEN });
  expect(res.status).toBe(200);
  const answer = (await res.json()) as MiroImportResponse;
  expect(answer.items).toHaveLength(MIRO_MAX_ITEMS);
  expect(answer.connectors).toHaveLength(MIRO_MAX_ITEMS);
  expect(answer.truncated).toBe(true);
  // 50 a page: the pages for the cap (and one more to see it was reached), not the 6,000-item board.
  const itemPages = miro.requests.filter((r) => r.path.endsWith('/items')).length;
  expect(itemPages).toBeLessThanOrEqual(MIRO_MAX_ITEMS / 50 + 1);
});

it('Miro asking Freero to slow down ends the import with a rate-limit answer instead of retrying', async () => {
  const { board, cookie } = await signedIn('Linus');
  miro.requests.length = 0;
  miro.rateLimited = true;
  try {
    const res = await importMiro(cookie, board.id, { board: BOARD, token: TOKEN });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe('miro_rate_limited');
    expect(miro.requests.length).toBe(1);
  } finally {
    miro.rateLimited = false;
  }
});
