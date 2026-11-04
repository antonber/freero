// Freero's Zapier app (#173, integrations/zapier) against the real OAuth server and REST API on a
// real HTTP server. Zapier's own runner needs its platform packages (Zapier's licence, installed
// only by whoever pushes the app), so `z` here is a small stand-in that does what Zapier documents
// for z.request: the app's beforeRequest / afterResponse middleware, a JSON body unless the request
// says form-urlencoded, `response.data`. The app's definitions themselves run unchanged.
// (src/integrations/: tests of the packages in integrations/ that run on other platforms; like the
// composition root, they mount the routes of the modules those packages call.)
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../platform/http';
import { initStorage } from '../platform/storage';
import { closeTestDb, openTestDb } from '../platform/testing';
import { registerOAuthApp } from '../modules/apiauth/index';
import apiAuthRoutes from '../modules/apiauth/routes';
import { completeSignIn, createUser } from '../modules/auth/index';
import { createBoard } from '../modules/boards/index';
import { signature } from '../modules/webhooks/index';
import { createTeamWorkspace } from '../modules/workspaces/index';
import apiRoutes, { mountPath } from '../modules/api/routes';

type Json = Record<string, any>;
type Bundle = { authData: Json; inputData: Json; subscribeData?: Json; targetUrl?: string; rawRequest?: Json; meta?: Json };
type Op = { perform: (z: unknown, b: Bundle) => Promise<any>; performSubscribe?: (z: unknown, b: Bundle) => Promise<Json>; performUnsubscribe?: (z: unknown, b: Bundle) => Promise<Json> };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let server: http.Server;
let base = '';
let app: Json;

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  initStorage(config);
  const ctx = { config, onShutdown: () => undefined };
  const express = createApp(config);
  express.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  express.use('/', apiAuthRoutes(ctx));
  express.use(mountPath, apiRoutes(ctx));
  express.use('/api', apiNotFound());
  express.use(errorHandler());
  server = http.createServer(express);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  app = (await import(pathToFileURL(path.join(ROOT, 'integrations/zapier/index.js')).href)).default;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

class ZapierError extends Error {}
class RefreshAuthError extends Error {}
/** What Zapier's z does for the app's code (z.request with the app's middleware). */
function zFor(bundle: Bundle) {
  const z = {
    errors: { Error: ZapierError, RefreshAuthError },
    console: { log: () => undefined },
    async request(options: Json) {
      let req: Json = { method: 'GET', headers: {}, ...options };
      for (const m of app.beforeRequest) req = m(req, z, bundle);
      const url = new URL(req.url);
      for (const [k, v] of Object.entries((req.params ?? {}) as Json)) url.searchParams.set(k, String(v));
      const headers: Json = { ...req.headers };
      let body: string | undefined;
      if (req.body !== undefined) {
        const form = /x-www-form-urlencoded/i.test(String(headers['content-type'] ?? ''));
        body = form ? new URLSearchParams(req.body).toString() : JSON.stringify(req.body);
        if (!form) headers['content-type'] = 'application/json';
      }
      const res = await fetch(url, { method: req.method, headers, body });
      const content = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(content);
      } catch {
        /* not JSON */
      }
      let response: Json = { status: res.status, content, data, headers: res.headers, request: { ...req, url: url.toString() } };
      for (const m of app.afterResponse) response = m(response, z, bundle);
      return response;
    },
  };
  return z;
}
const run = (op: Op, bundle: Bundle) => op.perform(zFor(bundle), bundle);

