// Freero's Make app (#174, integrations/make). Make has no local runner, so: every request the app
// describes names an operation the REST API serves (path, method, body fields the reference
// documents), and its connection and modules run against the real OAuth server and API with the
// request templates evaluated here. The evaluator knows only the few IML forms the app uses and
// refuses any other, so a new expression in the app can't pass untried.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../platform/http';
import { initStorage } from '../platform/storage';
import { closeTestDb, openTestDb } from '../platform/testing';
import { registerOAuthApp } from '../modules/apiauth/index';
import apiAuthRoutes from '../modules/apiauth/routes';
import { completeSignIn, createUser } from '../modules/auth/index';
import { createBoard } from '../modules/boards/index';
import { createTeamWorkspace } from '../modules/workspaces/index';
import apiRoutes, { mountPath } from '../modules/api/routes';
import SPEC from '../../../../docs/api/openapi.json';

type Json = Record<string, any>;
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../integrations/make');
const read = (rel: string): any => JSON.parse(fs.readFileSync(path.join(APP, rel), 'utf8'));
const spec = SPEC as unknown as { paths: Record<string, Record<string, Json>>; components: { schemas: Record<string, Json> } };

let server: http.Server;
let base = '';
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
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

// ---- the IML the app uses (and nothing else) ----
function evalExpr(src: string, scope: Json): unknown {
  const s = src.trim();
  let m: RegExpExecArray | null;
  if (/^'[^']*'$/.test(s)) return s.slice(1, -1);
  if (/^\d+$/.test(s)) return Number(s);
  if (s === 'null') return null;
  if (s === 'now') return new Date();
  if ((m = /^ifempty\((.+)\)$/.exec(s))) {
    const [a, b] = split(m[1]);
    const v = evalExpr(a, scope);
    return v === undefined || v === null || v === '' ? evalExpr(b, scope) : v;
  }
  if ((m = /^if\((.+)\)$/.exec(s))) {
    const [c, a, b] = split(m[1]);
    const v = evalExpr(c, scope);
    return v !== undefined && v !== null && v !== '' && v !== false ? evalExpr(a, scope) : evalExpr(b, scope);
  }
  if ((m = /^formatDate\((.+)\)$/.exec(s))) {
    const [d, f] = split(m[1]);
    const v = evalExpr(d, scope);
    if (evalExpr(f, scope) !== 'YYYY-MM-DD') throw new Error(`formatDate format ${f}`);
    return v ? new Date(String(v)).toISOString().slice(0, 10) : '';
  }
  if ((m = /^addSeconds\((.+)\)$/.exec(s))) {
    const [d, n] = split(m[1]);
    return new Date((evalExpr(d, scope) as Date).getTime() + Number(evalExpr(n, scope)) * 1000);
  }
  if (/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)*$/.test(s)) return s.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), scope);
  throw new Error(`The test doesn’t know this IML yet: {{${src}}} (teach evalExpr, after checking Make's documentation)`);
}
/** Top-level comma-separated arguments. */
function split(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of args) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  return [...out, cur];
}
function render(v: unknown, scope: Json): unknown {
  if (typeof v === 'string') {
    const whole = /^\{\{([^{}]+)\}\}$/.exec(v);
    if (whole) return evalExpr(whole[1], scope);
    return v.replace(/\{\{([^{}]+)\}\}/g, (_, e) => String(evalExpr(e, scope) ?? ''));
  }
  if (Array.isArray(v)) return v.map((x) => render(x, scope));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, render(x, scope)]));
  return v;
}

/** Sends one of the app's requests as Make would: the base's address and headers for relative URLs, JSON unless `type: urlencoded`. */
async function send(req: Json, scope: Json): Promise<{ status: number; body: Json }> {
  const baseIml = read('base.iml.json');
  const relative = !String(req.url).startsWith('{{parameters.baseUrl}}');
  const url = new URL(String(render(relative ? `${baseIml.baseUrl}${req.url}` : req.url, scope)));
  for (const [k, v] of Object.entries((render(req.qs ?? {}, scope) as Json) ?? {})) if (v !== '' && v != null) url.searchParams.set(k, String(v));
  const headers: Json = { ...(relative ? (render(baseIml.headers, scope) as Json) : {}), ...((render(req.headers ?? {}, scope) as Json) ?? {}) };
  let body: string | undefined;
  if (req.body !== undefined) {
    const b = render(req.body, scope) as Json;
    if (req.type === 'urlencoded') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))).toString();
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(b);
    }
  }
  const res = await fetch(url, { method: req.method ?? 'GET', headers, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

// ---- the app's requests against the API reference ----
function requestsOfApp(): Array<{ where: string; req: Json }> {
  const app = read('makecomapp.json');
  const out: Array<{ where: string; req: Json }> = [];
  for (const [kind, comps] of Object.entries(app.components as Json))
    for (const [name, c] of Object.entries(comps as Json))
      for (const [role, file] of Object.entries((c as Json).codeFiles ?? {})) {
        if (!file) continue;
        expect(fs.existsSync(path.join(APP, file as string)), `${kind}.${name}.${role}: ${file}`).toBe(true);
        if (!['communication', 'attach', 'detach'].includes(role) || kind === 'webhook' && role === 'communication') continue;
        const comm = read(file as string);
        for (const [step, req] of kind === 'connection' ? Object.entries(comm as Json) : [[role, comm]]) if ((req as Json).url) out.push({ where: `${kind}.${name}.${step}`, req: req as Json });
      }
  return out;
}

it('every request the Make app sends is an operation the REST API serves, with only body fields its reference documents', () => {
  const resolve = (s: Json): Json => (s?.$ref ? resolve(spec.components.schemas[s.$ref.split('/').pop()]) : s);
  const problems: string[] = [];
  for (const { where, req } of requestsOfApp()) {
    const raw = String(req.url).replace('{{parameters.baseUrl}}', '');
    if (raw === '{{parameters.url}}' || raw.startsWith('/oauth/') || raw.startsWith('/api/oauth/')) continue; // the universal module; OAuth (not in the REST reference)
    const p = raw.replace(/^\/api\/v1/, '').replace(/\{\{[^}]+\}\}/g, '{x}');
    const method = String(req.method ?? 'GET').toLowerCase();
    const match = Object.entries(spec.paths).find(([sp, ops]) => sp.replace(/\{[^}]+\}/g, '{x}') === p && ops[method]);
    if (!match) {
      problems.push(`${where}: ${method.toUpperCase()} ${raw} is not in the API`);
      continue;
    }
    const schema = resolve(match[1][method].requestBody?.content?.['application/json']?.schema ?? {});
    for (const k of Object.keys(req.body ?? {})) if (!schema.properties?.[k]) problems.push(`${where}: body field ${k} is not documented for ${method.toUpperCase()} ${match[0]}`);
  }
  expect(problems).toEqual([]);
});

