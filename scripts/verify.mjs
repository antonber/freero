#!/usr/bin/env node
// Real-session end-to-end check for the Freero server. Run: `npm run verify`.
//
// Boots the real server (node --import tsx apps/server/src/main.ts) on a free port with a temporary
// data dir, drives it over REST with real session cookies, connects real y-websocket clients and
// checks sync, role enforcement, persistence across a restart, duplicate/delete, uploads and
// list filters. No fakes. Prints PASS/FAIL per check, exits non-zero on any failure and always
// kills the server.
//
// Database: PGlite under the temp data dir by default. With DATABASE_URL (any database on a real
// Postgres server; its user needs CREATEDB), each run creates and finally drops its own databases
// and also checks that two instances starting at once share the migrations safely.
//
// Multi-instance: with DATABASE_URL and REDIS_URL, two instances share one fresh database and the
// Redis, and clients on different instances must see each other's edits and cursors, access
// changes / logouts / deletes made through the other instance, and every edit saved exactly as
// if one instance had served them (even one whose instance is killed before it saved).

import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
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
// Rate-limit counters are keyed with SESSION_SECRET: a secret of its own keeps this run's servers
// from sharing (Redis-backed) counters with earlier runs.
const RUN_SECRET = randomBytes(32).toString('base64url');
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

let server = null; // the main server: { child, port, log: string[] }
const spawned = new Set(); // every server process, killed on exit

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/** Spawns a server process (node --import tsx, no shell, so signals reach it directly). */
async function spawnServer(dataDir, env = {}) {
  const port = await freePort();
  const log = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      FREERO_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      FREERO_DOC_IDLE_MS: '1000',
      SESSION_SECRET: RUN_SECRET,
      ...(db.url ? { DATABASE_URL: db.url } : {}),
      ...env,
    },
    detached: process.platform !== 'win32', // own process group so we can kill the whole tree
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const proc = { child, port, log, exited: new Promise((r) => child.once('exit', (code) => r(code))) };
  spawned.add(proc);
  void proc.exited.then(() => spawned.delete(proc));
  return proc;
}

/** Resolves once the server answers (401 on /api/auth/me); throws if it exits or times out. */
async function waitUp(proc, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (proc.child.exitCode !== null) throw new Error(`server exited early (code ${proc.child.exitCode}):\n${proc.log.join('')}`);
    try {
      const res = await fetch(`http://127.0.0.1:${proc.port}/api/auth/me`);
      if (res.status === 401) return proc;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`server did not start within ${timeoutMs / 1000}s:\n${proc.log.join('')}`);
}

async function startServer(dataDir) {
  server = await spawnServer(dataDir);
  return waitUp(server);
}

async function stopProc(proc) {
  killTree(proc.child);
  await Promise.race([proc.exited, sleep(5000)]);
}

async function stopServer() {
  if (!server) return;
  await stopProc(server);
  server = null;
}

