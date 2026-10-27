#!/usr/bin/env node
// Real-session end-to-end check for the Freero server. Run: `npm run verify`.
//
// Boots the real server (npx tsx apps/server/src/main.ts) on a free port with a temporary data
// dir, drives it over REST with real session cookies, connects real y-websocket clients and
// checks sync, role enforcement, persistence across a restart, duplicate/delete, uploads and
// list filters. No fakes. Prints PASS/FAIL per check, exits non-zero on any failure and always
// kills the server.

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as decoding from 'lib0/decoding';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WS_MESSAGE_ROLE = 100;
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
}
class CheckError extends Error {}
function assert(cond, msg) {
  if (!cond) throw new CheckError(msg);
}
/** Runs one named check; failures are recorded, never thrown. */
async function check(name, fn) {
  try {
    await fn();
    record(name, true);
    return true;
  } catch (e) {
    record(name, false, e instanceof CheckError ? e.message : (e?.stack ?? String(e)));
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 5000, what = 'condition') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new CheckError(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// Server process
// ---------------------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let server = null; // { child, port, log: string[] }

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

async function startServer(dataDir) {
  const port = await freePort();
  const log = [];
  const child = spawn('npx', ['tsx', 'apps/server/src/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FREERO_DATA_DIR: dataDir, NODE_ENV: 'test', FREERO_DOC_IDLE_MS: '1000' },
    shell: process.platform === 'win32', // npx is a .cmd shim on Windows
    detached: process.platform !== 'win32', // own process group so we can kill the whole tree
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  server = { child, port, log };
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log.join('')}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      if (res.status === 401) return server;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`server did not start within 60s:\n${log.join('')}`);
}

async function stopServer() {
  if (!server) return;
  const { child } = server;
  const exited = new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  killTree(child);
  await Promise.race([exited, sleep(5000)]);
  server = null;
}

process.on('exit', () => server && killTree(server.child));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// ---------------------------------------------------------------------------
// REST client with a real cookie jar
// ---------------------------------------------------------------------------
class User {
  constructor(label) {
    this.label = label;
    this.cookie = '';
    this.id = null;
    this.email = `${label.toLowerCase()}-${Date.now()}@verify.freero.app`;
    this.name = `User ${label}`;
  }
  async req(method, url, body, { raw = false, headers = {}, cookie = true } = {}) {
    const h = { ...headers };
    if (cookie && this.cookie) h.cookie = this.cookie;
    if (body !== undefined && !raw) h['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${server.port}${url}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const m = /^freero_session=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `freero_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  async signup() {
    const r = await this.req('POST', '/api/auth/signup', { name: this.name, email: this.email, password: 'password-123' });
    assert(r.status === 201 || r.status === 200, `${this.label} signup -> ${r.status} ${r.text}`);
    this.id = r.json.user.id;
    return r;
  }
}

// ---------------------------------------------------------------------------
// Real y-websocket clients
// ---------------------------------------------------------------------------
const providers = new Set();

function connectDoc(user, boardId) {
  const cookie = user.cookie;
  class CookieWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  }
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}/ws/boards`, boardId, doc, {
    WebSocketPolyfill: CookieWebSocket,
    disableBc: true,
    connect: false,
  });
  const client = { user, doc, provider, role: null, closeCodes: [] };
  provider.messageHandlers[WS_MESSAGE_ROLE] = (_encoder, decoder) => {
    const msg = JSON.parse(decoding.readVarString(decoder));
    if (msg.type === 'role') client.role = msg.role;
  };
  provider.on('connection-close', (event) => event && client.closeCodes.push(event.code));
  provider.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: '#1C7ED6' });
  provider.connect();
  client.ready = () => waitFor(() => provider.synced && client.role !== null, 8000, `${user.label} to sync`);
  client.destroy = () => {
    providers.delete(client);
    provider.destroy();
    doc.destroy();
  };
  providers.add(client);
  return client;
}

function closeAllDocs() {
  for (const c of [...providers]) c.destroy();
}

/** Opens a raw socket and resolves with the close code the server uses. */
function wsCloseCode(boardId, cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/boards/${boardId}`, {
      headers: cookie ? { cookie } : {},
    });
    const t = setTimeout(() => {
      ws.terminate();
      resolve('no close within 5s');
    }, 5000);
    ws.on('close', (code) => {
      clearTimeout(t);
      resolve(code);
    });
    ws.on('error', () => {});
  });
}

