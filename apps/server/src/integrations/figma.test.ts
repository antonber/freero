// The Freero plugin for Figma (#172, integrations/figma) against the real OAuth server, the plugin's
// sign-in relay and the REST API on a real HTTP server. The plugin's Freero client (src/freero.js)
// runs unchanged; what Figma itself does (exporting a frame) is a PNG made here.
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../platform/http';
import { initStorage } from '../platform/storage';
import { closeTestDb, openTestDb } from '../platform/testing';
import apiAuthRoutes from '../modules/apiauth/routes';
import { completeSignIn, createUser } from '../modules/auth/index';
import { createBoard } from '../modules/boards/index';
import figmaRoutes from '../modules/figma/routes';
import { readBoardView } from '../modules/realtime/index';
import { uploadBytesUsed } from '../modules/uploads/index';
import apiRoutes, { mountPath } from '../modules/api/routes';

type Json = Record<string, any>;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let server: http.Server;
let base = '';
let plugin: Json;
let solidPng: (w: number, h: number) => Buffer;

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  initStorage(config);
  const ctx = { config, onShutdown: () => undefined };
  const express = createApp(config);
  express.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  express.use('/', apiAuthRoutes(ctx));
  express.use(mountPath, apiRoutes(ctx));
  express.use('/api', figmaRoutes(ctx));
  express.use('/api', apiNotFound());
  express.use(errorHandler());
  server = http.createServer(express);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  plugin = await import(pathToFileURL(path.join(ROOT, 'integrations/figma/src/freero.js')).href);
  ({ solidPng } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/mock-figma.mjs')).href));
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

/** Signs the plugin in as a person would: the plugin opens Freero's consent, they allow it there, the plugin picks up the code. */
async function pluginSignedIn(name: string) {
  const user = await createUser({ name, email: `${name.toLowerCase()}@figma-plugin.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const signIn = await fetch(`${base}/test/sign-in/${user.id}`, { method: 'POST', headers: { origin: base } });
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const pending = await plugin.startSignIn(base);
  expect(await plugin.pickUpSignIn(pending)).toBeNull(); // not approved yet

  const authorize = new URL(pending.authorizeUrl);
  const consent = await fetch(`${base}/api/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ ...Object.fromEntries(authorize.searchParams), decision: 'allow', grant: ['boards:read', 'boards:write'] }),
  });
  const back = new URL(((await consent.json()) as { redirect: string }).redirect);
  // The browser lands on the plugin's callback page, which keeps the code for the plugin.
  expect((await fetch(back)).status).toBe(200);
  const tokens = await plugin.pickUpSignIn(pending);
  expect(await plugin.pickUpSignIn(pending)).toBeNull(); // single use
  return { user, client: new plugin.FreeroClient({ server: base, auth: tokens }) };
}

it('the plugin signs in through the relay, finds the board, and sending a frame again updates its picture instead of adding another', async () => {
  const { user, client } = await pluginSignedIn('Dana');
  const board = await createBoard(user.id, 'Design review', '');
  expect((await client.boards('Design')).map((b: Json) => b.id)).toEqual([board.id]);

  const link = plugin.frameLink('MockCheckoutFile2026', '1:2');
  const first = await client.sendPicture(board.id, solidPng(390, 844), { link, alt: 'Cart' });
  expect(first.replaced).toBe(false);
  expect(first.item).toMatchObject({ type: 'image', data: { link } });

  // The design changed: taller now. Sent again with the item the plugin remembered for this frame.
  const again = await client.sendPicture(board.id, solidPng(390, 1200), { link, alt: 'Cart', replace: first.item.id });
  expect(again).toMatchObject({ replaced: true, item: { id: first.item.id } });
  // Another copy of the plugin (a teammate's) knows no item id: the link to the same frame finds it.
  const teammate = await client.sendPicture(board.id, solidPng(390, 1300), { link: `https://www.figma.com/design/MockCheckoutFile2026/Checkout?node-id=1%3A2&t=x` });
  expect(teammate).toMatchObject({ replaced: true, item: { id: first.item.id } });

  const view = await readBoardView(board.id, { userId: user.id, role: 'owner' });
  const images = view.elements.map((e) => e.el).filter((el) => el.type === 'image');
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({ naturalW: 390, naturalH: 1300, w: first.item.w });
});

it('a picture the plugin sends goes through the upload checks: bytes that aren’t a picture are refused and nothing is stored', async () => {
  const { user, client } = await pluginSignedIn('Eli');
  const board = await createBoard(user.id, 'Specs', '');
  await expect(client.sendPicture(board.id, new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).rejects.toMatchObject({ status: 415 });
  expect(await uploadBytesUsed(user.id)).toBe(0);
});
