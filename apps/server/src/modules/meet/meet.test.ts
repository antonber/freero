// Freero's Google Meet add-on (#169) over real HTTP: only Google Meet frames its pages, only those
// pages may load Google's add-ons SDK, and the main stage shows a board only while it allows embedding.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, setBoardEmbeddable } from '../boards/index';
import meetRoutes from './routes';

let server: http.Server;
let base = '';
let dir = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-meet-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Freero</title></head><body></body></html>');
  const config = await openTestDb({ PUBLIC_URL: 'https://freero.test', FREERO_WEB_DIST: dir, GOOGLE_MEET_CLOUD_PROJECT_NUMBER: '123456789012' });
  const app = createApp(config);
  app.use('/', meetRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.get('/elsewhere', (_req, res) => void res.type('html').send('<!doctype html>'));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const csp = async (p: string) => {
  const header = (await fetch(base + p)).headers.get('content-security-policy') ?? '';
  return { ancestors: /frame-ancestors ([^;]+)/.exec(header)?.[1], scripts: /script-src ([^;]+)/.exec(header)?.[1] };
};

it('only Google Meet frames the add-on’s pages, only they may load Google’s SDK, and the stage shows a board only while it allows embedding', async () => {
  const ownerId = (await createUser({ name: 'Mia', email: 'mia@meet.test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
  const board = await createBoard(ownerId, 'Standup', '');
  expect(await csp('/meet/sidepanel')).toEqual({ ancestors: 'https://meet.google.com', scripts: "'self' https://www.gstatic.com" });
  expect(await csp(`/meet/stage/${board.id}`)).toEqual({ ancestors: "'none'", scripts: "'self'" });
  await setBoardEmbeddable(board.id, ownerId, true);
  expect(await csp(`/meet/stage/${board.id}`)).toEqual({ ancestors: 'https://meet.google.com', scripts: "'self' https://www.gstatic.com" });
  // Every other page: no framing, no Google script.
  expect(await csp('/elsewhere')).toEqual({ ancestors: "'none'", scripts: "'self'" });
});