const els = (c) => c.doc.getMap('elements');
const titles = (r) => (r.json?.boards ?? []).map((b) => b.id);

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------
async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-'));
  console.log(`freero verify — data dir ${dataDir}\n`);
  const A = new User('A'); // owner
  const B = new User('B'); // editor
  const C = new User('C'); // viewer
  const D = new User('D'); // commenter
  const E = new User('E'); // not a member
  let board = null;

  try {
    await check('server boots (npx tsx apps/server/src/main.ts)', async () => {
      await startServer(dataDir);
    });
    if (!server) return;

    // ---- auth ----
    await check('signup users A, B, C, D, E via REST (sets session cookie)', async () => {
      for (const u of [A, B, C, D, E]) {
        const r = await u.signup();
        assert(u.cookie.startsWith('freero_session='), `${u.label}: no session cookie`);
        assert(/^#[0-9A-Fa-f]{6}$/.test(r.json.user.color), `${u.label}: no cursor color`);
        assert(!('passwordHash' in r.json.user), 'password hash leaked');
      }
      const setCookie = (await new User('Z').req('POST', '/api/auth/login', { email: A.email, password: 'password-123' })).headers.get('set-cookie') ?? '';
      assert(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), `cookie flags: ${setCookie}`);
    });

    await check('auth validation: duplicate email 409, bad email/short password 400, wrong password 401', async () => {
      const x = new User('X');
      assert((await x.req('POST', '/api/auth/signup', { name: 'X', email: A.email, password: 'password-123' })).status === 409, 'dup');
      assert((await x.req('POST', '/api/auth/signup', { name: 'X', email: 'not-an-email', password: 'password-123' })).status === 400, 'email');
      assert((await x.req('POST', '/api/auth/signup', { name: 'X', email: 'x@x.io', password: 'short' })).status === 400, 'pw');
      assert((await x.req('POST', '/api/auth/login', { email: A.email, password: 'wrong-password' })).status === 401, 'login');
      assert((await x.req('POST', '/api/auth/login', { email: 'nobody@x.io', password: 'wrong-password' })).status === 401, 'login2');
    });

    await check('me / PATCH me / logout / login', async () => {
      const me = await A.req('GET', '/api/auth/me');
      assert(me.status === 200 && me.json.user.id === A.id, `me ${me.status}`);
      const p = await A.req('PATCH', '/api/auth/me', { name: 'Alice', color: '#2F9E44' });
      assert(p.status === 200 && p.json.user.name === 'Alice' && p.json.user.color === '#2F9E44', `patch ${p.text}`);
      A.name = 'Alice';
      const z = new User('Z');
      assert((await z.req('POST', '/api/auth/login', { email: A.email, password: 'password-123' })).status === 200, 'login');
      assert((await z.req('POST', '/api/auth/logout')).status === 200, 'logout');
      assert((await z.req('GET', '/api/auth/me')).status === 401, 'me after logout should be 401');
      assert((await new User('Q').req('GET', '/api/boards')).status === 401, 'boards without cookie should be 401');
    });

    await check('an expired session is rejected (REST 401, WebSocket 4401)', async () => {
      const s = new User('S');
      await s.signup();
      assert((await s.req('GET', '/api/auth/me')).status === 200, 'fresh session should work');
      // Simulate 30 days passing: age this user's session in the server's own database.
      const { DatabaseSync } = await import('node:sqlite');
      const dbh = new DatabaseSync(path.join(dataDir, 'freero.db'));
      try {
        dbh.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, s.id);
      } finally {
        dbh.close();
      }
      assert((await s.req('GET', '/api/auth/me')).status === 401, 'expired session still accepted over REST');
      assert((await wsCloseCode('any-board', s.cookie)) === 4401, 'expired session still accepted over WebSocket');
    });

    await check('logging out closes the live board sockets of that session (4401), not just the cookie', async () => {
      const l = new User('L');
      await l.signup();
      const own = (await l.req('POST', '/api/boards', { title: 'L board' })).json.board;
      const live = connectDoc(l, own.id);
      await live.ready();
      assert((await l.req('POST', '/api/auth/logout')).status === 200, 'logout');
      await waitFor(() => live.closeCodes.includes(4401), 5000, 'the open socket to be closed with 4401');
      live.destroy();
    });

    // ---- boards + members ----
    await check('A creates a board (default title) and renames it', async () => {
      const r = await A.req('POST', '/api/boards', {});
      assert(r.status === 201 && r.json.board.title === 'Untitled board' && r.json.board.role === 'owner', r.text);
      board = r.json.board;
      const p = await A.req('PATCH', `/api/boards/${board.id}`, { title: 'Verify Roadmap' });
      assert(p.status === 200 && p.json.board.title === 'Verify Roadmap', p.text);
      board = p.json.board;
    });
    if (!board) return;

    await check('A invites B as editor, C as viewer, D as commenter; unknown email -> 404', async () => {
      for (const [u, role] of [[B, 'editor'], [C, 'viewer'], [D, 'commenter']]) {
        const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role });
        assert(r.status === 201 && r.json.member.role === role && r.json.member.userId === u.id, r.text);
      }
      const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: 'ghost@nowhere.io', role: 'viewer' });
      assert(r.status === 404 && r.json.error === 'No Freero account with that email', r.text);
    });

    await check('members list includes owner (role owner) and invitees', async () => {
      const r = await B.req('GET', `/api/boards/${board.id}/members`);
      const roles = Object.fromEntries(r.json.members.map((m) => [m.userId, m.role]));
      assert(roles[A.id] === 'owner' && roles[B.id] === 'editor' && roles[C.id] === 'viewer' && roles[D.id] === 'commenter', JSON.stringify(roles));
      assert((await E.req('GET', `/api/boards/${board.id}/members`)).status === 403, 'non-member should get 403');
    });

    await check('an editor cannot change roles by re-inviting (409); the owner can', async () => {
      const r = await B.req('POST', `/api/boards/${board.id}/members`, { email: C.email, role: 'editor' });
      assert(r.status === 409, `editor promoting the viewer -> ${r.status} ${r.text}`);
      const roles = Object.fromEntries((await A.req('GET', `/api/boards/${board.id}/members`)).json.members.map((m) => [m.userId, m.role]));
      assert(roles[C.id] === 'viewer', `C's role changed to ${roles[C.id]}`);
      assert((await B.req('POST', `/api/boards/${board.id}/members`, { email: C.email, role: 'viewer' })).status === 201, 'same-role re-invite');
    });

    await check('member emails are shown to owner/editors only (a viewer sees just their own)', async () => {
      const seen = (await C.req('GET', `/api/boards/${board.id}/members`)).json.members.filter((m) => m.email).map((m) => m.userId);
      assert(seen.length === 1 && seen[0] === C.id, `viewer sees emails of ${JSON.stringify(seen)}`);
      const byEditor = (await B.req('GET', `/api/boards/${board.id}/members`)).json.members;
      assert(byEditor.every((m) => m.email), 'editor should see every email');
    });

    await check('board permissions: editor renames, only owner sets linkAccess, viewer cannot rename', async () => {
      assert((await B.req('PATCH', `/api/boards/${board.id}`, { description: 'from B' })).status === 200, 'editor patch');
      assert((await B.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'viewer' })).status === 403, 'editor linkAccess');
      assert((await C.req('PATCH', `/api/boards/${board.id}`, { title: 'nope' })).status === 403, 'viewer patch');
      assert((await E.req('GET', `/api/boards/${board.id}`)).status === 403, 'non-member GET');
      assert((await A.req('GET', `/api/boards/doesnotexist`)).status === 404, 'missing board');
    });

    // ---- realtime ----
    let a, b, c, d;
    await check('WebSocket clients connect, sync, and receive their role message', async () => {
      a = connectDoc(A, board.id);
      b = connectDoc(B, board.id);
      c = connectDoc(C, board.id);
      d = connectDoc(D, board.id);
      await Promise.all([a.ready(), b.ready(), c.ready(), d.ready()]);
      assert(a.role === 'owner' && b.role === 'editor' && c.role === 'viewer' && d.role === 'commenter', `roles ${a.role} ${b.role} ${c.role} ${d.role}`);
    });

    await check("A's element reaches B (and the viewer C)", async () => {
      els(a).set('e1', { id: 'e1', type: 'sticky', x: 10, y: 20, text: 'from A' });
      await waitFor(() => els(b).get('e1')?.text === 'from A', 5000, 'B to receive e1');
      await waitFor(() => els(c).get('e1')?.text === 'from A', 5000, 'C to receive e1');
    });

    await check("B's edit reaches A", async () => {
      els(b).set('e2', { id: 'e2', type: 'shape', x: 0, y: 0, text: 'from B' });
      await waitFor(() => els(a).get('e2')?.text === 'from B', 5000, 'A to receive e2');
    });

    await check('presence (awareness) is relayed, including for the viewer', async () => {
      c.provider.awareness.setLocalStateField('cursor', { x: 1, y: 2 });
      await waitFor(
        () => [...a.provider.awareness.getStates().values()].some((s) => s.user?.id === C.id && s.cursor?.x === 1),
        5000,
        "A to see C's cursor",
      );
    });

    await check('presence cannot impersonate: a client claiming to be A shows up as itself', async () => {
      d.provider.awareness.setLocalStateField('user', { id: A.id, name: 'A (fake)', color: '#000000' });
      d.provider.awareness.setLocalStateField('cursor', { x: 7, y: 7 });
      const dState = () => a.provider.awareness.getStates().get(d.doc.clientID);
      await waitFor(() => dState()?.cursor?.x === 7, 5000, "A to see D's cursor");
      assert(dState().user.id === D.id && dState().user.name === D.name, `A sees D as ${JSON.stringify(dState().user)}`);
    });

    await check("viewer C's writes never reach A, but C keeps receiving updates", async () => {
      els(c).set('c1', { id: 'c1', type: 'sticky', text: 'from viewer' });
      c.doc.getMap('comments').set('ct', { text: 'viewer comment' });
      els(a).set('e3', { id: 'e3', type: 'text', text: 'after viewer write' });
      await waitFor(() => els(c).get('e3') !== undefined, 5000, 'C to receive e3');
      await sleep(600);
      assert(!els(a).has('c1') && !els(b).has('c1'), 'viewer element leaked to A/B');
      assert(!a.doc.getMap('comments').has('ct'), 'viewer comment leaked to A');
    });

    await check("commenter D can write 'comments' but not 'elements'", async () => {
      d.doc.getMap('comments').set('t1', { id: 't1', text: 'nice!', author: D.id });
      await waitFor(() => a.doc.getMap('comments').get('t1')?.text === 'nice!', 5000, "A to receive D's comment");
      els(d).set('d1', { id: 'd1', type: 'sticky', text: 'from commenter' });
      d.doc.transact(() => {
        d.doc.getMap('comments').set('t2', { text: 'mixed' });
        els(d).delete('e1');
      });
      await sleep(800);
      assert(!els(a).has('d1'), "commenter's element reached A");
      assert(els(a).has('e1'), "commenter's delete of e1 reached A");
      assert(!a.doc.getMap('comments').has('t2'), 'mixed comment+element update was accepted');
    });

    await check('role changes apply live (owner promotes C to editor over REST)', async () => {
      // Fresh client: the old one still holds the viewer edits the server dropped, and Yjs would
      // (correctly) sync them once C is allowed to write.
      c.destroy();
      c = connectDoc(C, board.id);
      await c.ready();
      assert(c.role === 'viewer', `role ${c.role}`);
      const r = await A.req('PATCH', `/api/boards/${board.id}/members/${C.id}`, { role: 'editor' });
      assert(r.status === 200 && r.json.member.role === 'editor', r.text);
      await waitFor(() => c.role === 'editor', 5000, 'C to get role editor');
      els(c).set('c2', { id: 'c2', type: 'sticky', text: 'C as editor' });
      await waitFor(() => els(a).get('c2')?.text === 'C as editor', 5000, "A to receive C's edit");
      assert((await B.req('PATCH', `/api/boards/${board.id}/members/${C.id}`, { role: 'viewer' })).status === 403, 'editor changed a role');
      assert((await A.req('PATCH', `/api/boards/${board.id}/members/${C.id}`, { role: 'viewer' })).status === 200, 'demote');
      await waitFor(() => c.role === 'viewer', 5000, 'C to get role viewer again');
    });

    await check('unauthenticated socket is closed with 4401', async () => {
      const code = await wsCloseCode(board.id, '');
      assert(code === 4401, `got ${code}`);
      const bad = await wsCloseCode(board.id, 'freero_session=forged');
      assert(bad === 4401, `forged cookie got ${bad}`);
    });

    await check("non-member gets 4403 while linkAccess is 'none'", async () => {
      const code = await wsCloseCode(board.id, E.cookie);
      assert(code === 4403, `got ${code}`);
      assert((await wsCloseCode('no-such-board', A.cookie)) === 4403, 'missing board should be 4403');
    });

    await check("link access: with linkAccess 'viewer' a non-member opens the board as viewer", async () => {
      const p = await A.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'viewer' });
      assert(p.status === 200 && p.json.board.linkAccess === 'viewer', p.text);
      const g = await E.req('GET', `/api/boards/${board.id}`);
      assert(g.status === 200 && g.json.board.role === 'viewer', g.text);
      const e = connectDoc(E, board.id);
      await e.ready();
      assert(e.role === 'viewer', `role ${e.role}`);
      assert(els(e).get('e2')?.text === 'from B', 'link viewer did not get doc content');
      e.destroy();
    });

    // ---- uploads + thumbnail ----
    let uploadUrl = null;
    await check('upload round-trip (POST /api/uploads -> GET /uploads/:file)', async () => {
      const r = await A.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
      assert(r.status === 201 || r.status === 200, r.text);
      uploadUrl = r.json.url;
      assert(/^\/uploads\/[A-Za-z0-9_-]+\.png$/.test(uploadUrl), `url ${uploadUrl}`);
      const res = await fetch(`http://127.0.0.1:${server.port}${uploadUrl}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert(res.status === 200 && bytes.equals(PNG_1PX), `GET ${res.status}, ${bytes.length} bytes`);
      assert(res.headers.get('content-type') === 'image/png', `content-type ${res.headers.get('content-type')}`);
    });

    await check('upload rejects: no auth 401, wrong type 415, bad bytes 400', async () => {
      const anon = new User('anon');
      assert((await anon.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).status === 401, 'anon');
      assert((await A.req('POST', '/api/uploads', Buffer.from('hi'), { raw: true, headers: { 'content-type': 'text/plain' } })).status === 415, 'type');
      assert((await A.req('POST', '/api/uploads', Buffer.from('not a png'), { raw: true, headers: { 'content-type': 'image/png' } })).status === 400, 'bytes');
    });

    await check('thumbnail: editor saves it, viewer cannot, summary exposes it', async () => {
      const dataUrl = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
      assert((await B.req('PUT', `/api/boards/${board.id}/thumbnail`, { dataUrl })).status === 200, 'editor');
      assert((await C.req('PUT', `/api/boards/${board.id}/thumbnail`, { dataUrl })).status === 403, 'viewer');
      const g = await A.req('GET', `/api/boards/${board.id}`);
      const thumb = g.json.board.thumbnail;
      assert(typeof thumb === 'string' && thumb.length > 0, `thumbnail ${thumb}`);
      if (thumb.startsWith('/uploads/')) assert((await fetch(`http://127.0.0.1:${server.port}${thumb}`)).status === 200, 'thumb fetch');
    });

    // ---- persistence across restart ----
    await check('doc change bumps board updatedAt (after debounce)', async () => {
      const before = (await A.req('GET', `/api/boards/${board.id}`)).json.board.updatedAt;
      els(a).set('e4', { id: 'e4', type: 'sticky', text: 'bump' });
      await waitFor(async () => (await A.req('GET', `/api/boards/${board.id}`)).json.board.updatedAt > before, 6000, 'updatedAt to increase');
    });

    await check('server restarts on the same data dir and the doc persisted', async () => {
      closeAllDocs();
      await sleep(500); // last disconnect persists immediately; small grace for the socket close
      await stopServer();
      await startServer(dataDir);
      // Cookies must survive the restart (sessions are in SQLite).
      const me = await A.req('GET', '/api/auth/me');
      assert(me.status === 200, `session lost across restart: ${me.status}`);
      const a2 = connectDoc(A, board.id);
      await a2.ready();
      const m = els(a2);
      assert(m.get('e1')?.text === 'from A' && m.get('e2')?.text === 'from B' && m.get('e3') && m.get('c2') && m.get('e4'), `elements after restart: ${JSON.stringify([...m.keys()])}`);
      assert(a2.doc.getMap('comments').get('t1')?.text === 'nice!', "D's comment not persisted");
      assert(!m.has('c1') && !m.has('d1') && !a2.doc.getMap('comments').has('t2') && !a2.doc.getMap('comments').has('ct'), 'rejected writes were persisted');
      a2.destroy();
    });

    // ---- list filters ----
    await check('list filters: all / mine / shared / starred / recent / q', async () => {
      const mine = await A.req('GET', '/api/boards?filter=mine');
      assert(titles(mine).includes(board.id), 'A mine');
      const bMine = await B.req('GET', '/api/boards?filter=mine');
      assert(!titles(bMine).includes(board.id), 'B mine should not include');
      const bShared = await B.req('GET', '/api/boards?filter=shared');
      assert(titles(bShared).includes(board.id) && bShared.json.boards.find((x) => x.id === board.id).ownerName === 'Alice', 'B shared');
      const aShared = await A.req('GET', '/api/boards?filter=shared');
      assert(!titles(aShared).includes(board.id), 'A shared should not include own');
      assert(titles(await B.req('GET', '/api/boards?filter=all')).includes(board.id), 'B all');
      assert(!titles(await B.req('GET', '/api/boards?filter=starred')).includes(board.id), 'B starred before star');
      assert((await B.req('PUT', `/api/boards/${board.id}/star`)).status === 200, 'star');
      const starred = await B.req('GET', '/api/boards?filter=starred');
      assert(titles(starred).includes(board.id) && starred.json.boards[0].starred === true, 'B starred');
      assert(!titles(await A.req('GET', '/api/boards?filter=starred')).includes(board.id), 'stars are per user');
      assert((await B.req('DELETE', `/api/boards/${board.id}/star`)).status === 200, 'unstar');
      assert(!titles(await B.req('GET', '/api/boards?filter=starred')).includes(board.id), 'B unstarred');
      assert(!titles(await D.req('GET', '/api/boards?filter=recent')).includes(board.id), 'D recent before open');
      await D.req('GET', `/api/boards/${board.id}`);
      const recent = await D.req('GET', '/api/boards?filter=recent');
      assert(titles(recent).includes(board.id) && recent.json.boards[0].lastOpenedAt > 0, 'D recent after open');
      assert(titles(await A.req('GET', '/api/boards?q=roadmap')).includes(board.id), 'q match (case-insensitive)');
      assert(!titles(await A.req('GET', '/api/boards?q=zzzz')).includes(board.id), 'q no match');
      assert(titles(await E.req('GET', '/api/boards?filter=recent')).includes(board.id), 'link visitor E sees it in recent');
      assert((await A.req('GET', '/api/boards?filter=bogus')).status === 400, 'bad filter 400');
    });

    // ---- duplicate + delete ----
    let copy = null;
    await check('duplicate copies the Yjs state; duplicating user becomes owner', async () => {
      const r = await A.req('POST', `/api/boards/${board.id}/duplicate`);
      assert(r.status === 201 || r.status === 200, r.text);
      copy = r.json.board;
      assert(copy.title === 'Copy of Verify Roadmap' && copy.role === 'owner' && copy.ownerId === A.id && copy.id !== board.id, JSON.stringify(copy));
      const cd = connectDoc(A, copy.id);
      await cd.ready();
      assert(els(cd).get('e1')?.text === 'from A' && cd.doc.getMap('comments').get('t1')?.text === 'nice!', 'copy has no content');
      cd.destroy();
      const rb = await B.req('POST', `/api/boards/${board.id}/duplicate`);
      assert(rb.json.board.ownerId === B.id && rb.json.board.role === 'owner', 'B copy owner');
      assert((await C.req('GET', `/api/boards/${copy.id}`)).status === 403, "members don't carry over to copies");
    });

    await check('member removal: owner removes, member leaves, others cannot remove', async () => {
      assert((await B.req('DELETE', `/api/boards/${board.id}/members/${D.id}`)).status === 403, 'editor removed D');
      assert((await C.req('DELETE', `/api/boards/${board.id}/members/${C.id}`)).status === 200, 'C leave');
      assert((await A.req('DELETE', `/api/boards/${board.id}/members/${D.id}`)).status === 200, 'A removes D');
      const list = await A.req('GET', `/api/boards/${board.id}/members`);
      const ids = list.json.members.map((m) => m.userId);
      assert(!ids.includes(C.id) && !ids.includes(D.id) && ids.includes(B.id), JSON.stringify(ids));
    });

    await check('delete: only owner; removes board, doc and access; copy survives', async () => {
      assert((await B.req('DELETE', `/api/boards/${board.id}`)).status === 403, 'editor delete');
      const live = connectDoc(B, board.id);
      await live.ready();
      assert((await A.req('DELETE', `/api/boards/${board.id}`)).status === 200, 'owner delete');
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'connected editor to be closed with 4403');
      live.destroy();
      assert((await A.req('GET', `/api/boards/${board.id}`)).status === 404, 'GET after delete');
      assert(!titles(await A.req('GET', '/api/boards')).includes(board.id), 'still listed for A');
      assert(!titles(await B.req('GET', '/api/boards')).includes(board.id), 'still listed for B');
      assert((await wsCloseCode(board.id, A.cookie)) === 4403, 'ws after delete');
      const cd = connectDoc(A, copy.id);
      await cd.ready();
      assert(els(cd).get('e2')?.text === 'from B', 'copy lost its content');
      cd.destroy();
    });
  } finally {
    closeAllDocs();
    await stopServer();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (e) {
      console.warn(`(could not remove ${dataDir}: ${e.message})`);
    }
  }
}

const started = Date.now();
await run().catch((e) => record('verify harness', false, e?.stack ?? String(e)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
console.log('verify: PASS');
process.exit(0);
