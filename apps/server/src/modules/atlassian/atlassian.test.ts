// Freero for Confluence and Jira (#166, #167) over real HTTP: who may frame the board page, and the
// Forge app's source this instance hands its operator — the parts of it that decide what a page or
// an issue can frame.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, setBoardEmbeddable } from '../boards/index';
import atlassianRoutes from './routes';

const APP_ID = 'ari:cloud:ecosystem::app/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
let server: http.Server;
let base = '';
let dir = '';
let ownerId = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-atlassian-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Freero</title></head><body></body></html>');
  const config = await openTestDb({ PUBLIC_URL: 'https://freero.test', FREERO_WEB_DIST: dir, ATLASSIAN_APP_ID: APP_ID });
  const app = createApp(config);
  app.use('/', atlassianRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerId = (await createUser({ name: 'Ana', email: 'ana@atlassian.test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('the board page is framed by Atlassian’s hosts only while its board allows embedding, never by any other site', async () => {
  const board = await createBoard(ownerId, 'Sprint review', '');
  const ancestors = async (p: string) => /frame-ancestors ([^;]+)/.exec((await fetch(base + p)).headers.get('content-security-policy') ?? '')?.[1];
  expect(await ancestors(`/atlassian/b/${board.id}`)).toBe("'none'");
  await setBoardEmbeddable(board.id, ownerId, true);
  const framed = (await ancestors(`/atlassian/b/${board.id}`))?.split(' ') ?? [];
  expect(framed).toContain('https://*.atlassian.net');
  expect(framed).not.toContain('*');
  expect(framed.every((s) => s.startsWith('https://') && /atlassian|jira/.test(s))).toBe(true);
  await setBoardEmbeddable(board.id, ownerId, false);
  expect(await ancestors(`/atlassian/b/${board.id}`)).toBe("'none'");
});

it('the Forge app may frame only this instance’s board pages, and its macro and issue panel show only boards of this instance', async () => {
  const res = await fetch(`${base}/api/integrations/atlassian/forge-app`);
  expect(res.status).toBe(200);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const text = (p: string) => Buffer.from(files[`freero-atlassian/${p}`]).toString('utf8');
  const manifest = text('manifest.yml');
  expect(manifest).toContain(`id: ${APP_ID}`);
  // The only external frame source, and the only links that turn into the macro, are this instance's.
  expect(/frames:\s*\n\s*- (\S+)/.exec(manifest)?.[1]).toBe('https://freero.test/atlassian/b/');
  expect([...manifest.matchAll(/- pattern: (\S+)/g)].map((m) => new URL(m[1]).origin)).toEqual(['https://freero.test', 'https://freero.test']);

  // The browser code that turns a link (a macro's, a Jira remote link's) into the framed page.
  const shared = text('static-src/shared.js').replace(/^export /gm, '');
  const { boardFromLink, boardSrc } = new Function(`${shared}; return { boardFromLink, boardSrc };`)() as {
    boardFromLink: (l: string) => { boardId: string; item: string | null } | null;
    boardSrc: (t: { boardId: string; item: string | null }, mode?: string) => string;
  };
  expect(boardFromLink('https://freero.test/board/b1?item=k9')).toEqual({ boardId: 'b1', item: 'k9' });
  expect(boardFromLink('https://elsewhere.test/board/b1')).toBeNull();
  expect(boardFromLink('https://freero.test.evil.example/board/b1')).toBeNull();
  expect(boardFromLink('javascript:alert(1)')).toBeNull();
  expect(boardSrc({ boardId: 'b1', item: 'k9' }, 'dark')).toBe('https://freero.test/atlassian/b/b1?item=k9&theme=dark');
});