process.on('exit', () => {
  for (const p of spawned) killTree(p.child);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// ---------------------------------------------------------------------------
// Database: PGlite under the data dir by default; with DATABASE_URL, a fresh throwaway database
// on that Postgres server per run (dropped at the end), so every run migrates from scratch.
// ---------------------------------------------------------------------------
const MIGRATION_LOCK_KEY = 7_202_610_270; // must match apps/server/src/platform/db.ts
const ADMIN_URL = process.env.DATABASE_URL?.trim() || null;
const db = { url: null, kind: ADMIN_URL ? 'postgres' : 'pglite', created: [] };

function dbUrl(name) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

async function adminQuery(sql, url = ADMIN_URL) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}

/** A new empty database on the DATABASE_URL server; returns its URL. */
async function createDatabase() {
  const name = `freero_verify_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminQuery(`CREATE DATABASE ${name}`);
  db.created.push(name);
  return dbUrl(name);
}

async function dropDatabases() {
  for (const name of db.created.splice(0)) {
    try {
      await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } catch (e) {
      console.warn(`(could not drop database ${name}: ${e.message})`);
    }
  }
}

/**
 * Runs SQL against the server's own database, as an operator would. PGlite is single-process:
 * only call this while no server runs on `dataDir`.
 */
async function withDb(dataDir, fn) {
  if (db.url) {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    try {
      return await fn((sql, params) => c.query(sql, params).then((r) => r.rows));
    } finally {
      await c.end();
    }
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite(path.join(dataDir, 'pg').split(path.sep).join('/'));
  await pgl.waitReady;
  try {
    return await fn((sql, params) => pgl.query(sql, params).then((r) => r.rows));
  } finally {
    await pgl.close();
  }
}

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
  /** `port`: which instance to ask (default: the main server). */
  async req(method, url, body, { raw = false, headers = {}, cookie = true, port = server.port } = {}) {
    const h = { ...headers };
    if (cookie && this.cookie) h.cookie = this.cookie;
    if (body !== undefined && !raw) h['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
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

/**
 * `prepare(doc)` runs before connecting (local "offline" content the client brings along).
 * `port`: the instance to connect to (default: the main server).
 */
function connectDoc(user, boardId, prepare, port = server.port) {
  const cookie = user.cookie;
  class CookieWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  }
  const doc = new Y.Doc();
  prepare?.(doc);
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws/boards`, boardId, doc, {
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
  const S = new User('S'); // its session expires
  let board = null;

  try {
    if (ADMIN_URL) {
      const ok = await check('Postgres from DATABASE_URL: create a fresh database for this run', async () => {
        db.url = await createDatabase();
      });
      if (!ok) return;
    }
    console.log(`database: ${db.kind}${db.url ? ` (${db.created[0]})` : ` (${path.join(dataDir, 'pg')})`}\n`);

    await check(`server boots on ${db.kind} and migrates an empty database`, async () => {
      await startServer(dataDir);
    });
    if (!server) return;

    await check('startup fails fast with a clear message when Postgres is unreachable', async () => {
      const port = await freePort(); // nothing listens here
      const p = await spawnServer(path.join(dataDir, 'unused'), {
        DATABASE_URL: `postgres://freero:s3cret-pw@127.0.0.1:${port}/freero`,
      });
      const code = await Promise.race([p.exited, sleep(30_000).then(() => 'still running after 30s')]);
      if (code === 'still running after 30s') await stopProc(p);
      const out = p.log.join('');
      assert(typeof code === 'number' && code !== 0, `exit: ${code}`);
      assert(/Cannot reach Postgres at postgres:\/\/freero:\*\*\*@127\.0\.0\.1/.test(out), `message:\n${out}`);
      assert(!out.includes('s3cret-pw'), 'the database password was printed');
    });

    if (db.kind === 'pglite') {
      await check('a second server on the same PGlite data dir refuses to start; the first keeps working', async () => {
        const p = await spawnServer(dataDir);
        const code = await Promise.race([p.exited, sleep(30_000).then(() => 'still running after 30s')]);
        if (code === 'still running after 30s') await stopProc(p);
        assert(typeof code === 'number' && code !== 0, `second instance exit: ${code}`);
        assert(/in use by another Freero process/.test(p.log.join('')), `message:\n${p.log.join('')}`);
        assert((await fetch(`http://127.0.0.1:${server.port}/api/auth/me`)).status === 401, 'first instance stopped answering');
      });
    } else {
      await check('two instances starting at once on one empty database: both wait on the migration lock, both come up, each migration applied once', async () => {
        const { default: pg } = await import('pg');
        const url = await createDatabase();
        // Hold the migration lock ourselves so both instances must queue on it, then let go.
        const holder = new pg.Client({ connectionString: url });
        await holder.connect();
        const procs = [];
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
          for (let i = 0; i < 2; i++) procs.push(await spawnServer(path.join(dataDir, `twin${i}`), { DATABASE_URL: url }));
          await waitFor(
            async () =>
              (await holder.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n === 2,
            60_000,
            'both instances to wait on the migration advisory lock',
          );
          await holder.query('COMMIT');
          await Promise.all(procs.map((p) => waitUp(p)));
          const rows = await adminQuery('SELECT id, count(*)::int AS n FROM _migrations GROUP BY id', url);
          assert(rows.length >= 4 && rows.every((r) => r.n === 1), `_migrations: ${JSON.stringify(rows)}`);
          const demo = await adminQuery(`SELECT count(*)::int AS n FROM users WHERE email = 'demo@freero.app'`, url);
          assert(demo[0].n === 1, `demo user seeded ${demo[0].n} times`);
          // One database behind both: a session made on one instance works on the other.
          const t = new User('Twin');
          const r = await fetch(`http://127.0.0.1:${procs[0].port}/api/auth/signup`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Twin', email: t.email, password: 'password-123' }),
          });
          assert(r.status === 201, `signup on instance 1: ${r.status}`);
          const cookie = /^freero_session=[^;]*/.exec(r.headers.getSetCookie()[0])[0];
          const me = await fetch(`http://127.0.0.1:${procs[1].port}/api/auth/me`, { headers: { cookie } });
          assert(me.status === 200, `the session from instance 1 on instance 2: ${me.status}`);
        } finally {
          await holder.end().catch(() => {});
          for (const p of procs) await stopProc(p);
        }
      });
    }

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

    await check('simultaneous signups with one email: exactly one account (201), the others 409, never 500', async () => {
      const email = `race-${Date.now()}@verify.freero.app`;
      const statuses = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          new User(`R${i}`).req('POST', '/api/auth/signup', { name: `Racer ${i}`, email, password: 'password-123' }).then((r) => r.status),
        ),
      );
      assert(statuses.filter((s) => s === 201).length === 1 && statuses.filter((s) => s === 409).length === 5, `statuses ${statuses}`);
    });

    await check('concurrent profile edits of different fields both stick', async () => {
      const [n, c] = await Promise.all([
        A.req('PATCH', '/api/auth/me', { name: 'Concurrent Name' }),
        A.req('PATCH', '/api/auth/me', { color: '#123456' }),
      ]);
      assert(n.status === 200 && c.status === 200, `${n.status} ${c.status}`);
      const me = (await A.req('GET', '/api/auth/me')).json.user;
      assert(me.name === 'Concurrent Name' && me.color === '#123456', `lost an edit: ${JSON.stringify(me)}`);
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

    // S's session is aged in the database during the restart below (PGlite allows one process).
    await check('a fresh session works (S; expired after the restart below)', async () => {
      await S.signup();
      assert((await S.req('GET', '/api/auth/me')).status === 200, 'fresh session should work');
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
      await stopServer(); // a hard kill: what was saved must be durable without a clean shutdown
      // Simulate 30 days passing for S: age the session in the server's own database.
      await withDb(dataDir, (q) => q('UPDATE sessions SET expires_at = $1 WHERE user_id = $2', [new Date(Date.now() - 1000), S.id]));
      await startServer(dataDir);
      // Cookies must survive the restart (sessions are in the database).
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

    await check('an expired session is rejected (REST 401, WebSocket 4401)', async () => {
      assert((await S.req('GET', '/api/auth/me')).status === 401, 'expired session still accepted over REST');
      assert((await wsCloseCode('any-board', S.cookie)) === 4401, 'expired session still accepted over WebSocket');
    });

    await check('clients opening a board that is still loading all get its content, and their offline edits are kept', async () => {
      await sleep(1600); // FREERO_DOC_IDLE_MS=1000: the doc is unloaded again
      const clients = [A, B, A].map((u, i) =>
        connectDoc(u, board.id, (doc) => doc.getMap('elements').set(`off${i}`, { id: `off${i}`, type: 'sticky', text: `offline ${i}` })),
      );
      await Promise.all(clients.map((c) => c.ready()));
      for (const c of clients) {
        await waitFor(() => els(c).get('e1')?.text === 'from A' && [0, 1, 2].every((i) => els(c).has(`off${i}`)), 5000, `${c.user.label} to have the stored content and every offline edit`);
      }
      for (const c of clients) c.destroy();
      await sleep(500);
      const again = connectDoc(A, board.id);
      await again.ready();
      assert([0, 1, 2].every((i) => els(again).has(`off${i}`)), `offline edits not saved: ${JSON.stringify([...els(again).keys()])}`);
      again.destroy();
    });

    if (process.platform !== 'win32') {
      await check('SIGTERM saves an edit made just before it (graceful shutdown flushes docs before closing the database)', async () => {
        const g = connectDoc(A, board.id);
        await g.ready();
        els(g).set('sig', { id: 'sig', type: 'sticky', text: 'before SIGTERM' });
        await sleep(200); // reached the server, but well inside the 1.5s save debounce
        const proc = server;
        process.kill(-proc.child.pid, 'SIGTERM');
        const code = await Promise.race([proc.exited, sleep(15_000).then(() => 'timeout')]);
        g.destroy();
        assert(code === 0, `exit code ${code}:\n${proc.log.join('').slice(-2000)}`);
        server = null;
        await startServer(dataDir);
        const after = connectDoc(A, board.id);
        await after.ready();
        assert(els(after).get('sig')?.text === 'before SIGTERM', 'the edit was lost on shutdown');
        after.destroy();
      });
    }

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

    await check('delete: only owner; moves the board to the trash, removing it and its access for everyone; copy survives', async () => {
      assert((await B.req('DELETE', `/api/boards/${board.id}`)).status === 403, 'editor delete');
      const live = connectDoc(B, board.id);
      await live.ready();
      // An edit the server has received but not saved yet (saves are debounced) when the delete lands.
      const watcher = connectDoc(A, board.id);
      await watcher.ready();
      els(live).set('t1', { id: 't1', type: 'sticky', text: 'just before the delete' });
      await waitFor(() => els(watcher).get('t1'), 3000, 'the last edit to reach the server');
      watcher.destroy();
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

    await check('trash: only the owner lists and restores it, with every edit up to the delete; delete forever is final', async () => {
      const trash = await A.req('GET', '/api/boards?filter=trash');
      const entry = trash.json?.boards?.find((b) => b.id === board.id);
      assert(entry && entry.purgeAt - entry.deletedAt === 30 * 86_400_000, `A's trash: ${trash.text}`);
      assert(!titles(await B.req('GET', '/api/boards?filter=trash')).includes(board.id), "in the editor's trash");
      assert((await B.req('POST', `/api/boards/${board.id}/restore`)).status === 404, 'editor restore');
      assert((await B.req('DELETE', `/api/boards/${board.id}/permanent`)).status === 404, 'editor delete forever');
      const restored = await A.req('POST', `/api/boards/${board.id}/restore`);
      assert(restored.status === 200 && restored.json.board.deletedAt === undefined, `restore -> ${restored.status} ${restored.text}`);
      assert((await B.req('GET', `/api/boards/${board.id}`)).status === 200, 'membership did not survive the trash');
      const back = connectDoc(B, board.id);
      await back.ready();
      assert(els(back).get('e2')?.text === 'from B', 'restored board lost its content');
      assert(els(back).get('t1')?.text === 'just before the delete', 'the edit made right before the delete was lost');
      back.destroy();

      assert((await A.req('DELETE', `/api/boards/${board.id}/permanent`)).status === 404, 'delete forever of a live board');
      assert((await A.req('DELETE', `/api/boards/${board.id}`)).status === 200, 'trash again');
      assert((await A.req('DELETE', `/api/boards/${board.id}/permanent`)).status === 200, 'delete forever');
      assert(!titles(await A.req('GET', '/api/boards?filter=trash')).includes(board.id), 'still in the trash');
      assert((await A.req('POST', `/api/boards/${board.id}/restore`)).status === 404, 'restore after delete forever');
    });

    await check('saved templates: owner saves, lists and loads one; nobody else sees or deletes it', async () => {
      const content = { elements: [{ id: 'f1', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Retro', index: 0 }] };
      const saved = await A.req('POST', '/api/templates', { name: 'Retro', description: 'Ours', content, thumbnail: `data:image/png;base64,${PNG_1PX.toString('base64')}` });
      assert(saved.status === 201 && saved.json.template.thumbnail?.startsWith('/uploads/'), `save -> ${saved.status} ${saved.text}`);
      const id = saved.json.template.id;
      assert((await A.req('GET', '/api/templates')).json.templates.some((t) => t.id === id), 'not listed for its owner');
      const loaded = await A.req('GET', `/api/templates/${id}`);
      assert(isDeepStrictEqual(loaded.json.template.content, content), `content changed: ${loaded.text}`);
      assert(!(await B.req('GET', '/api/templates')).json.templates.some((t) => t.id === id), 'listed for someone else');
      assert((await B.req('GET', `/api/templates/${id}`)).status === 404, 'someone else loads it');
      assert((await B.req('DELETE', `/api/templates/${id}`)).status === 404, 'someone else deletes it');
      assert((await A.req('POST', '/api/templates', { name: 'Empty', content: { elements: [] } })).status === 400, 'empty template');
      assert((await A.req('DELETE', `/api/templates/${id}`)).status === 200, 'owner delete');
      assert((await A.req('GET', `/api/templates/${id}`)).status === 404, 'still there after delete');
    });
  } finally {
    closeAllDocs();
    await stopServer();
    for (const p of [...spawned]) await stopProc(p);
    if (ADMIN_URL) await dropDatabases();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (e) {
      console.warn(`(could not remove ${dataDir}: ${e.message})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Production hardening, on its own server with tight limits so it can't disturb the session above:
// readiness, security headers, CSRF, rate limits (429 + Retry-After), quotas, /metrics.
// ---------------------------------------------------------------------------
async function platformChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-platform-'));
  const METRICS_TOKEN = 'verify-metrics-token';
  let proc = null;
  try {
    const env = {
      RATE_LIMIT_LOGIN: '5/1m',
      UPLOAD_QUOTA_MB: '1',
      MAX_BOARDS_PER_USER: '2',
      METRICS_TOKEN,
      SESSION_SECRET: randomBytes(32).toString('base64url'), // its own rate-limit counters
    };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('platform server boots with tight limits', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const base = `http://127.0.0.1:${proc.port}`;
    let cookie = '';
    const call = async (method, url, { body, headers = {}, raw = false } = {}) => {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (body !== undefined && !raw) h['content-type'] = 'application/json';
      const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) {
        const m = /^freero_session=([^;]+)/.exec(c);
        if (m) cookie = `freero_session=${m[1]}`;
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not json */
      }
      return { status: res.status, headers: res.headers, json, text };
    };
    const email = `platform-${Date.now()}@verify.freero.app`;

    await check('GET /healthz is live and /readyz reports the database and storage reachable', async () => {
      assert((await call('GET', '/healthz')).status === 200, 'healthz');
      const r = await call('GET', '/readyz');
      assert(r.status === 200 && r.json?.ok === true, `readyz -> ${r.status} ${r.text}`);
      assert(r.json.checks.db === 'ok' && r.json.checks.storage === 'ok', JSON.stringify(r.json.checks));
    });

    await check('security headers: CSP (no framing, scripts from self), nosniff, referrer policy, request id', async () => {
      const r = await call('GET', '/api/auth/session');
      const csp = r.headers.get('content-security-policy') ?? '';
      assert(/frame-ancestors 'none'/.test(csp) && /script-src 'self'(;|$)/.test(csp), `CSP: ${csp}`);
      assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
      assert(r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'referrer-policy');
      assert(r.headers.get('x-frame-options') === 'DENY', 'x-frame-options');
      assert(/^[0-9a-f-]{36}$/.test(r.headers.get('x-request-id') ?? ''), 'x-request-id');
      assert(!r.headers.get('strict-transport-security'), 'HSTS must not be sent over plain http');
      const viaTls = await call('GET', '/healthz', { headers: { 'x-forwarded-proto': 'https' } });
      assert(!viaTls.headers.get('strict-transport-security'), 'X-Forwarded-Proto trusted without TRUST_PROXY');
    });

    await check('CSRF: a cross-site POST carrying the session cookie is refused (403) and changes nothing', async () => {
      const s = await call('POST', '/api/auth/signup', { body: { name: 'Platform', email, password: 'password-123' }, headers: { origin: base } });
      assert(s.status === 201, `signup -> ${s.status} ${s.text}`);
      const evil = await call('POST', '/api/boards', { body: { title: 'csrf' }, headers: { origin: 'https://evil.example' } });
      assert(evil.status === 403, `cross-site POST -> ${evil.status}`);
      const viaReferer = await call('POST', '/api/boards', { body: { title: 'csrf' }, headers: { referer: 'https://evil.example/x' } });
      assert(viaReferer.status === 403, `cross-site Referer-only POST -> ${viaReferer.status}`);
      const list = await call('GET', '/api/boards');
      assert(list.json.boards.length === 0, `a cross-site POST created a board: ${list.text}`);
      const same = await call('POST', '/api/boards', { body: { title: 'mine' }, headers: { origin: base, 'sec-fetch-site': 'same-origin' } });
      assert(same.status === 201, `same-origin POST -> ${same.status} ${same.text}`);
      const wsStatus = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${proc.port}/ws/boards/${same.json.board.id}`, { headers: { cookie, origin: 'https://evil.example' } });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
        ws.on('open', () => (ws.close(), resolve('open')));
        ws.on('error', () => {});
      });
      assert(wsStatus === 403, `cross-site WebSocket upgrade -> ${wsStatus}`);
    });

    await check('quotas: board limit per user holds under parallel creates (403) and upload quota per user (413)', async () => {
      // One board exists ('mine', limit 2): of eight creates sent at once exactly one may land.
      const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => call('POST', '/api/boards', { body: { title: `burst ${i}` } })));
      const created = burst.filter((r) => r.status === 201).length;
      const refused = burst.filter((r) => r.status === 403 && /limit/i.test(r.json?.error ?? '')).length;
      assert(created === 1 && refused === 7, `parallel creates -> ${burst.map((r) => r.status).join(',')}`);
      const owned = await call('GET', '/api/boards?filter=mine');
      assert(owned.json.boards.length === 2, `owns ${owned.json.boards.length} boards with a limit of 2`);
      const big = Buffer.concat([PNG_1PX, Buffer.alloc(600 * 1024)]); // 2 x 600KB > 1MB quota
      const up1 = await call('POST', '/api/uploads', { body: big, raw: true, headers: { 'content-type': 'image/png' } });
      assert(up1.status === 201, `1st upload -> ${up1.status} ${up1.text}`);
      const up2 = await call('POST', '/api/uploads', { body: big, raw: true, headers: { 'content-type': 'image/png' } });
      assert(up2.status === 413 && /quota/i.test(up2.json?.error ?? ''), `upload over quota -> ${up2.status} ${up2.text}`);
      const served = await call('GET', up1.json.url);
      assert(served.status === 200 && served.headers.get('content-security-policy')?.includes('sandbox'), 'stored upload is served sandboxed');
    });

    await check('login burst: the 6th attempt in the window gets 429 + Retry-After, even with the right password', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await call('POST', '/api/auth/login', { body: { email, password: `wrong-${i}` } });
        assert(r.status === 401, `attempt ${i + 1} -> ${r.status}`);
      }
      const blocked = await call('POST', '/api/auth/login', { body: { email, password: 'password-123' } });
      const retryAfter = Number(blocked.headers.get('retry-after'));
      assert(blocked.status === 429, `6th attempt -> ${blocked.status} ${blocked.text}`);
      assert(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60, `Retry-After: ${blocked.headers.get('retry-after')}`);
      assert((await call('GET', '/api/auth/session')).status === 200, 'other routes stay available');
    });

    await check('/metrics needs the token and exposes HTTP latency, WebSocket and realtime metrics', async () => {
      assert((await call('GET', '/metrics')).status === 401, 'metrics without token');
      const m = await call('GET', '/metrics', { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
      assert(m.status === 200, `metrics -> ${m.status}`);
      for (const name of [
        'freero_http_request_duration_seconds_count{method="POST",route="/api/auth/login",status="429"} 1',
        'freero_rate_limited_total{limit="login"} 1',
        'freero_realtime_loaded_docs',
        'freero_realtime_persist_queue',
      ])
        assert(m.text.includes(name), `missing ${name}`);
    });
  } finally {
    if (proc) await stopProc(proc);
    if (ADMIN_URL) await dropDatabases();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Several instances behind a round-robin balancer: two server processes sharing one Postgres and
// one Redis; every client may land on either (DATABASE_URL + REDIS_URL only).
// ---------------------------------------------------------------------------
async function multiInstanceChecks() {
  const REDIS_URL = process.env.REDIS_URL?.trim();
  if (!ADMIN_URL || !REDIS_URL) {
    console.log('\n(multi-instance checks skipped: they need both DATABASE_URL and REDIS_URL)');
    return;
  }
  console.log('\nmulti-instance: two servers, one Postgres database, one Redis\n');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-multi-'));
  const procs = [];
  let url = null;
  const env = () => ({ DATABASE_URL: url, REDIS_URL });
  const docRows = async (boardId) =>
    (await adminQuery(`SELECT count(*)::int AS n FROM board_doc_updates WHERE board_id = '${boardId}'`, url))[0].n;
  try {
    const up = await check('two instances start on one database and one Redis', async () => {
      url = await createDatabase();
      for (let i = 0; i < 2; i++) procs.push(await spawnServer(path.join(dataDir, `i${i}`), env()));
      await Promise.all(procs.map((p) => waitUp(p)));
    });
    if (!up) return;
    const [one, two] = procs.map((p) => p.port);
    server = procs[0]; // REST calls default to instance 1 below unless they name a port
    const A = new User('MA'); // owner
    const B = new User('MB'); // editor
    let board = null;
    await check('accounts and a shared board, set up through instance 1', async () => {
      for (const u of [A, B]) await u.signup();
      board = (await A.req('POST', '/api/boards', { title: 'Two instances' })).json.board;
      const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: B.email, role: 'editor' });
      assert(r.status === 201, r.text);
    });
    if (!board) return;

    let a, b;
    await check('edits cross instances both ways (A on instance 1, B on instance 2)', async () => {
      a = connectDoc(A, board.id, undefined, one);
      b = connectDoc(B, board.id, undefined, two);
      await Promise.all([a.ready(), b.ready()]);
      els(a).set('m1', { id: 'm1', type: 'sticky', text: 'from instance 1' });
      await waitFor(() => els(b).get('m1')?.text === 'from instance 1', 5000, 'B (instance 2) to receive m1');
      els(b).set('m2', { id: 'm2', type: 'sticky', text: 'from instance 2' });
      await waitFor(() => els(a).get('m2')?.text === 'from instance 2', 5000, 'A (instance 1) to receive m2');
    });

    await check('cursors cross instances, with the identity the server stamped', async () => {
      b.provider.awareness.setLocalStateField('user', { id: A.id, name: 'not B', color: '#000000' });
      b.provider.awareness.setLocalStateField('cursor', { x: 21, y: 22 });
      a.provider.awareness.setLocalStateField('cursor', { x: 11, y: 12 });
      const stateOf = (viewer, client) => viewer.provider.awareness.getStates().get(client.doc.clientID);
      await waitFor(() => stateOf(a, b)?.cursor?.x === 21, 5000, "A (instance 1) to see B's cursor");
      await waitFor(() => stateOf(b, a)?.cursor?.x === 11, 5000, "B (instance 2) to see A's cursor");
      assert(stateOf(a, b).user.id === B.id, `instance 1 shows B as ${JSON.stringify(stateOf(a, b).user)}`);
    });

    await check('a client leaving instance 2 disappears from presence on instance 1', async () => {
      const g = connectDoc(B, board.id, undefined, two);
      await g.ready();
      g.provider.awareness.setLocalStateField('cursor', { x: 5, y: 5 });
      await waitFor(() => a.provider.awareness.getStates().get(g.doc.clientID)?.cursor?.x === 5, 5000, 'A to see the guest cursor');
      const id = g.doc.clientID;
      g.destroy();
      await waitFor(() => !a.provider.awareness.getStates().has(id), 5000, 'the guest cursor to disappear on instance 1');
    });

    await check("opening the board on instance 2 right after an edit on instance 1 shows it before it is even saved", async () => {
      const fresh = (await A.req('POST', '/api/boards', { title: 'Unsaved' })).json.board;
      const w = connectDoc(A, fresh.id, undefined, one);
      await w.ready();
      els(w).set('u1', { id: 'u1', type: 'sticky', text: 'not saved yet' });
      await sleep(100); // reached instance 1; its save waits ~1.5 s (debounce)
      const r = connectDoc(A, fresh.id, undefined, two); // instance 2 loads the board from the database
      await r.ready();
      await waitFor(() => els(r).get('u1')?.text === 'not saved yet', 1000, 'the reader on instance 2 to get the unsaved edit');
      assert((await docRows(fresh.id)) === 0, 'the edit was already saved, so this proves nothing about fan-out');
      w.destroy();
      r.destroy();
    });

    await check('a role change made through instance 2 applies live to a socket on instance 1', async () => {
      const b1 = connectDoc(B, board.id, undefined, one);
      await b1.ready();
      assert(b1.role === 'editor', `role ${b1.role}`);
      const r = await A.req('PATCH', `/api/boards/${board.id}/members/${B.id}`, { role: 'viewer' }, { port: two });
      assert(r.status === 200, r.text);
      await waitFor(() => b1.role === 'viewer', 5000, 'the socket on instance 1 to become viewer');
      els(b1).set('ignored', { id: 'ignored', type: 'sticky', text: 'viewer write' });
      await sleep(600);
      assert(!els(a).has('ignored') && !els(b).has('ignored'), "a viewer's write crossed instances");
      assert((await A.req('PATCH', `/api/boards/${board.id}/members/${B.id}`, { role: 'editor' }, { port: two })).status === 200, 'restore');
      await waitFor(() => b.role === 'editor', 5000, 'B on instance 2 to be editor again');
      b1.destroy();
    });

    await check('logging out through instance 2 closes that session\'s socket on instance 1 (4401)', async () => {
      const L = new User('ML');
      await L.signup();
      const own = (await L.req('POST', '/api/boards', { title: 'L' })).json.board;
      const live = connectDoc(L, own.id, undefined, one);
      await live.ready();
      assert((await L.req('POST', '/api/auth/logout', undefined, { port: two })).status === 200, 'logout');
      await waitFor(() => live.closeCodes.includes(4401), 5000, 'the socket on instance 1 to close with 4401');
      live.destroy();
    });

    await check('edits made on both instances at once are all saved, and the log is compacted after both unload', async () => {
      for (let i = 0; i < 15; i++) {
        els(a).set(`x${i}`, { id: `x${i}`, type: 'sticky', text: `a${i}` });
        els(b).set(`y${i}`, { id: `y${i}`, type: 'sticky', text: `b${i}` });
        await sleep(20);
      }
      const all = (c) => Array.from({ length: 15 }, (_, i) => i).every((i) => els(c).has(`x${i}`) && els(c).has(`y${i}`));
      await waitFor(() => all(a) && all(b), 5000, 'both clients to converge');
      a.destroy();
      b.destroy();
      // Saved on the last disconnect; unloaded (and compacted) after FREERO_DOC_IDLE_MS=1000.
      await waitFor(async () => (await docRows(board.id)) === 0, 10_000, 'the update log to be compacted into the base');
      const reader = connectDoc(A, board.id, undefined, two);
      await reader.ready();
      assert(all(reader) && els(reader).has('m1') && els(reader).has('m2'), `after reload: ${JSON.stringify([...els(reader).keys()])}`);
      reader.destroy();
    });

    await check('an instance killed before saving loses nothing: the other instance saves what it relayed', async () => {
      const k = connectDoc(A, board.id, undefined, one);
      const s = connectDoc(B, board.id, undefined, two);
      await Promise.all([k.ready(), s.ready()]);
      els(k).set('crash', { id: 'crash', type: 'sticky', text: 'made on the instance that dies' });
      await waitFor(() => els(s).has('crash'), 5000, 'the edit to reach instance 2');
      k.destroy(); // its client goes away too (otherwise it would re-send the edit on reconnect)
      await stopProc(procs[0]); // hard kill, well inside the save debounce
      s.destroy(); // instance 2 unloads the board after FREERO_DOC_IDLE_MS
      await sleep(2500);
      const after = connectDoc(A, board.id, undefined, two);
      await after.ready();
      assert(els(after).get('crash')?.text === 'made on the instance that dies', 'the edit died with its instance');
      after.destroy();
      // Instance 1 comes back (as after a crash restart) for the delete check below.
      procs[0] = await waitUp(await spawnServer(path.join(dataDir, 'i0b'), env()));
    });

    await check('deleting the board through instance 2 disconnects its sockets on instance 1 (4403)', async () => {
      const live = connectDoc(B, board.id, undefined, procs[0].port);
      await live.ready();
      assert((await A.req('DELETE', `/api/boards/${board.id}`, undefined, { port: two })).status === 200, 'delete');
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'the socket on instance 1 to close with 4403');
      live.destroy();
    });
  } finally {
    closeAllDocs();
    server = null;
    for (const p of procs) await stopProc(p);
    await dropDatabases();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

const started = Date.now();
await run().catch((e) => record('verify harness', false, e?.stack ?? String(e)));
await platformChecks().catch((e) => record('platform checks harness', false, e?.stack ?? String(e)));
await multiInstanceChecks().catch((e) => record('multi-instance checks harness', false, e?.stack ?? String(e)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
console.log('verify: PASS');
process.exit(0);
