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
import * as encoding from 'lib0/encoding';
import { generate as totpCode } from 'otplib';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { writeMmdb } from './lib/mmdb-writer.mjs';
import { startMockOidc } from './lib/mock-oidc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WS_MESSAGE_ROLE = 100;
const WS_MESSAGE_LAYER = 101; // board layers (see @freero/shared api.ts)
const WS_MESSAGE_LAYER_OP = 102;
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
      // Every check signs up accounts from 127.0.0.1; with REDIS_URL all servers of a run share the counters.
      RATE_LIMIT_SIGNUP: '1000/1h',
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
  /** `port`: talk to another server than the main one (default: the main server). */
  constructor(label, port = null) {
    this.port = port;
    this.label = label;
    this.cookie = '';
    this.id = null;
    this.email = `${label.toLowerCase()}-${Date.now()}@verify.freero.app`;
    this.name = `User ${label}`;
  }
  /** `port`: which instance to ask (default: the main server). */
  async req(method, url, body, { raw = false, headers = {}, cookie = true, port = this.port ?? server.port } = {}) {
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
    const r = await this.req('POST', '/api/auth/signup', { name: this.name, email: this.email, password: this.password ?? 'password-123' });
    assert(r.status === 201 || r.status === 200, `${this.label} signup -> ${r.status} ${r.text}`);
    this.id = r.json.user.id;
    return r;
  }
  /** Opens the verification link mailed at signup (dev outbox under `dataDir`). */
  async verifyEmail(dataDir) {
    const token = await mailedToken(dataDir, this.email, '/verify-email');
    const r = await this.req('POST', '/api/auth/verify-email', { token });
    assert(r.status === 200, `${this.label} verify -> ${r.status} ${r.text}`);
    return token;
  }
}

// ---------------------------------------------------------------------------
// The development outbox (no SMTP_URL): every mail is a JSON file under <data>/outbox/
// ---------------------------------------------------------------------------
function outbox(dataDir) {
  const dir = path.join(dataDir, 'outbox');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.sentAt - b.sentAt);
}

/** The token of the newest `route` link (e.g. '/reset-password', '/invite') mailed to `to`, waiting for it. */
async function mailedToken(dataDir, to, route, { after = 0, timeoutMs = 8000 } = {}) {
  const re = new RegExp(`${route.replace(/[/]/g, '\\/')}(?:\\?token=|\\/)([A-Za-z0-9_-]+)`);
  let token = null;
  await waitFor(
    () => {
      const m = outbox(dataDir)
        .filter((mail) => mail.to === to && mail.sentAt > after)
        .map((mail) => re.exec(mail.text))
        .filter(Boolean)
        .at(-1);
      token = m?.[1] ?? null;
      return token !== null;
    },
    timeoutMs,
    `a ${route} link mailed to ${to}`,
  );
  return token;
}

// ---------------------------------------------------------------------------
// Real y-websocket clients
// ---------------------------------------------------------------------------
const providers = new Set();

/**
 * `prepare(doc)` runs before connecting (local "offline" content the client brings along).
 * `port`: the instance to connect to (default: the main server).
 */
function connectDoc(user, boardId, prepare, port = user.port ?? server.port) {
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
  provider.messageHandlers[WS_MESSAGE_LAYER] = () => {}; // layer updates: see withLayers()
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

/**
 * Gives a connected client the two board-layer docs ('private', 'editors'), synced over its socket
 * the way the web app does it (engine/store/BoardStore.ts): it asks for a layer with sync step 1 and
 * the server answers only if this socket may read it. `layerOp` sends a reveal/discard.
 */
function withLayers(client) {
  const layers = { private: new Y.Doc(), editors: new Y.Doc() };
  const send = (name, write) => {
    const ws = client.provider.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE_LAYER);
    encoding.writeVarString(e, name);
    write(e);
    ws.send(encoding.toUint8Array(e));
  };
  client.layerMessages = []; // wire names of every layer message received
  client.provider.messageHandlers[WS_MESSAGE_LAYER] = (encoder, decoder) => {
    const name = decoding.readVarString(decoder);
    client.layerMessages.push(name);
    const doc = layers[name];
    if (!doc) return;
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
    if (encoding.length(reply) > 0) {
      encoding.writeVarUint(encoder, WS_MESSAGE_LAYER);
      encoding.writeVarString(encoder, name);
      encoding.writeUint8Array(encoder, encoding.toUint8Array(reply));
    }
  };
  for (const [name, doc] of Object.entries(layers))
    doc.on('update', (u, origin) => origin !== 'server' && send(name, (e) => syncProtocol.writeUpdate(e, u)));
  client.layers = layers;
  client.askLayer = (name) => send(name, (e) => syncProtocol.writeSyncStep1(e, layers[name] ?? new Y.Doc()));
  client.layerOp = (op) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE_LAYER_OP);
    encoding.writeVarString(e, JSON.stringify(op));
    client.provider.ws.send(encoding.toUint8Array(e));
  };
  return client;
}

/** A client of `user` with layers, synced and having asked for both layers (`port`: instance). */
async function layerClient(user, boardId, port = server.port) {
  const c = withLayers(connectDoc(user, boardId, undefined, port));
  await c.ready();
  c.askLayer('private');
  c.askLayer('editors');
  return c;
}