it('the Make connection signs in through Freero’s OAuth as a confidential app (no PKCE), and its modules work with optional fields left empty, as Make sends them', async () => {
  const user = await createUser({ name: 'Mo', email: 'mo@make.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const cookie = (await fetch(`${base}/test/sign-in/${user.id}`, { method: 'POST', headers: { origin: base } })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const redirect = 'https://www.make.com/oauth/cb/app';
  const { client, clientSecret } = await registerOAuthApp(user.id, { name: 'Make', redirectUris: [redirect], confidential: true });
  const conn = read('connection/communication.json');
  const parameters = { baseUrl: base, clientId: client.clientId, clientSecret };
  const scope0 = { parameters, common: {}, oauth: { makeRedirectUri: redirect } };

  // Make sends the person to authorize (its qs, no PKCE), Freero's consent answers with a code.
  const authorize = new URL(String(render(conn.authorize.url, scope0)));
  for (const [k, v] of Object.entries(render(conn.authorize.qs, scope0) as Json)) authorize.searchParams.set(k, String(v));
  expect(authorize.searchParams.has('code_challenge')).toBe(false);
  const consent = await fetch(`${base}/api/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ ...Object.fromEntries(authorize.searchParams), decision: 'allow', grant: ['boards:write', 'comments:write', 'webhooks:manage'] }),
  });
  const code = new URL(((await consent.json()) as { redirect: string }).redirect).searchParams.get('code');
  const token = await send(conn.token, { ...scope0, temp: { code } });
  expect(token.status).toBe(200);
  const connection = render(conn.token.response.data, { ...scope0, body: token.body, now: new Date() }) as Json;
  expect((await send(conn.info, { ...scope0, connection })).body.user.id).toBe(user.id);

  const board = await createBoard(user.id, 'Make board', '');
  const run = async (module: string, params: Json) => {
    const r = await send(read(`modules/${module}/communication.json`), { parameters: params, connection });
    expect(r.status, `${module}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  };
  const empty = { into: '', column: '', description: '', link: '', due: '', color: '', item: '', workspace: '' };
  const sticky = await run('addSticky', { ...empty, board: board.id, text: 'From Make' });
  const card = await run('addCard', { ...empty, board: board.id, title: 'Follow up', due: '2026-11-20' });
  await run('addComment', { ...empty, board: board.id, text: 'Done by Make' });
  const made = await run('createBoard', { ...empty, title: 'Made by Make' });
  expect((await run('searchBoards', { q: 'Made by Make', limit: '' })).boards.map((b: Json) => b.id)).toEqual([made.board.id]);
  const items = (await send({ url: `/boards/${board.id}/items`, method: 'GET' }, { connection })).body.items as Json[];
  expect(items.map((i) => [i.id, i.type]).sort()).toEqual([[sticky.created[0], 'sticky'], [card.created[0], 'card']].sort());

  // Watch board events: attach adds the webhook (scoped to one board), detach removes it.
  const ws = await createTeamWorkspace(user.id, 'Make team');
  const teamBoard = await createBoard(user.id, 'Ops', '', 'none', { workspaceId: ws.id });
  const attach = read('webhook/attach.json');
  const hookParams = { workspace: ws.id, events: ['item.created', 'comment.created'], board: `${base}/board/${teamBoard.id}` };
  const attached = await send(attach, { parameters: hookParams, connection, webhook: { url: 'https://hook.eu1.make.com/abc123' } });
  expect(attached.status).toBe(201);
  const webhook = render(attach.response.data, { parameters: hookParams, body: attached.body }) as Json;
  const listed = (await send({ url: `/workspaces/${ws.id}/webhooks`, method: 'GET' }, { connection })).body.webhooks as Json[];
  expect(listed.map((w) => [w.id, w.events, w.format, !!w.scope])).toEqual([[webhook.externalHookId, ['item.created', 'comment.created'], 'json', true]]);
  expect((await send(read('webhook/detach.json'), { connection, webhook })).status).toBe(200);
  expect((await send({ url: `/workspaces/${ws.id}/webhooks`, method: 'GET' }, { connection })).body.webhooks).toEqual([]);

  // The connection refreshes (Freero rotates the refresh token) and can be revoked.
  const refreshed = await send(conn.refresh, { ...scope0, data: connection });
  expect(refreshed.status).toBe(200);
  expect(refreshed.body.refresh_token).not.toBe(connection.refreshToken);
});