let people = 0;
async function signedIn(name: string) {
  const user = await createUser({ name, email: `${name.toLowerCase()}-${++people}@zapier.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${user.id}`, { method: 'POST', headers: { origin: base } });
  return { user, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

/** Connects Zapier as a person would: Freero's consent screen, then Zapier's token exchange (with PKCE, as Zapier's enablePkce does). */
async function connect(cookie: string, ownerId: string): Promise<Json> {
  const redirect = 'https://zapier.com/dashboard/auth/oauth/return/App1CLIAPI/';
  const { client, clientSecret } = await registerOAuthApp(ownerId, { name: 'Zapier', redirectUris: [redirect], confidential: true });
  const fields = { baseUrl: base, clientId: client.clientId, clientSecret };
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL(app.authentication.oauth2Config.authorizeUrl(zFor({ authData: {}, inputData: { ...fields, redirect_uri: redirect, state: 'st8' } }), { authData: {}, inputData: { ...fields, redirect_uri: redirect, state: 'st8' } }));
  expect(authorize.origin + authorize.pathname).toBe(`${base}/oauth/authorize`);
  const consent = await fetch(`${base}/api/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ ...Object.fromEntries(authorize.searchParams), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', decision: 'allow', grant: ['boards:write', 'comments:write', 'webhooks:manage'] }),
  });
  const back = new URL(((await consent.json()) as { redirect: string }).redirect);
  expect(back.searchParams.get('state')).toBe('st8');
  const inputData = { ...fields, code: back.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier };
  const tokens = await app.authentication.oauth2Config.getAccessToken(zFor({ authData: {}, inputData }), { authData: {}, inputData });
  return { ...fields, ...tokens };
}

it('a Zap connects through Freero’s OAuth (PKCE), its token refreshes, and its actions land on the board: a sticky, a card, a comment, a new board it can then find', async () => {
  const { user, cookie } = await signedIn('Zoe');
  let authData = await connect(cookie, user.id);
  expect((await app.authentication.test(zFor({ authData, inputData: {} }), { authData, inputData: {} })).user.id).toBe(user.id);
  const refreshed = await app.authentication.oauth2Config.refreshAccessToken(zFor({ authData, inputData: {} }), { authData, inputData: {} });
  expect(refreshed.access_token).not.toBe(authData.access_token);
  authData = { ...authData, ...refreshed };

  const board = await createBoard(user.id, 'Launch', '');
  const link = `${base}/board/${board.id}`;
  const as = (inputData: Json): Bundle => ({ authData, inputData });
  const sticky = await run(app.creates.create_sticky.operation, as({ board: link, text: 'Ship the importer', color: 'green' }));
  const card = await run(app.creates.create_card.operation, as({ board: board.id, title: 'Write the release notes', description: 'For Friday', due: '2026-11-20T09:00:00Z' }));
  const comment = await run(app.creates.add_comment.operation, as({ board: board.id, text: 'Looks good', item: card.id }));
  const made = await run(app.creates.create_board.operation, as({ title: 'Zapier-made board' }));

  const items = await run(app.triggers.new_item.operation, as({ board: board.id }));
  expect(items.map((i: Json) => [i.id, i.type, i.text])).toEqual([
    [card.id, 'card', 'Write the release notes'], // newest first: Zapier deduplicates polls by id from the top
    [sticky.id, 'sticky', 'Ship the importer'],
  ]);
  const comments = await run(app.triggers.new_comment.operation, as({ board: board.id }));
  expect(comments.map((c: Json) => [c.thread_id, c.item_id, c.text])).toEqual([[comment.id, card.id, 'Looks good']]);
  expect((await run(app.searches.find_board.operation, as({ q: 'Zapier-made' }))).map((b: Json) => b.id)).toEqual([made.id]);
});

it('Board Event: subscribing adds a webhook for the chosen board, only a delivery signed with that webhook’s secret runs the Zap, and unsubscribing removes it', async () => {
  const { user, cookie } = await signedIn('Ada');
  const authData = await connect(cookie, user.id);
  const ws = await createTeamWorkspace(user.id, 'Ops');
  const board = await createBoard(user.id, 'Incidents', '', 'none', { workspaceId: ws.id });
  const op = app.triggers.board_event.operation as Op;
  const inputData = { workspace: ws.id, events: ['comment.created'], board: board.id };
  const subscribeData = await op.performSubscribe!(zFor({ authData, inputData }), { authData, inputData, targetUrl: 'https://hooks.example.com/hooks/catch/1/abc/' });
  const listed = await fetch(`${base}/api/v1/workspaces/${ws.id}/webhooks`, { headers: { authorization: `Bearer ${authData.access_token}` } }).then((r) => r.json() as Promise<Json>);
  expect(listed.webhooks.map((w: Json) => [w.id, w.events, w.format, !!w.scope])).toEqual([[subscribeData.id, ['comment.created'], 'json', true]]);

  const event = { id: 'evt_7', type: 'comment.created', version: 1, createdAt: new Date().toISOString(), workspaceId: ws.id, board: { id: board.id, title: 'Incidents', url: `${base}/board/${board.id}` }, actor: { kind: 'user', id: user.id, name: 'Ada' }, data: { threadId: 't1', messageId: 'm1', itemId: null, text: 'Paging on-call' } };
  const delivery = (body: string, sig: string): Bundle => ({ authData, inputData, subscribeData, rawRequest: { headers: { 'Http-Freero-Signature': sig }, content: body } });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  expect((await run(op, delivery(body, signature(subscribeData.secret, body, now)))).map((e: Json) => [e.id, e.type, e.board_title, e.text])).toEqual([['evt_7', 'comment.created', 'Incidents', 'Paging on-call']]);
  expect(await run(op, delivery(body, signature('whsec_someone-else', body, now)))).toEqual([]); // forged
  expect(await run(op, delivery(body.replace('Paging', 'Ignore'), signature(subscribeData.secret, body, now)))).toEqual([]); // altered
  expect(await run(op, delivery(body, signature(subscribeData.secret, body, now - 3600)))).toEqual([]); // replayed an hour later
  const ping = JSON.stringify({ id: 'ping', type: 'ping', version: 1, createdAt: new Date().toISOString(), workspaceId: ws.id });
  expect(await run(op, delivery(ping, signature(subscribeData.secret, ping, now)))).toEqual([]);

  await op.performUnsubscribe!(zFor({ authData, inputData }), { authData, inputData, subscribeData });
  const after = await fetch(`${base}/api/v1/workspaces/${ws.id}/webhooks`, { headers: { authorization: `Bearer ${authData.access_token}` } }).then((r) => r.json() as Promise<Json>);
  expect(after.webhooks).toEqual([]);
});