/** Every value anywhere in a client's shared doc, as JSON text (to prove something never arrived). */
const sharedText = (c) => JSON.stringify(c.doc.toJSON());

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

    await check('signup mails a verification link; inviting and link-sharing are refused until it is opened; the link works once', async () => {
      const me = await A.req('GET', '/api/auth/me');
      assert(me.json.user.emailVerified === false, `fresh account verified? ${me.text}`);
      const own = (await A.req('POST', '/api/boards', { title: 'unverified' })).json.board;
      const inv = await A.req('POST', `/api/boards/${own.id}/members`, { email: B.email, role: 'viewer' });
      assert(inv.status === 403 && /verify/i.test(inv.json.error), `invite while unverified -> ${inv.status} ${inv.text}`);
      const share = await A.req('PATCH', `/api/boards/${own.id}`, { linkAccess: 'viewer' });
      assert(share.status === 403, `link sharing while unverified -> ${share.status}`);
      const token = await A.verifyEmail(dataDir);
      assert((await A.req('GET', '/api/auth/me')).json.user.emailVerified === true, 'not verified after opening the link');
      const again = await A.req('POST', '/api/auth/verify-email', { token });
      assert(again.status === 400, `reusing the verification link -> ${again.status}`);
      assert((await A.req('POST', `/api/boards/${own.id}/members`, { email: B.email, role: 'viewer' })).status === 201, 'invite after verifying');
      assert((await A.req('DELETE', `/api/boards/${own.id}`)).status === 200, 'cleanup');
      await B.verifyEmail(dataDir); // B invites as an editor below
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

    await check('A invites B as editor, C as viewer, D as commenter; an address without an account gets a pending invite', async () => {
      for (const [u, role] of [[B, 'editor'], [C, 'viewer'], [D, 'commenter']]) {
        const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role });
        assert(r.status === 201 && r.json.member.role === role && r.json.member.userId === u.id, r.text);
      }
      const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: 'ghost@nowhere.io', role: 'viewer' });
      assert(r.status === 201 && r.json.invite?.email === 'ghost@nowhere.io' && !r.json.member, r.text);
      assert((await A.req('DELETE', `/api/boards/${board.id}/invites/${r.json.invite.id}`)).status === 200, 'revoke ghost');
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

    // ---- accounts: invites, verification, password reset, sessions, profile, deletion ----
    let lateInvite = null; // aged past its expiry while the server is down (restart check below)
    await check('invite without an account: mailed link -> sign-up -> the board opens over WebSocket with the invited role; single-use; revoked grants nothing', async () => {
      const N = new User('N');
      const r = await A.req('POST', `/api/boards/${board.id}/members`, { email: N.email, role: 'commenter' });
      assert(r.status === 201 && r.json.invite?.role === 'commenter', r.text);
      const pending = await B.req('GET', `/api/boards/${board.id}/invites`);
      assert(pending.status === 200 && pending.json.invites.some((i) => i.email === N.email && i.role === 'commenter'), `editor's pending list: ${pending.text}`);
      assert((await C.req('GET', `/api/boards/${board.id}/invites`)).status === 403, 'a viewer can list pending invites');
      const token = await mailedToken(dataDir, N.email, '/invite');
      const preview = await new User('anon').req('GET', `/api/invites/${token}`);
      assert(preview.status === 200 && preview.json.invite.email === N.email && preview.json.invite.boardTitle === board.title, preview.text);
      await N.signup();
      const accepted = await N.req('POST', `/api/invites/${token}/accept`);
      assert(accepted.status === 200 && accepted.json.boardId === board.id && accepted.json.role === 'commenter', accepted.text);
      assert((await N.req('GET', '/api/auth/me')).json.user.emailVerified === true, 'following the mailed link proves the address');
      const live = connectDoc(N, board.id);
      await live.ready();
      assert(live.role === 'commenter', `socket role ${live.role}`);
      live.destroy();
      const replay = await new User('Other').req('GET', `/api/invites/${token}`);
      assert(replay.status === 404, `used link still previews: ${replay.status}`);
      assert((await N.req('POST', `/api/invites/${token}/accept`)).status === 404, 'used link accepted twice');
      assert(!(await A.req('GET', `/api/boards/${board.id}/invites`)).json.invites.some((i) => i.email === N.email), 'still pending after use');

      const X = new User('X');
      const rx = await A.req('POST', `/api/boards/${board.id}/members`, { email: X.email, role: 'editor' });
      const xToken = await mailedToken(dataDir, X.email, '/invite');
      assert((await B.req('DELETE', `/api/boards/${board.id}/invites/${rx.json.invite.id}`)).status === 404, "an editor revoked the owner's invite");
      assert((await A.req('DELETE', `/api/boards/${board.id}/invites/${rx.json.invite.id}`)).status === 200, 'owner revokes');
      await X.signup();
      assert((await X.req('POST', `/api/invites/${xToken}/accept`)).status === 404, 'revoked link accepted');
      assert((await X.req('GET', `/api/boards/${board.id}`)).status === 403, 'revoked invite granted access');

      const L = new User('Late');
      await A.req('POST', `/api/boards/${board.id}/members`, { email: L.email, role: 'editor' });
      lateInvite = { user: L, token: await mailedToken(dataDir, L.email, '/invite') };
    });

    await check('password reset: same answer for unknown and known addresses; the link works once and signs out every other session, open board sockets included', async () => {
      const P = new User('P');
      await P.signup();
      const own = (await P.req('POST', '/api/boards', { title: 'P board' })).json.board;
      const laptop = new User('P-laptop');
      assert((await laptop.req('POST', '/api/auth/login', { email: P.email, password: 'password-123' })).status === 200, 'second login');
      const live = connectDoc(laptop, own.id);
      await live.ready();
      const anon = new User('anon');
      const unknown = await anon.req('POST', '/api/auth/password/forgot', { email: `nobody-${Date.now()}@verify.freero.app` });
      const known = await anon.req('POST', '/api/auth/password/forgot', { email: P.email });
      assert(unknown.status === 200 && known.status === 200 && unknown.text === known.text, `answers differ: ${unknown.text} / ${known.text}`);
      const token = await mailedToken(dataDir, P.email, '/reset-password');
      const reset = await anon.req('POST', '/api/auth/password/reset', { token, password: 'new-password-456' });
      assert(reset.status === 200 && reset.json.user.id === P.id && anon.cookie, `reset -> ${reset.status} ${reset.text}`);
      await waitFor(() => live.closeCodes.includes(4401), 5000, "the other session's board socket to close (4401)");
      live.destroy();
      assert((await laptop.req('GET', '/api/auth/me')).status === 401 && (await P.req('GET', '/api/auth/me')).status === 401, 'old sessions survived the reset');
      assert((await anon.req('GET', '/api/auth/me')).status === 200, 'the reset did not sign in');
      assert((await anon.req('POST', '/api/auth/password/reset', { token, password: 'attacker-pass-1' })).status === 400, 'reset link reused');
      assert((await new User('t').req('POST', '/api/auth/login', { email: P.email, password: 'password-123' })).status === 401, 'old password still works');
      assert((await new User('t').req('POST', '/api/auth/login', { email: P.email, password: 'new-password-456' })).status === 200, 'new password rejected');
    });

    await check('sessions: every device listed (this one marked, address masked); signing one out closes its board socket and cookie; "sign out others" keeps this one', async () => {
      const Q = new User('Q');
      await Q.signup();
      const own = (await Q.req('POST', '/api/boards', { title: 'Q board' })).json.board;
      const firefox = new User('Q-firefox');
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
      await firefox.req('POST', '/api/auth/login', { email: Q.email, password: 'password-123' }, { headers: { 'user-agent': ua } });
      const phone = new User('Q-phone');
      await phone.req('POST', '/api/auth/login', { email: Q.email, password: 'password-123' });
      const live = connectDoc(firefox, own.id);
      await live.ready();
      const list = (await Q.req('GET', '/api/auth/sessions')).json.sessions;
      assert(list.length === 3 && list.filter((s) => s.current).length === 1, JSON.stringify(list));
      assert(list.every((s) => !s.network.includes('127.0.0.1')), `full address exposed: ${JSON.stringify(list.map((s) => s.network))}`);
      assert(list.every((s) => s.location === null), 'a location without a GeoIP database');
      const target = list.find((s) => s.userAgent === ua);
      assert(target && !target.current, 'firefox session not listed');
      assert((await Q.req('DELETE', `/api/auth/sessions/${target.id}`)).status === 200, 'revoke');
      await waitFor(() => live.closeCodes.includes(4401), 5000, "the revoked session's board socket to close (4401)");
      live.destroy();
      assert((await firefox.req('GET', '/api/auth/me')).status === 401, 'revoked cookie still works');
      assert((await new User('Stranger').req('DELETE', `/api/auth/sessions/${list.find((s) => s.current).id}`)).status === 401, 'anonymous revoke');
      const others = await Q.req('POST', '/api/auth/sessions/revoke-others');
      assert(others.status === 200 && others.json.revoked === 1, others.text);
      assert((await phone.req('GET', '/api/auth/me')).status === 401 && (await Q.req('GET', '/api/auth/me')).status === 200, 'revoke-others');
      assert((await Q.req('GET', '/api/auth/sessions')).json.sessions.length === 1, 'sessions left');
      // Changing the password also signs the other devices out (and keeps this one).
      const tablet = new User('Q-tablet');
      await tablet.req('POST', '/api/auth/login', { email: Q.email, password: 'password-123' });
      assert((await Q.req('POST', '/api/auth/password', { currentPassword: 'nope-nope', newPassword: 'password-789' })).status === 403, 'wrong current password');
      assert((await Q.req('POST', '/api/auth/password', { currentPassword: 'password-123', newPassword: 'password-789' })).status === 200, 'change');
      assert((await tablet.req('GET', '/api/auth/me')).status === 401 && (await Q.req('GET', '/api/auth/me')).status === 200, 'password change sessions');
    });

    await check('profile: an uploaded avatar is resized server-side and shows in member lists; an email change applies only through the link sent to the new address', async () => {
      const Pf = new User('Pf');
      await Pf.signup();
      await A.req('POST', `/api/boards/${board.id}/members`, { email: Pf.email, role: 'viewer' });
      const { Jimp } = await import('jimp');
      const photo = await new Jimp({ width: 900, height: 500, color: 0x2f9e44ff }).getBuffer('image/png');
      const up = await Pf.req('PUT', '/api/auth/me/avatar', photo, { raw: true, headers: { 'content-type': 'image/png' } });
      assert(up.status === 200 && up.json.user.avatarUrl?.startsWith('/uploads/'), `avatar -> ${up.status} ${up.text}`);
      const bytes = Buffer.from(await (await fetch(`http://127.0.0.1:${server.port}${up.json.user.avatarUrl}`)).arrayBuffer());
      assert(bytes.readUInt32BE(16) === 256 && bytes.readUInt32BE(20) === 256, `stored avatar is ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
      const listed = (await A.req('GET', `/api/boards/${board.id}/members`)).json.members.find((m) => m.userId === Pf.id);
      assert(listed?.avatarUrl === up.json.user.avatarUrl, 'avatar missing from the member list');
      const bad = await Pf.req('PUT', '/api/auth/me/avatar', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { raw: true, headers: { 'content-type': 'image/svg+xml' } });
      assert(bad.status === 415, `svg avatar -> ${bad.status}`);

      const next = `pf-new-${Date.now()}@verify.freero.app`;
      assert((await Pf.req('POST', '/api/auth/email', { email: next, password: 'wrong-pass' })).status === 403, 'email change without the password');
      assert((await Pf.req('POST', '/api/auth/email', { email: next, password: 'password-123' })).status === 200, 'email change request');
      assert((await Pf.req('GET', '/api/auth/me')).json.user.email === Pf.email, 'address changed before the link was opened');
      const token = await mailedToken(dataDir, next, '/confirm-email');
      assert((await new User('anon').req('POST', '/api/auth/email/confirm', { token })).status === 200, 'confirm');
      const me = (await Pf.req('GET', '/api/auth/me')).json.user;
      assert(me.email === next && me.emailVerified, JSON.stringify(me));
      assert((await new User('t').req('POST', '/api/auth/login', { email: next, password: 'password-123' })).status === 200, 'login with the new address');
      assert((await new User('t').req('POST', '/api/auth/login', { email: Pf.email, password: 'password-123' })).status === 401, 'old address still logs in');
    });

    await check('account deletion: needs the password, signs out everywhere (sockets too); during the grace period only restore works; restore brings everything back', async () => {
      const W = new User('W');
      await W.signup();
      const own = (await W.req('POST', '/api/boards', { title: 'W board' })).json.board;
      const live = connectDoc(W, own.id);
      await live.ready();
      assert((await W.req('POST', '/api/auth/account/delete', { password: 'wrong-pass' })).status === 403, 'deleted without the password');
      const del = await W.req('POST', '/api/auth/account/delete', { password: 'password-123' });
      assert(del.status === 200 && del.json.deletionScheduledFor > Date.now() + 13 * 86_400_000, del.text);
      await waitFor(() => live.closeCodes.includes(4401), 5000, 'board socket to close on deletion');
      live.destroy();
      assert((await W.req('GET', '/api/auth/me')).status === 401, 'still signed in after deletion');
      await waitFor(() => outbox(dataDir).some((m) => m.to === W.email && /deleted/i.test(m.subject)), 5000, 'the deletion notice mail');
      const login = await W.req('POST', '/api/auth/login', { email: W.email, password: 'password-123' });
      assert(login.status === 200 && login.json.user.deletionScheduledFor, `login during grace: ${login.text}`);
      const blocked = await W.req('GET', '/api/boards');
      assert(blocked.status === 403 && blocked.json.code === 'account_pending_deletion', `boards during grace -> ${blocked.status} ${blocked.text}`);
      assert((await wsCloseCode(own.id, W.cookie)) === 4401, 'board socket during grace');
      const restored = await W.req('POST', '/api/auth/account/restore');
      assert(restored.status === 200 && restored.json.user.deletionScheduledFor === null, restored.text);
      assert(titles(await W.req('GET', '/api/boards')).includes(own.id), 'board lost by restoring');
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

    const dThread = { kind: 'thread', id: 't1', x: 5, y: 5, elementId: null, createdAt: 1, createdBy: D.id };
    const dMsg = (id, authorId, text) => ({ kind: 'message', threadId: 't1', id, authorId, authorName: authorId, text, createdAt: 1 });
    await check("commenter D can write 'comments' but not 'elements'", async () => {
      d.doc.transact(() => {
        d.doc.getMap('comments').set('t:t1', dThread);
        d.doc.getMap('comments').set('m:t1:m1', dMsg('m1', D.id, 'nice!'));
      });
      await waitFor(() => a.doc.getMap('comments').get('m:t1:m1')?.text === 'nice!', 5000, "A to receive D's comment");
      els(d).set('d1', { id: 'd1', type: 'sticky', text: 'from commenter' });
      d.doc.transact(() => {
        d.doc.getMap('comments').set('s:t1', { kind: 'status', threadId: 't1', resolved: true, by: D.id, at: 2 });
        els(d).delete('e1');
      });
      await sleep(800);
      assert(!els(a).has('d1'), "commenter's element reached A");
      assert(els(a).has('e1'), "commenter's delete of e1 reached A");
      assert(!a.doc.getMap('comments').has('s:t1'), 'mixed comment+element update was accepted');
    });

    await check("comment authorship: commenter D's raw client cannot rewrite or delete A's message; D's own edits still sync", async () => {
      a.doc.getMap('comments').set('m:t1:a1', dMsg('a1', A.id, 'reply from A'));
      await waitFor(() => d.doc.getMap('comments').get('m:t1:a1')?.text === 'reply from A', 5000, "D to receive A's reply");
      // Each attempt from a fresh raw client: after one dropped update, everything later from the
      // same client would be dropped anyway (missing dependencies), which proves nothing.
      const attempts = [
        ["rewrite A's message", (c) => c.set('m:t1:a1', { ...dMsg('a1', A.id, 'A never wrote this'), editedAt: 3 })],
        ["post a message as A", (c) => c.set('m:t1:f1', dMsg('f1', A.id, "forged in A's name"))],
        ["delete A's message", (c) => c.delete('m:t1:a1')],
      ];
      for (const [what, fn] of attempts) {
        const raw = connectDoc(D, board.id);
        await raw.ready();
        fn(raw.doc.getMap('comments'));
        await sleep(600);
        raw.destroy();
        const seen = a.doc.getMap('comments');
        assert(seen.get('m:t1:a1')?.text === 'reply from A' && !seen.has('m:t1:f1'), `D could ${what}: ${JSON.stringify(seen.get('m:t1:a1'))}`);
      }
      d.destroy(); // holds the rejected writes; reconnect clean
      d = connectDoc(D, board.id);
      await d.ready();
      d.doc.getMap('comments').set('m:t1:m1', { ...dMsg('m1', D.id, 'nice!'), editedAt: 4 });
      d.doc.getMap('comments').set('r:t1:a1:' + D.id + ':🎉', { kind: 'reaction', threadId: 't1', messageId: 'a1', userId: D.id, emoji: '🎉' });
      await waitFor(() => a.doc.getMap('comments').get('m:t1:m1')?.editedAt === 4, 5000, "A to receive D's edit of D's own message");
      await waitFor(() => a.doc.getMap('comments').has('r:t1:a1:' + D.id + ':🎉'), 5000, "A to receive D's reaction");
    });

    // ---- board layers: content the server withholds (private drafts, sealed ballots, hidden frames) ----
    await check("board layers: an editor's private draft syncs to their own other tab and to nobody else (owner, editor, viewer, commenter)", async () => {
      const b1 = await layerClient(B, board.id);
      const b2 = await layerClient(B, board.id);
      const others = await Promise.all([A, C, D].map((u) => layerClient(u, board.id)));
      b1.layers.private.getMap('elements').set('draft1', { id: 'draft1', type: 'sticky', text: 'SECRET-DRAFT' });
      await waitFor(() => b2.layers.private.getMap('elements').get('draft1')?.text === 'SECRET-DRAFT', 5000, "B's other tab to get B's draft");
      await sleep(500);
      for (const o of others) {
        const everything = sharedText(o) + JSON.stringify(o.layers.private.toJSON()) + JSON.stringify(o.layers.editors.toJSON());
        assert(!everything.includes('SECRET-DRAFT'), `${o.user.label} received B's private draft`);
      }
      // Asking for "private" always means one's own layer; nobody can name someone else's.
      for (const o of others) o.askLayer(`u:${B.id}`);
      await sleep(400);
      assert(others.every((o) => !o.layerMessages.includes(`u:${B.id}`)), "someone got an answer for B's layer by its storage name");
      for (const c of [b1, b2, ...others]) c.destroy();
    });

    await check("board layers: hidden frames' contents (editors layer) sync between owner and editor, never to a viewer or commenter, who also cannot write it", async () => {
      const a1 = await layerClient(A, board.id);
      const b1 = await layerClient(B, board.id);
      const c1 = await layerClient(C, board.id);
      const d1 = await layerClient(D, board.id);
      a1.layers.editors.getMap('elements').set('hid1', { id: 'hid1', type: 'sticky', text: 'HIDDEN-CONTENT' });
      await waitFor(() => b1.layers.editors.getMap('elements').get('hid1')?.text === 'HIDDEN-CONTENT', 5000, 'B to get the hidden content');
      c1.layers.editors.getMap('elements').set('cv', { id: 'cv', type: 'sticky', text: 'viewer write' });
      d1.layers.editors.getMap('elements').set('dv', { id: 'dv', type: 'sticky', text: 'commenter write' });
      await sleep(600);
      for (const o of [c1, d1]) assert(!JSON.stringify(o.layers.editors.toJSON()).includes('HIDDEN-CONTENT') && !sharedText(o).includes('HIDDEN-CONTENT'), `${o.user.label} received hidden content`);
      const seen = a1.layers.editors.getMap('elements');
      assert(!seen.has('cv') && !seen.has('dv'), 'a viewer/commenter wrote the editors layer');
      for (const c of [a1, b1, c1, d1]) c.destroy();
    });

    await check('board layers: sealed ballots are revealed into the shared doc only by an owner/editor, while their author is offline', async () => {
      const b1 = await layerClient(B, board.id);
      b1.layers.private.getMap('voting').set(`s1:${B.id}`, { sessionId: 's1', userId: B.id, elementIds: ['e1', 'e1'] });
      b1.layers.private.getMap('voting').set(`s0:${B.id}`, { sessionId: 's0', userId: B.id, elementIds: ['e2'] });
      await sleep(400);
      b1.destroy();
      const c1 = await layerClient(C, board.id); // viewer
      const d1 = await layerClient(D, board.id); // commenter
      for (const x of [c1, d1]) x.layerOp({ type: 'reveal', collection: 'voting' });
      await sleep(600);
      assert(!c1.doc.getMap('voting').has(`s1:${B.id}`), 'a viewer/commenter revealed sealed ballots');
      const a1 = await layerClient(A, board.id);
      a1.layerOp({ type: 'reveal', collection: 'voting', prefix: 's1:' });
      await waitFor(() => c1.doc.getMap('voting').get(`s1:${B.id}`)?.elementIds?.length === 2, 5000, "the viewer to see B's revealed ballot");
      assert(!c1.doc.getMap('voting').has(`s0:${B.id}`), "a ballot of another session was revealed");
      const b2 = await layerClient(B, board.id);
      await waitFor(() => b2.layers.private.getMap('voting').has(`s0:${B.id}`), 5000, "B's other sealed ballot to still be in B's layer");
      assert(!b2.layers.private.getMap('voting').has(`s1:${B.id}`), 'the revealed ballot stayed in the private layer');
      for (const c of [a1, b2, c1, d1]) c.destroy();
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
      await withDb(dataDir, async (q) => {
        await q('UPDATE sessions SET expires_at = $1 WHERE user_id = $2', [new Date(Date.now() - 1000), S.id]);
        // ... and 15 days for the invite mailed to Late.
        if (lateInvite) await q('UPDATE board_invites SET expires_at = $1 WHERE email = $2', [new Date(Date.now() - 1000), lateInvite.user.email]);
      });
      await startServer(dataDir);
      // Cookies must survive the restart (sessions are in the database).
      const me = await A.req('GET', '/api/auth/me');
      assert(me.status === 200, `session lost across restart: ${me.status}`);
      const a2 = connectDoc(A, board.id);
      await a2.ready();
      const m = els(a2);
      assert(m.get('e1')?.text === 'from A' && m.get('e2')?.text === 'from B' && m.get('e3') && m.get('c2') && m.get('e4'), `elements after restart: ${JSON.stringify([...m.keys()])}`);
      assert(a2.doc.getMap('comments').get('m:t1:m1')?.text === 'nice!', "D's comment not persisted");
      assert(!m.has('c1') && !m.has('d1') && !a2.doc.getMap('comments').has('s:t1') && !a2.doc.getMap('comments').has('m:t1:f1') && !a2.doc.getMap('comments').has('ct'), 'rejected writes were persisted');
      a2.destroy();
      const b3 = await layerClient(B, board.id);
      await waitFor(
        () => b3.layers.private.getMap('elements').get('draft1')?.text === 'SECRET-DRAFT' && b3.layers.editors.getMap('elements').has('hid1'),
        5000,
        "B's private draft and the hidden frame content to come back after the restart",
      );
      b3.destroy();
    });

    await check('an expired invite link grants nothing (no preview, no access after signing up)', async () => {
      assert(lateInvite, 'no late invite was sent');
      const L = lateInvite.user;
      assert((await L.req('GET', `/api/invites/${lateInvite.token}`)).status === 404, 'expired invite previews');
      await L.signup();
      assert((await L.req('POST', `/api/invites/${lateInvite.token}/accept`)).status === 404, 'expired invite accepted');
      const members = (await A.req('GET', `/api/boards/${board.id}/members`)).json.members.map((m) => m.userId);
      assert(!members.includes(L.id), 'expired invite made Late a member');
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
      const cd = await layerClient(A, copy.id);
      assert(els(cd).get('e1')?.text === 'from A' && cd.doc.getMap('comments').get('m:t1:m1')?.text === 'nice!', 'copy has no content');
      // Hidden frames' contents come along for an owner/editor; nobody's private layer does.
      await waitFor(() => cd.layers.editors.getMap('elements').has('hid1'), 5000, "the owner's copy to keep the hidden frame content");
      cd.destroy();
      const rb = await B.req('POST', `/api/boards/${board.id}/duplicate`);
      assert(rb.json.board.ownerId === B.id && rb.json.board.role === 'owner', 'B copy owner');
      const bc = await layerClient(B, rb.json.board.id);
      await sleep(400);
      assert(!JSON.stringify(bc.layers.private.toJSON()).includes('SECRET-DRAFT'), "B's private draft was copied into B's duplicate");
      bc.destroy();
      assert((await C.req('GET', `/api/boards/${copy.id}`)).status === 403, "members don't carry over to copies");
      // A viewer's copy must not contain what the viewer could never read.
      const rc = await C.req('POST', `/api/boards/${board.id}/duplicate`);
      assert(rc.status === 201, rc.text);
      const cc = await layerClient(C, rc.json.board.id);
      await sleep(400);
      assert(!cc.layers.editors.getMap('elements').has('hid1'), "a viewer's duplicate contains the hidden frame content");
      cc.destroy();
    });

    // ---- version history (KAI-49) ----
    await check('version history is for editors and owners: viewer and commenter get 403, non-members too', async () => {
      assert((await B.req('GET', `/api/boards/${board.id}/versions`)).status === 200, 'editor lists');
      for (const u of [C, D]) {
        assert((await u.req('GET', `/api/boards/${board.id}/versions`)).status === 403, `${u.label} listed versions`);
        assert((await u.req('POST', `/api/boards/${board.id}/versions`, { name: 'x' })).status === 403, `${u.label} named a version`);
      }
      assert((await B.req('POST', `/api/boards/${board.id}/versions`, { name: '   ' })).status === 400, 'blank name');
    });

    await check('restore across two clients: both converge on the version, comments stay, and restoring "before" undoes it', async () => {
      const h1 = connectDoc(A, board.id);
      const h2 = connectDoc(B, board.id);
      await Promise.all([h1.ready(), h2.ready()]);
      els(h1).set('h1', { id: 'h1', type: 'sticky', text: 'in v1' });
      await waitFor(() => els(h2).get('h1')?.text === 'in v1', 5000, 'B to see h1');
      const named = await B.req('POST', `/api/boards/${board.id}/versions`, { name: 'Verify v1' });
      assert(named.status === 201 && named.json.version.kind === 'named' && named.json.version.createdBy.id === B.id, named.text);
      const v1 = named.json.version;
      // The version's content is served as raw Yjs state.
      const st = await fetch(`http://127.0.0.1:${server.port}/api/boards/${board.id}/versions/${v1.id}/state`, { headers: { cookie: B.cookie } });
      const vdoc = new Y.Doc();
      Y.applyUpdate(vdoc, new Uint8Array(await st.arrayBuffer()));
      assert(vdoc.getMap('elements').get('h1')?.text === 'in v1', 'version state lacks h1');

      // After v1: an edit, a deletion, a new item, a new comment (A and B both edit).
      els(h1).set('h1', { id: 'h1', type: 'sticky', text: 'changed after v1' });
      els(h2).set('h2', { id: 'h2', type: 'sticky', text: 'added after v1' });
      els(h2).delete('e1');
      h1.doc.getMap('comments').set('t-after', { text: 'said after v1' });
      await waitFor(() => els(h1).has('h2') && !els(h1).has('e1') && els(h2).get('h1')?.text === 'changed after v1', 5000, 'clients to converge');

      const r = await B.req('POST', `/api/boards/${board.id}/versions/${v1.id}/restore`);
      assert(r.status === 200 && r.json.before.kind === 'before-restore', r.text);
      const atV1 = (c) =>
        els(c).get('h1')?.text === 'in v1' && !els(c).has('h2') && els(c).get('e1')?.text === 'from A' && c.doc.getMap('comments').get('t-after')?.text === 'said after v1';
      await waitFor(() => atV1(h1) && atV1(h2), 5000, 'both clients to show v1 (with the later comment kept)');
      assert((await C.req('POST', `/api/boards/${board.id}/versions/${v1.id}/restore`)).status === 403, 'a viewer restored');

      const list = (await A.req('GET', `/api/boards/${board.id}/versions`)).json.versions;
      assert(list[0].id === r.json.before.id && list.some((v) => v.id === v1.id && v.name === 'Verify v1'), JSON.stringify(list.slice(0, 3)));
      const undo = await A.req('POST', `/api/boards/${board.id}/versions/${r.json.before.id}/restore`);
      assert(undo.status === 200, undo.text);
      const atNow = (c) => els(c).get('h1')?.text === 'changed after v1' && els(c).has('h2') && !els(c).has('e1');
      await waitFor(() => atNow(h1) && atNow(h2), 5000, 'both clients to be back where they were before the restore');
      // Put e1 back for the checks below (as an ordinary edit).
      els(h1).set('e1', { id: 'e1', type: 'sticky', text: 'from A' });
      await sleep(100);
      h1.destroy();
      h2.destroy();
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
      const live = await layerClient(B, board.id);
      // An edit the server has received but not saved yet (saves are debounced) when the delete lands.
      const watcher = await layerClient(A, board.id);
      els(live).set('t1', { id: 't1', type: 'sticky', text: 'just before the delete' });
      // ...and in a layer: hidden-frame content and a private draft (kept through the trash too).
      live.layers.editors.getMap('elements').set('t2', { id: 't2', type: 'sticky', text: 'hidden, just before the delete' });
      live.layers.private.getMap('elements').set('t3', { id: 't3', type: 'sticky', text: 'draft, just before the delete' });
      await waitFor(() => els(watcher).get('t1') && watcher.layers.editors.getMap('elements').get('t2'), 3000, 'the last edits to reach the server');
      await sleep(100);
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
      const backL = await layerClient(B, board.id);
      await waitFor(
        () => backL.layers.editors.getMap('elements').has('t2') && backL.layers.private.getMap('elements').has('t3'),
        5000,
        'the layers (hidden content, private draft) to survive the trash',
      );
      backL.destroy();

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
// Account purge, on its own server with no grace period and a 1 s purge interval: after deleting
// an account its boards, avatar and name go for good, while what others own stays.
// ---------------------------------------------------------------------------
async function accountPurgeChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-purge-'));
  let proc = null;
  const clients = [];
  try {
    const env = { ACCOUNT_DELETION_GRACE_DAYS: '0', ACCOUNT_PURGE_INTERVAL_SECONDS: '1' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('purge server boots (deletion grace 0, purge every second)', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    await check('a deleted account is purged: its boards and avatar go, its comments on others’ boards read "Deleted user" (live); others’ boards keep their content, images it placed included', async () => {
      const U = new User('Gone', proc.port);
      const V = new User('Stays', proc.port);
      await U.signup();
      await V.signup();
      await V.verifyEmail(dataDir);
      const own = (await U.req('POST', '/api/boards', { title: 'U board' })).json.board;
      const theirs = (await V.req('POST', '/api/boards', { title: 'V board' })).json.board;
      assert((await V.req('POST', `/api/boards/${theirs.id}/members`, { email: U.email, role: 'commenter' })).status === 201, 'invite U');
      const upload = await U.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
      assert(upload.status === 201, `upload ${upload.status}`); // an image U places on V's board
      const avatar = (await U.req('PUT', '/api/auth/me/avatar', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).json?.user?.avatarUrl;
      assert(avatar?.startsWith('/uploads/'), 'avatar upload');
      const u = connectDoc(U, theirs.id);
      const v = connectDoc(V, theirs.id);
      clients.push(u, v);
      await Promise.all([u.ready(), v.ready()]);
      const msg = (id, who) => ({ kind: 'message', threadId: 't1', id, authorId: who.id, authorName: who.name, authorColor: '#1C7ED6', text: `from ${who.name}`, createdAt: Date.now() });
      u.doc.getMap('comments').set('m:t1:u', msg('u', U));
      v.doc.getMap('comments').set('m:t1:v', msg('v', V));
      await waitFor(() => v.doc.getMap('comments').get('m:t1:u')?.authorName === U.name, 5000, "U's comment to reach V");

      assert((await U.req('POST', '/api/auth/account/delete', { password: 'password-123' })).status === 200, 'delete');
      await waitFor(async () => (await V.req('GET', `/api/boards/${own.id}`)).status === 404, 10_000, "U's board to be purged").catch((e) => {
        const logged = proc.log.join('').split(/\r?\n/).filter((l) => /error|purge|accounts/i.test(l));
        throw new CheckError(`${e.message}; server said: ${logged.slice(-10).join(' | ')}`);
      });
      await waitFor(() => v.doc.getMap('comments').get('m:t1:u')?.authorName === 'Deleted user', 5000, "V's open board to show U's comment as Deleted user");
      const comments = v.doc.getMap('comments');
      assert(comments.get('m:t1:u').text === `from ${U.name}` && comments.get('m:t1:v').authorName === V.name, JSON.stringify(comments.toJSON()));
      assert((await V.req('GET', `/api/boards/${theirs.id}`)).status === 200, "V's board survived");
      const members = (await V.req('GET', `/api/boards/${theirs.id}/members`)).json.members.map((m) => m.userId);
      assert(!members.includes(U.id), 'purged user still a member');
      assert((await fetch(`http://127.0.0.1:${proc.port}${avatar}`)).status === 404, "U's avatar still served");
      // Part of V's board now; files nothing references any more are left to the uploads sweep.
      assert((await fetch(`http://127.0.0.1:${proc.port}${upload.json.url}`)).status === 200, "an image U placed on V's board was deleted");
      const login = await new User('t', proc.port).req('POST', '/api/auth/login', { email: U.email, password: 'password-123' });
      assert(login.status === 401, `purged account can log in: ${login.status}`);
      // A fresh document load (not just the live room) has the anonymized name too.
      for (const c of clients.splice(0)) c.destroy();
      await sleep(1500); // FREERO_DOC_IDLE_MS=1000: unloaded
      const again = connectDoc(V, theirs.id);
      clients.push(again);
      await again.ready();
      assert(again.doc.getMap('comments').get('m:t1:u')?.authorName === 'Deleted user', 'anonymized name not persisted');
    });
  } finally {
    for (const c of clients) c.destroy();
    if (proc) await stopProc(proc);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Notifications, on their own server with a 5 s email delay and a 1 s digest interval: sharing a board,
// an @mention and a reply written through real Yjs sockets become notifications for the right
// people only (never in someone else's name), reach the open notifications socket live, go out
// as ONE digest email whose links open the board / thread, and the email's unsubscribe link works.
// ---------------------------------------------------------------------------
/** A raw /ws/notifications socket recording every message it gets. */
function notificationsSocket(user, port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications`, { headers: { cookie: user.cookie } });
  const s = { ws, messages: [], closeCode: null };
  ws.on('message', (d) => s.messages.push(JSON.parse(String(d))));
  ws.on('close', (code) => (s.closeCode = code));
  ws.on('error', () => {});
  s.lastUnread = () => s.messages.at(-1)?.unread ?? null;
  return s;
}

async function notificationChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-notify-'));
  let proc = null;
  const clients = [];
  const sockets = [];
  try {
    const env = { NOTIFY_EMAIL_DELAY_SECONDS: '5', NOTIFY_EMAIL_INTERVAL_SECONDS: '1' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('notifications server boots (email delay 5 s, digest every second)', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const port = proc.port;
    const A = new User('NotifyOwner', port);
    const B = new User('NotifyMember', port);
    const C = new User('NotifyBystander', port); // has access, is never mentioned
    const X = new User('NotifyOutsider', port); // no access to the board
    for (const u of [A, B, C, X]) await u.signup();
    for (const u of [A, B, C]) await u.verifyEmail(dataDir);
    const board = (await A.req('POST', '/api/boards', { title: 'Notify board' })).json.board;
    const list = async (u) => (await u.req('GET', '/api/notifications')).json;

    await check('sharing a board with an account notifies them in the app, live on their open notifications socket', async () => {
      const live = notificationsSocket(B, port);
      sockets.push(live);
      await waitFor(() => live.lastUnread() === 0, 5000, 'the first unread count on connect');
      for (const [u, role] of [[B, 'commenter'], [C, 'editor']])
        assert((await A.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role })).status === 201, `invite ${u.label}`);
      await waitFor(() => live.lastUnread() === 1, 5000, 'the live unread count to become 1');
      const [n] = (await list(B)).notifications;
      assert(n?.type === 'board.invite' && n.link === `/board/${board.id}` && n.actor?.id === A.id, JSON.stringify(n));
      assert(/comment on/.test(n.title) && n.title.includes('Notify board'), n.title);
    });

    await check('an @mention written through a board socket notifies only the mentioned member; a message written in someone else’s name notifies nobody', async () => {
      const a = connectDoc(A, board.id);
      const b = connectDoc(B, board.id);
      clients.push(a, b);
      await Promise.all([a.ready(), b.ready()]);
      const msg = (id, who, text) => ({ kind: 'message', threadId: 't1', id, authorId: who.id, authorName: who.name, authorColor: '#1C7ED6', text, createdAt: Date.now() });
      a.doc.transact(() => {
        a.doc.getMap('comments').set('t:t1', { kind: 'thread', id: 't1', x: 0, y: 0, createdAt: Date.now(), createdBy: A.id });
        a.doc.getMap('comments').set('m:t1:m1', msg('m1', A, `hey <@${B.id}> and <@${X.id}>, look`));
      });
      // A forged client of B's writing as A, mentioning C: the comment rules drop it, and nothing is
      // notified in A's name. Its own connection: a client whose update was dropped can't get later
      // updates applied either (they depend on the dropped one), and B's real tab must stay usable.
      const forged = connectDoc(B, board.id);
      clients.push(forged);
      await forged.ready();
      forged.doc.getMap('comments').set('m:t1:fake', msg('fake', A, `fake <@${C.id}>`));
      await waitFor(async () => (await list(B)).unread === 2, 5000, 'B to have the mention');
      const mention = (await list(B)).notifications.find((n) => n.type === 'comment.mention');
      assert(mention.link === `/board/${board.id}?thread=t1`, mention.link);
      assert(mention.body === `hey @${B.name} and @${X.name}, look`, mention.body);
      await sleep(500);
      assert((await list(C)).notifications.every((n) => n.type === 'board.invite'), 'C was notified by a spoofed message');
      assert((await list(X)).notifications.length === 0, 'someone without access was notified');
      assert((await list(A)).notifications.length === 0, 'the author was notified of their own message');
      assert(!a.doc.getMap('comments').has('m:t1:fake'), 'the forged message reached other clients');
      forged.destroy();
      clients.splice(clients.indexOf(forged), 1);
    });

    await check('a reply notifies the thread’s earlier writers (the author not)', async () => {
      const b = clients[1];
      b.doc.getMap('comments').set('m:t1:m2', { kind: 'message', threadId: 't1', id: 'm2', authorId: B.id, authorName: B.name, text: 'on it', createdAt: Date.now() });
      await waitFor(async () => (await list(A)).notifications.some((n) => n.type === 'comment.reply'), 5000, 'A to get the reply');
      assert((await list(B)).notifications.every((n) => n.type !== 'comment.reply'), 'B was notified of their own reply');
    });

    let digest = null;
    await check('one digest email batches the unread notifications; its links open the board and the thread', async () => {
      await waitFor(() => (digest = outbox(dataDir).find((m) => m.to === B.email && /notification/i.test(m.subject + m.text))), 15_000, 'the digest to B');
      await sleep(2500); // a couple more digest runs: nothing is sent twice
      const toB = outbox(dataDir).filter((m) => m.to === B.email && m.sentAt > 0 && !/confirm|verify/i.test(m.subject));
      assert(toB.length === 1, `mails to B: ${toB.map((m) => m.subject).join(' | ')}`);
      assert(digest.subject === '2 new notifications on Freero', digest.subject);
      const links = [...digest.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => new URL(m[0]));
      const thread = links.find((u) => u.searchParams.get('thread') === 't1');
      assert(thread?.pathname === `/board/${board.id}`, `thread link: ${thread}`);
      assert(links.some((u) => u.pathname === `/board/${board.id}` && !u.search), 'board link missing');
      // The deep link's board opens for B.
      assert((await B.req('GET', `/api/boards/${board.id}`)).status === 200, 'B cannot open the linked board');
      assert(digest.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', JSON.stringify(digest.headers));
    });

    await check('reading notifications updates the badge live; the email’s unsubscribe link (no session) turns notification emails off; a forged one is refused', async () => {
      const live = sockets[0];
      assert((await B.req('POST', '/api/notifications/read', {})).json.unread === 0, 'mark all read');
      await waitFor(() => live.lastUnread() === 0, 5000, 'the live count to drop to 0');
      const token = new URL(/https?:\/\/\S+\/unsubscribe\?token=\S+/.exec(digest.text)[0]).searchParams.get('token');
      const anon = new User('anon', port);
      assert((await anon.req('POST', `/api/notifications/unsubscribe?token=${encodeURIComponent(token.slice(0, -2) + 'xx')}`)).status === 400, 'forged token accepted');
      assert((await anon.req('POST', `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`)).status === 200, 'unsubscribe');
      assert((await B.req('GET', '/api/notifications/prefs')).json.emailAll === false, 'emails still on');
      // A new mention still shows in the app, but no email follows.
      clients[0].doc.getMap('comments').set('m:t1:m3', { kind: 'message', threadId: 't1', id: 'm3', authorId: A.id, authorName: A.name, text: `again <@${B.id}>`, createdAt: Date.now() });
      await waitFor(() => live.lastUnread() === 1, 5000, 'the new mention live');
      await sleep(7500); // past the 5 s email delay and a few digest runs
      assert(outbox(dataDir).filter((m) => m.to === B.email && /notification|mentioned/i.test(m.subject)).length === 1, 'emailed after unsubscribing');
    });

    await check('board people lookup keeps a comment author’s profile after they leave, and never answers for unrelated accounts', async () => {
      const Y = new User('NotifyStranger', port);
      await Y.signup();
      assert((await A.req('DELETE', `/api/boards/${board.id}/members/${B.id}`)).status === 200, 'remove B');
      const r = await A.req('GET', `/api/boards/${board.id}/people?ids=${B.id},${Y.id}`);
      assert(r.status === 200, `people: ${r.status}`);
      const ids = r.json.people.map((p) => p.id);
      assert(ids.includes(B.id) && !ids.includes(Y.id), JSON.stringify(r.json));
      assert((await Y.req('GET', `/api/boards/${board.id}/people?ids=${B.id}`)).status === 403, 'a non-member could look people up');
    });

    await check('logging out closes that session’s notifications socket', async () => {
      const live = sockets[0];
      await B.req('POST', '/api/auth/logout');
      await waitFor(() => live.closeCode === 4401, 5000, 'the socket to close with 4401');
    });
  } finally {
    for (const s of sockets) s.ws.terminate();
    for (const c of clients) c.destroy();
    if (proc) await stopProc(proc);
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
  // Rate-limit counters live in the shared Redis, also across the single-instance run above.
  const env = () => ({ DATABASE_URL: url, REDIS_URL, RATE_LIMIT_SIGNUP: '200/1h' });
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
      await A.verifyEmail(path.join(dataDir, 'i0')); // inviting needs a verified address
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

    await check('duplicating through instance 2 right after an edit on instance 1 copies the edit not saved yet (KAI-73)', async () => {
      const src = (await A.req('POST', '/api/boards', { title: 'Dup source' })).json.board;
      const w = connectDoc(A, src.id, undefined, one);
      await w.ready();
      els(w).set('d1', { id: 'd1', type: 'sticky', text: 'unsaved on instance 1' });
      await sleep(100);
      const r = await A.req('POST', `/api/boards/${src.id}/duplicate`, undefined, { port: two });
      assert(r.status === 201, r.text);
      assert((await docRows(src.id)) === 0, 'the edit was already saved, so this proves nothing');
      const copy = connectDoc(A, r.json.board.id, undefined, two);
      await copy.ready();
      assert(els(copy).get('d1')?.text === 'unsaved on instance 1', 'the copy lacks the edit');
      copy.destroy();
      w.destroy();
    });

    await check('moving a board to the trash through instance 2 keeps an edit instance 1 had not saved yet', async () => {
      const t = (await A.req('POST', '/api/boards', { title: 'Trash source' })).json.board;
      const w = connectDoc(A, t.id, undefined, one);
      await w.ready();
      els(w).set('t1', { id: 't1', type: 'sticky', text: 'unsaved before trash' });
      await sleep(100);
      assert((await A.req('DELETE', `/api/boards/${t.id}`, undefined, { port: two })).status === 200, 'trash');
      await waitFor(() => w.closeCodes.includes(4403), 5000, 'the socket on instance 1 to close');
      w.destroy();
      const back = await A.req('POST', `/api/boards/${t.id}/restore`, undefined, { port: two });
      assert(back.status === 200, back.text);
      const r = connectDoc(A, t.id, undefined, two);
      await r.ready();
      assert(els(r).get('t1')?.text === 'unsaved before trash', 'the edit was lost in the trash round trip');
      r.destroy();
    });

    await check('restoring a version through an instance that does not hold the board reaches clients on both instances; its "before" has their unsaved edits', async () => {
      const vb = (await A.req('POST', '/api/boards', { title: 'Versions' })).json.board;
      assert((await A.req('POST', `/api/boards/${vb.id}/members`, { email: B.email, role: 'editor' })).status === 201, 'invite');
      const w = connectDoc(A, vb.id, undefined, one);
      await w.ready();
      els(w).set('r1', { id: 'r1', type: 'sticky', text: 'v1' });
      await sleep(100);
      const v1 = (await A.req('POST', `/api/boards/${vb.id}/versions`, { name: 'v1' }, { port: one })).json.version;
      assert(v1?.kind === 'named', 'name v1');
      els(w).set('r1', { id: 'r1', type: 'sticky', text: 'v2, not saved yet' });
      await sleep(100);
      assert((await docRows(vb.id)) <= 1, 'v2 already saved: this proves less');
      const restored = await B.req('POST', `/api/boards/${vb.id}/versions/${v1.id}/restore`, undefined, { port: two });
      assert(restored.status === 200, restored.text);
      await waitFor(() => els(w).get('r1')?.text === 'v1', 5000, 'the client on instance 1 to see v1');
      const x = connectDoc(B, vb.id, undefined, two);
      await x.ready();
      assert(els(x).get('r1')?.text === 'v1', 'a client on instance 2 sees v1');
      const undo = await B.req('POST', `/api/boards/${vb.id}/versions/${restored.json.before.id}/restore`, undefined, { port: one });
      assert(undo.status === 200, undo.text);
      const atV2 = (c) => els(c).get('r1')?.text === 'v2, not saved yet';
      await waitFor(() => atV2(w) && atV2(x), 5000, 'both clients back at v2 (the unsaved edit was in "before")');
      w.destroy();
      x.destroy();
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

    // ---- board layers across instances ----
    const layerRows = async (boardId, layer) =>
      (
        await adminQuery(
          `SELECT (SELECT count(*) FROM board_layers WHERE board_id = '${boardId}' AND layer = '${layer}')
                + (SELECT count(*) FROM board_layer_updates WHERE board_id = '${boardId}' AND layer = '${layer}') AS n`,
          url,
        )
      )[0].n * 1;
    const V = new User('MV'); // viewer
    const R = new User('MR'); // editor, removed later
    await check('board layers across instances: a private draft reaches only its author (other tab on the other instance); hidden-frame content reaches owner and editor on both, never a viewer', async () => {
      for (const u of [V, R]) await u.signup();
      for (const [u, role] of [[V, 'viewer'], [R, 'editor']])
        assert((await A.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role })).status === 201, 'invite');
      const b1 = await layerClient(B, board.id, one);
      const b2 = await layerClient(B, board.id, two);
      const a2 = await layerClient(A, board.id, two);
      const v1 = await layerClient(V, board.id, one);
      const v2 = await layerClient(V, board.id, two);
      b1.layers.private.getMap('elements').set('mdraft', { id: 'mdraft', type: 'sticky', text: 'MULTI-DRAFT' });
      a2.layers.editors.getMap('elements').set('mhid', { id: 'mhid', type: 'sticky', text: 'MULTI-HIDDEN' });
      await waitFor(() => b2.layers.private.getMap('elements').get('mdraft')?.text === 'MULTI-DRAFT', 5000, "B's tab on instance 2 to get B's draft");
      await waitFor(() => b1.layers.editors.getMap('elements').get('mhid')?.text === 'MULTI-HIDDEN', 5000, 'B on instance 1 to get the hidden content');
      await sleep(500);
      for (const o of [a2, v1, v2]) {
        const all = sharedText(o) + JSON.stringify(o.layers.private.toJSON()) + JSON.stringify(o.layers.editors.toJSON());
        assert(!all.includes('MULTI-DRAFT'), `${o.user.label} got B's private draft`);
        if (o.user === V) assert(!all.includes('MULTI-HIDDEN'), 'the viewer got hidden-frame content');
      }
      for (const c of [b1, b2, a2, v1, v2]) c.destroy();
    });

    await check('board layers across instances: opening the board on instance 2 right after a private edit on instance 1 gets it before it is saved', async () => {
      const fresh = (await A.req('POST', '/api/boards', { title: 'Layer catch-up' })).json.board;
      const w = await layerClient(A, fresh.id, one);
      w.layers.private.getMap('elements').set('early', { id: 'early', type: 'sticky', text: 'unsaved draft' });
      await sleep(100); // reached instance 1; its save waits ~1.5 s (debounce)
      const r = await layerClient(A, fresh.id, two); // instance 2 loads the board from the database
      await waitFor(() => r.layers.private.getMap('elements').get('early')?.text === 'unsaved draft', 2000, 'the other tab on instance 2 to get the unsaved draft');
      assert((await layerRows(fresh.id, `u:${A.id}`)) === 0, 'the draft was already saved, so this proves nothing about fan-out');
      w.destroy();
      r.destroy();
    });

    await check("reveal across instances: the owner reveals through instance 2 while the authors' drafts were made on instance 1 (one author offline, one removed from the board); an edit racing the reveal is never lost", async () => {
      const b1 = await layerClient(B, board.id, one);
      const r1 = await layerClient(R, board.id, one);
      b1.layers.private.getMap('elements').set('rv', { id: 'rv', type: 'sticky', text: 'v1' });
      b1.layers.private.getMap('elements').set('off', { id: 'off', type: 'sticky', text: 'author offline' });
      r1.layers.private.getMap('elements').set('rm', { id: 'rm', type: 'sticky', text: 'REMOVED-MEMBER-DRAFT' });
      await sleep(500);
      r1.destroy();
      assert((await A.req('DELETE', `/api/boards/${board.id}/members/${R.id}`)).status === 200, 'remove R');
      const a2 = await layerClient(A, board.id, two);
      const v1 = await layerClient(V, board.id, one);
      // B keeps typing in the draft at the very moment the owner reveals.
      a2.layerOp({ type: 'reveal', collection: 'elements' });
      b1.layers.private.getMap('elements').set('rv', { id: 'rv', type: 'sticky', text: 'v2' });
      await waitFor(() => els(v1).get('off')?.text === 'author offline' && els(v1).has('rv'), 5000, 'the viewer on instance 1 to see the revealed drafts');
      await sleep(800);
      const shared = els(v1).get('rv')?.text;
      const stillPrivate = b1.layers.private.getMap('elements').get('rv')?.text;
      assert(shared === 'v2' || stillPrivate === 'v2', `the racing edit was lost (shared ${shared}, private ${stillPrivate})`);
      assert(!sharedText(v1).includes('REMOVED-MEMBER-DRAFT') && !sharedText(a2).includes('REMOVED-MEMBER-DRAFT'), "a removed member's draft was revealed");
      for (const c of [b1, a2, v1]) c.destroy();
    });

    await check('signing a session out from another device through instance 2 closes its socket on instance 1 (4401)', async () => {
      const Q = new User('MQ');
      await Q.signup();
      const own = (await Q.req('POST', '/api/boards', { title: 'Q' })).json.board;
      const laptop = new User('MQ-laptop');
      assert((await laptop.req('POST', '/api/auth/login', { email: Q.email, password: 'password-123' })).status === 200, 'second login');
      const live = connectDoc(laptop, own.id, undefined, one);
      await live.ready();
      const target = (await Q.req('GET', '/api/auth/sessions', undefined, { port: two })).json.sessions.find((x) => !x.current);
      assert((await Q.req('DELETE', `/api/auth/sessions/${target.id}`, undefined, { port: two })).status === 200, 'revoke');
      await waitFor(() => live.closeCodes.includes(4401), 5000, "the revoked session's socket on instance 1 to close with 4401");
      live.destroy();
      assert((await laptop.req('GET', '/api/auth/me', undefined, { port: one })).status === 401, 'revoked cookie still works on instance 1');
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
      // Layers too: the removed member's private layer is gone; B's (holding the off-board draft
      // racing the reveal, if it stayed private) and the editors layer are kept.
      await waitFor(async () => (await layerRows(board.id, `u:${R.id}`)) === 0, 10_000, "the removed member's private layer to be deleted");
      const bl = await layerClient(B, board.id, two);
      await waitFor(() => bl.layers.editors.getMap('elements').get('mhid')?.text === 'MULTI-HIDDEN', 5000, 'the hidden content saved once across instances to reload');
      bl.destroy();
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

// ---------------------------------------------------------------------------
// Sign-in methods: a provider (OpenID Connect against a local test provider, the real client
// library end to end: discovery, PKCE, state, nonce, signed id tokens), two-factor, GeoIP.
// ---------------------------------------------------------------------------

/** A browser: cookie jar for the app (every cookie, not just the session), manual redirects. */
class Browser {
  constructor(port) {
    this.port = port;
    this.origin = `http://127.0.0.1:${port}`;
    this.jar = new Map();
  }
  async fetch(url, { method = 'GET', body, headers = {} } = {}) {
    const abs = new URL(url, this.origin);
    const own = abs.origin === this.origin;
    const h = { ...headers };
    if (own && this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(abs, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    if (own) {
      for (const c of res.headers.getSetCookie()) {
        const m = /^([^=]+)=([^;]*)/.exec(c);
        if (!m) continue;
        if (!m[2] || /expires=thu, 01 jan 1970/i.test(c)) this.jar.delete(m[1]);
        else this.jar.set(m[1], m[2]);
      }
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, location: res.headers.get('location'), json, text, url: abs.href };
  }
  /** Follows redirects (app -> provider -> app) until a page of the app; returns its path + query. */
  async navigate(url) {
    let next = new URL(url, this.origin).href;
    for (let i = 0; i < 10; i++) {
      const r = await this.fetch(next);
      if (r.status !== 302 && r.status !== 303) throw new CheckError(`${next} -> ${r.status} ${r.text.slice(0, 200)}`);
      const loc = new URL(r.location, next);
      if (loc.origin === this.origin && !loc.pathname.startsWith('/api/')) return loc.pathname + loc.search;
      next = loc.href;
    }
    throw new CheckError(`too many redirects from ${url}`);
  }
}

async function signInMethodChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-signin-'));
  const geoDb = path.join(dataDir, 'test-city.mmdb');
  writeMmdb(geoDb, [
    { cidr: '203.0.113.0/24', data: { city: { names: { en: 'Lyon' } }, country: { iso_code: 'FR', names: { en: 'France' } } } },
    { cidr: '198.51.100.0/24', data: { country: { iso_code: 'JP', names: { en: 'Japan' } } } },
  ]);
  const idp = await startMockOidc({ clientId: 'freero-verify', clientSecret: 'verify-secret' });
  let proc = null;
  try {
    const env = {
      OIDC_GOOGLE_CLIENT_ID: 'freero-verify',
      OIDC_GOOGLE_CLIENT_SECRET: 'verify-secret',
      OIDC_GOOGLE_ISSUER: idp.issuer,
      GEOIP_DB_PATH: geoDb,
      TRUST_PROXY: 'loopback', // so X-Forwarded-For can stand in for clients on the internet
      RATE_LIMIT_TWO_FACTOR: '200/15m', // every check here comes from 127.0.0.1
      // Same, and with REDIS_URL every server of the run shares the per-IP counters: the main
      // session's resets have used up the default 5/15m before the reset check here runs.
      RATE_LIMIT_PASSWORD: '200/15m',
    };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('sign-in server boots with a provider (local test OpenID provider) and a GeoIP database', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
      const providers = (await new Browser(proc.port).fetch('/api/auth/providers')).json.providers;
      assert(providers.length === 1 && providers[0].id === 'google', JSON.stringify(providers));
    });
    if (!ok) return;
    const port = proc.port;
    const stamp = Date.now();
    const address = (label) => `${label}-${stamp}@signin.verify.freero.app`;
    const twoFactorOn = async (u) => {
      const setup = await u.req('POST', '/api/auth/two-factor/setup', { password: 'password-123' });
      assert(setup.status === 200 && setup.json.qr.startsWith('data:image/png;base64,') && setup.json.uri.startsWith('otpauth://totp/'), setup.text);
      const enable = await u.req('POST', '/api/auth/two-factor/enable', { code: await totpCode({ secret: setup.json.secret }) });
      assert(enable.status === 200 && enable.json.recoveryCodes.length === 10, enable.text);
      return { secret: setup.json.secret, recoveryCodes: enable.json.recoveryCodes };
    };
    // The enrolment code's time step is used up: the next sign-in takes the next step's code.
    const nextCode = (secret) => totpCode({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });

    let passwordless = null; // { browser, email }
    await check('a provider sign-in with a verified address creates a passwordless account (authorization code + PKCE end to end); signing in again reaches the same account', async () => {
      const email = address('olga');
      const b = new Browser(port);
      idp.queueSignIn({ email, name: 'Olga Provider' });
      const landed = await b.navigate('/api/auth/oidc/google/start?next=%2Fboard%2Fabc');
      assert(landed === '/board/abc', `landed on ${landed}`);
      const me = await b.fetch('/api/auth/me');
      assert(me.status === 200 && me.json.user.email === email && me.json.user.emailVerified && me.json.user.name === 'Olga Provider', me.text);
      const sec = (await b.fetch('/api/auth/security')).json;
      assert(sec.hasPassword === false && sec.identities.length === 1 && sec.identities[0].providerLabel === 'Google', JSON.stringify(sec));
      const again = new Browser(port);
      idp.queueSignIn({ email });
      assert((await again.navigate('/api/auth/oidc/google/start')) === '/app', 'second sign-in landing');
      assert((await again.fetch('/api/auth/me')).json.user.id === me.json.user.id, 'a second account was created');
      const sessions = (await again.fetch('/api/auth/sessions')).json.sessions;
      assert(sessions.length === 2 && sessions.every((s) => s.method === 'google' && s.methodLabel === 'Google' && !s.twoFactor), JSON.stringify(sessions));
      passwordless = { browser: b, email };
    });

    await check("a provider callback is bound to the browser that started it (another browser can't complete it: login CSRF), and works once", async () => {
      const victim = new Browser(port);
      const start = await victim.fetch('/api/auth/oidc/google/start');
      assert(start.status === 302 && start.location.startsWith(idp.issuer), start.text);
      const authorize = new URL(start.location);
      assert(authorize.searchParams.get('code_challenge_method') === 'S256' && authorize.searchParams.get('nonce'), 'PKCE / nonce missing');
      idp.queueSignIn({ email: address('csrf') });
      const callback = (await victim.fetch(start.location)).location;
      const attacker = new Browser(port);
      const forged = await attacker.fetch(callback);
      assert(forged.status === 302 && forged.location === '/login?error=failed' && !attacker.jar.has('freero_session'), `forged: ${forged.status} ${forged.location}`);
      const real = await victim.fetch(callback);
      assert(real.status === 302 && real.location === '/app' && victim.jar.has('freero_session'), `real: ${real.status} ${real.location}`);
      const replay = await new Browser(port).fetch(callback);
      assert(replay.location === '/login?error=failed', `replayed callback: ${replay.location}`);
    });

    let P = null;
    let pTotp = null;
    await check("a provider reaches an existing account only if it vouches for the address, and only after that account's second step (connected only then)", async () => {
      P = new User('SigninP', port);
      P.email = address('pat');
      await P.signup();
      // Verified: an unverified account would be taken over by the provider-verified owner instead.
      await P.verifyEmail(dataDir);
      pTotp = await twoFactorOn(P);
      const unvouched = new Browser(port);
      idp.queueSignIn({ email: P.email, emailVerified: false });
      assert((await unvouched.navigate('/api/auth/oidc/google/start')) === '/login?error=email_in_use', 'unverified address matched an account');
      assert((await unvouched.fetch('/api/auth/me')).status === 401, 'signed in without a vouched address');

      const b = new Browser(port);
      idp.queueSignIn({ email: P.email });
      const landed = await b.navigate('/api/auth/oidc/google/start?next=%2Fsettings');
      assert(landed === '/login/two-factor?next=%2Fsettings', `landed on ${landed}`);
      assert((await b.fetch('/api/auth/me')).status === 401, 'signed in before the second step');
      assert((await P.req('GET', '/api/auth/security')).json.identities.length === 0, 'connected before the second step');
      assert((await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: '000000' } })).status === 403, 'wrong code');
      const done = await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: pTotp.recoveryCodes[0] } });
      assert(done.status === 200 && done.json.user.id === P.id, done.text);
      assert((await P.req('GET', '/api/auth/security')).json.identities.length === 1, 'not connected after the second step');
      const viaGoogle = (await P.req('GET', '/api/auth/sessions')).json.sessions.find((s) => s.method === 'google');
      assert(viaGoogle?.twoFactor === true, 'session not marked as two-factor');
      assert((await P.req('GET', '/api/auth/security')).json.twoFactor.recoveryCodesLeft === 9, 'recovery code not used up');
    });

    await check('password sign-in with two-factor on: no session before the second step; 5 wrong codes end the attempt; a reset link does not skip it', async () => {
      const b = new Browser(port);
      const login = await b.fetch('/api/auth/login', { method: 'POST', body: { email: P.email, password: 'password-123' } });
      assert(login.status === 200 && login.json.twoFactorRequired === true && !b.jar.has('freero_session'), login.text);
      for (let i = 0; i < 5; i++) assert((await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: '111111' } })).status === 403, `wrong code ${i}`);
      const capped = await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: await nextCode(pTotp.secret) } });
      assert(capped.status === 401 && !b.jar.has('freero_session'), `after 5 wrong codes: ${capped.status}`);
      await b.fetch('/api/auth/login', { method: 'POST', body: { email: P.email, password: 'password-123' } });
      const ok2 = await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: await nextCode(pTotp.secret) } });
      assert(ok2.status === 200 && b.jar.has('freero_session'), ok2.text);

      const after = Date.now();
      const forgot = await new Browser(port).fetch('/api/auth/password/forgot', { method: 'POST', body: { email: P.email } });
      assert(forgot.status === 200, `forgot: ${forgot.status} ${forgot.text}`);
      const token = await mailedToken(dataDir, P.email, '/reset-password', { after });
      const r = new Browser(port);
      const reset = await r.fetch('/api/auth/password/reset', { method: 'POST', body: { token, password: 'password-456' } });
      assert(reset.status === 200 && reset.json.twoFactorRequired === true && !r.jar.has('freero_session'), `reset: ${reset.text}`);
      const rec = await r.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: pTotp.recoveryCodes[1] } });
      assert(rec.status === 200 && (await r.fetch('/api/auth/sessions')).json.sessions.find((s) => s.current)?.method === 'email_link', rec.text);
    });

    await check('a passwordless account keeps a way in: its last provider can not be disconnected until it sets a password', async () => {
      const { browser: b, email } = passwordless;
      const sec = (await b.fetch('/api/auth/security')).json;
      const last = await b.fetch(`/api/auth/identities/${sec.identities[0].id}`, { method: 'DELETE' });
      assert(last.status === 409, `disconnected the last way in: ${last.status}`);
      // Signed in moments ago: that stands in for the (missing) current password.
      assert((await b.fetch('/api/auth/password', { method: 'POST', body: { newPassword: 'first-password-1' } })).status === 200, 'set a password');
      const gone = await b.fetch(`/api/auth/identities/${sec.identities[0].id}`, { method: 'DELETE' });
      assert(gone.status === 200 && gone.json.hasPassword && gone.json.identities.length === 0, gone.text);
      assert((await new Browser(port).fetch('/api/auth/login', { method: 'POST', body: { email, password: 'first-password-1' } })).status === 200, 'password login');
    });

    await check('sessions show "City, Country" from the GeoIP database; addresses it does not know keep the masked network', async () => {
      const G = new User('Geo', port);
      G.email = address('geo');
      const fwd = (ip) => ({ headers: { 'x-forwarded-for': ip } });
      const s = await G.req('POST', '/api/auth/signup', { name: 'Geo', email: G.email, password: 'password-123' }, fwd('203.0.113.9'));
      assert(s.status === 201, s.text);
      await new User('Geo-jp', port).req('POST', '/api/auth/login', { email: G.email, password: 'password-123' }, fwd('198.51.100.7'));
      await new User('Geo-home', port).req('POST', '/api/auth/login', { email: G.email, password: 'password-123' });
      const list = (await G.req('GET', '/api/auth/sessions')).json.sessions;
      const where = list.map((x) => x.location ?? x.network).sort();
      assert(JSON.stringify(where) === JSON.stringify(['Japan', 'Lyon, France', 'This computer']), JSON.stringify(list));
    });
  } finally {
    if (proc) await stopProc(proc);
    await idp.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Uploads mark-and-sweep (KAI-74), on its own server: files are shared between boards, copies,
// templates and avatars, so only what nothing references any more may be deleted.
// ---------------------------------------------------------------------------
async function uploadSweepChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-sweep-'));
  const outerDbUrl = db.url;
  try {
    if (ADMIN_URL) db.url = await createDatabase();
    if (!(await check('uploads sweep: server boots', () => startServer(dataDir)))) return;
    const U = new User('Sweeper');
    await U.signup();
    const files = {};
    const fileStatus = async (url) => (await fetch(`http://127.0.0.1:${server.port}${url}`, { redirect: 'manual' })).status;
    const board = async (title) => (await U.req('POST', '/api/boards', { title })).json.board.id;
    const place = async (boardId, url) => {
      const c = connectDoc(U, boardId);
      await c.ready();
      els(c).set('img', { id: 'img', type: 'image', x: 0, y: 0, w: 10, h: 10, src: url });
      await sleep(200);
      c.destroy(); // the last client leaving saves the doc right away
    };

    await check('uploads sweep: images on a live, a trashed, a purged and a copied board, in a template, as an avatar, and one never used', async () => {
      for (const k of ['live', 'trashed', 'purged', 'copied', 'template', 'avatar', 'unused']) {
        const r = await U.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
        assert(r.status === 201, `upload ${k} -> ${r.status}`);
        files[k] = r.json.url;
      }
      await place(await board('Live'), files.live);
      const trashed = await board('Trashed');
      await place(trashed, files.trashed);
      assert((await U.req('DELETE', `/api/boards/${trashed}`)).status === 200, 'trash');
      const purged = await board('Purged');
      await place(purged, files.purged);
      assert((await U.req('DELETE', `/api/boards/${purged}`)).status === 200, 'trash before purge');
      assert((await U.req('DELETE', `/api/boards/${purged}/permanent`)).status === 200, 'delete forever');
      // A duplicate shares the image URL; deleting the original for good must not break the copy.
      const original = await board('Original');
      await place(original, files.copied);
      assert([200, 201].includes((await U.req('POST', `/api/boards/${original}/duplicate`)).status), 'duplicate');
      assert((await U.req('DELETE', `/api/boards/${original}`)).status === 200, 'trash original');
      assert((await U.req('DELETE', `/api/boards/${original}/permanent`)).status === 200, 'delete original forever');
      const content = { elements: [{ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: files.template }] };
      assert((await U.req('POST', '/api/templates', { name: 'With image', content })).status === 201, 'save template');
      assert((await U.req('PATCH', '/api/auth/me', { avatarUrl: files.avatar })).status === 200, 'set avatar');
    });

    await check('uploads sweep: after the grace period only unreferenced files are deleted (files and quota), on startup', async () => {
      await sleep(500);
      await stopServer();
      // Simulate three days passing (a round may already have marked some): age the uploads in the
      // server's own database.
      await withDb(dataDir, (q) =>
        q(`UPDATE uploads SET created_at = created_at - interval '3 days', last_referenced_at = last_referenced_at - interval '3 days'`),
      );
      await startServer(dataDir); // a sweep round runs shortly after startup
      await waitFor(async () => (await fileStatus(files.unused)) === 404, 15_000, 'the unused upload to be swept');
      await waitFor(async () => (await fileStatus(files.purged)) === 404, 15_000, 'the purged board image to be swept');
      for (const k of ['live', 'trashed', 'copied', 'template', 'avatar'])
        assert((await fileStatus(files[k])) === 200, `${k} image was deleted although it is still used`);
      await stopServer();
      const rows = await withDb(dataDir, (q) => q('SELECT name FROM uploads'));
      const kept = ['live', 'trashed', 'copied', 'template', 'avatar'].map((k) => files[k].slice('/uploads/'.length)).sort();
      assert(isDeepStrictEqual(rows.map((r) => r.name).sort(), kept), `quota rows left: ${JSON.stringify(rows)}`);
    });
  } finally {
    closeAllDocs();
    await stopServer();
    await dropDatabases();
    db.url = outerDbUrl;
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

const started = Date.now();
await run().catch((e) => record('verify harness', false, e?.stack ?? String(e)));
await signInMethodChecks().catch((e) => record('sign-in methods harness', false, e?.stack ?? String(e)));
await uploadSweepChecks().catch((e) => record('uploads sweep checks harness', false, e?.stack ?? String(e)));
await accountPurgeChecks().catch((e) => record('account purge harness', false, e?.stack ?? String(e)));
await notificationChecks().catch((e) => record('notifications harness', false, e?.stack ?? String(e)));
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
