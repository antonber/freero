#!/usr/bin/env node
// Real-session end-to-end check for the Freero server. Run: `npm run verify`.
// (Workspaces: a team's boards are reachable only by its members or by people invited to that
// board itself — listing, opening and the socket — plus roles, projects, policies and transfers.)
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
//
// S3: with S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (e.g. MinIO or
// SeaweedFS in Docker), the `s3` group checks the S3 storage backend; without them it is skipped.

import { execSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
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
import { startMockModel } from './lib/mock-model.mjs';
import { startMockOidc } from './lib/mock-oidc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGE_AWARENESS = 1; // y-websocket
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
// Every server of the run exposes /metrics with this token, so checks can wait on its gauges.
const RUN_METRICS_TOKEN = randomBytes(16).toString('hex');
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
      // Every check signs up and logs in from 127.0.0.1; with REDIS_URL all servers of a run share the
      // counters, so one suite's logins (two-step recovery logs in dozens of times) would push the
      // next suites over the default. The login limit itself is checked by platformChecks (own counters).
      RATE_LIMIT_SIGNUP: '1000/1h',
      RATE_LIMIT_LOGIN: '1000/5m',
      SESSION_SECRET: RUN_SECRET,
      METRICS_TOKEN: RUN_METRICS_TOKEN,
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

/** A gauge of `proc`'s /metrics (servers of this run share RUN_METRICS_TOKEN). */
async function gauge(proc, name) {
  const res = await fetch(`http://127.0.0.1:${proc.port}/metrics`, { headers: { authorization: `Bearer ${RUN_METRICS_TOKEN}` } });
  const m = new RegExp(`^${name} (\\S+)$`, 'm').exec(await res.text());
  if (!m) throw new Error(`/metrics has no ${name}`);
  return Number(m[1]);
}

/**
 * Resolves once `proc` holds no board document in memory: every room saved what it had and
 * unloaded (FREERO_DOC_IDLE_MS=1000 after its last socket left). The next socket loads from the
 * database, so a check reading after this proves persistence, not the live room.
 */
async function waitUnloaded(proc = server, timeoutMs = 10_000) {
  await waitFor(async () => (await gauge(proc, 'freero_realtime_loaded_docs')) === 0, timeoutMs, `every board on :${proc.port} to be saved and unloaded`);
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
// S3 (KAI-203): with S3_ENDPOINT, S3_BUCKET and keys set, the `s3` group runs against that endpoint;
// every other server of the run keeps to the local disk, so the S3_* variables leave process.env.
const S3_ENV = (() => {
  const vars = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('S3_')).map((k) => [k, process.env[k]]));
  for (const k of Object.keys(vars)) delete process.env[k];
  return vars.S3_ENDPOINT && vars.S3_BUCKET && vars.S3_ACCESS_KEY_ID && vars.S3_SECRET_ACCESS_KEY ? vars : null;
})();
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
      // A visitor without an account (KAI-43): the guest cookie is their only one.
      const g = /^freero_guest=([^;]*)/.exec(c);
      if (g) this.cookie = g[1] ? `freero_guest=${g[1]}` : '';
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
const outboxFiles = (dataDir) => {
  const dir = path.join(dataDir, 'outbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

/** Every mail in the outbox, oldest first (`file`: its name). One still being written is skipped this time. */
function outbox(dataDir) {
  return outboxFiles(dataDir)
    .flatMap((file) => {
      try {
        return [{ ...JSON.parse(fs.readFileSync(path.join(dataDir, 'outbox', file), 'utf8')), file }];
      } catch {
        return []; // not completely written yet: the next poll reads it
      }
    })
    .sort((a, b) => a.sentAt - b.sentAt);
}

/**
 * The outbox as it is now; `mailedToken(…, { since })` then waits for mail that came after. Not a
 * timestamp: the server stamps `sentAt` with its own clock, which can be a few ms behind this
 * process's (Windows), so "sent after Date.now()" missed mail sent right after it.
 */
const outboxMark = (dataDir) => new Set(outboxFiles(dataDir));

/** The token of the newest `route` link (e.g. '/reset-password', '/invite') mailed to `to`, waiting for it. */
async function mailedToken(dataDir, to, route, { since = null, timeoutMs = 8000 } = {}) {
  const re = new RegExp(`${route.replace(/[/]/g, '\\/')}(?:\\?token=|\\/)([A-Za-z0-9_-]+)`);
  let token = null;
  await waitFor(
    () => {
      const m = outbox(dataDir)
        .filter((mail) => mail.to === to && !since?.has(mail.file))
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
  const client = { user, doc, provider, role: null, closeCodes: [], echoedBarrier: 0 };
  // Notes the server's echo of this client's own presence (see settled()).
  const onAwareness = provider.messageHandlers[MESSAGE_AWARENESS];
  provider.messageHandlers[MESSAGE_AWARENESS] = (encoder, decoder, ...rest) => {
    const update = decoding.createDecoder(decoding.readVarUint8Array(decoding.createDecoder(decoder.arr.subarray(decoder.pos))));
    for (let i = decoding.readVarUint(update); i > 0; i--) {
      const id = decoding.readVarUint(update);
      decoding.readVarUint(update); // clock
      const state = JSON.parse(decoding.readVarString(update));
      if (id === doc.clientID && state?.barrier) client.echoedBarrier = state.barrier;
    }
    return onAwareness(encoder, decoder, ...rest);
  };
  provider.messageHandlers[WS_MESSAGE_ROLE] = (_encoder, decoder) => {
    const msg = JSON.parse(decoding.readVarString(decoder));
    if (msg.type === 'role') {
      client.role = msg.role;
      client.limits = msg.limits ?? null; // a facilitator's limits (KAI-129)
    }
  };
  provider.on('connection-close', (event) => event && client.closeCodes.push(event.code));
  provider.messageHandlers[WS_MESSAGE_LAYER] = () => {}; // layer updates: see withLayers()
  provider.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: '#1C7ED6' });
  provider.connect();
  client.ready = () => waitFor(() => provider.synced && client.role !== null, 8000, `${user.label} to sync`);
  client.destroy = () => {
    if (!providers.has(client)) return;
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

let barriers = 0;
/**
 * Resolves once the server has handled everything `client` sent so far, `client` has received
 * everything the server sent it meanwhile, and so has every client in `observers`. The barrier is
 * a presence change: the server handles one socket's messages in order, relays them (and what
 * they caused) to every socket in order, other instances included, and echoes presence to its
 * sender too. Use it to prove that something did NOT happen (a rejected write never arrived)
 * instead of sleeping for a while and hoping that was long enough.
 */
async function settled(client, observers = []) {
  const n = ++barriers;
  client.provider.awareness.setLocalStateField('barrier', n);
  await waitFor(() => client.echoedBarrier === n, 5000, `the server to echo ${client.user.label}'s barrier`);
  for (const o of observers)
    await waitFor(() => o.provider.awareness.getStates().get(client.doc.clientID)?.barrier === n, 5000, `${o.user.label} to see ${client.user.label}'s barrier`);
}

/** Every value anywhere in a client's shared doc, as JSON text (to prove something never arrived). */
const sharedText = (c) => JSON.stringify(c.doc.toJSON());

function closeAllDocs() {
  for (const c of [...providers]) c.destroy();
}

/** Opens a raw socket and resolves with the close code the server uses (`port`: default the main server). */
function wsCloseCode(boardId, cookie, port = server?.port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/boards/${boardId}`, {
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
          // Sign-in also sets the device cookie (security notices): pick the session one.
          const cookie = r.headers.getSetCookie().map((c) => /^freero_session=[^;]*/.exec(c)?.[0]).find(Boolean);
          assert(cookie, `no session cookie: ${r.headers.getSetCookie().join(' | ')}`);
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
      await settled(c, [a, b]); // C's writes were handled before its barrier reached A and B
      assert(!els(a).has('c1') && !els(b).has('c1'), 'viewer element leaked to A/B');
      assert(!a.doc.getMap('comments').has('ct'), 'viewer comment leaked to A');
    });

    const dThread = { kind: 'thread', id: 't1', x: 5, y: 5, elementId: null, createdAt: 1, createdBy: D.id };
    // Messages carry their author's name: a commenter's must be their own (KAI-187).
    const dMsg = (id, authorId, text) => ({ kind: 'message', threadId: 't1', id, authorId, authorName: [A, D].find((u) => u.id === authorId)?.name ?? authorId, text, createdAt: 1 });
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
      await settled(d, [a]);
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
        await settled(raw, [a]);
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

    await check("comment authorship (KAI-187): commenter D's raw client cannot post under another name (a member's, a made-up one, a guest's), but can under a name D just took", async () => {
      const own = (id, authorName) => ({ ...dMsg(id, D.id, `as ${authorName}`), authorName });
      const attempts = [
        ["A's name", own('n1', A.name)],
        ['a made-up title', own('n2', 'Jane Doe (CEO)')],
        ["a guest's name", own('n3', 'Guest · Kim')],
      ];
      for (const [what, m] of attempts) {
        const raw = connectDoc(D, board.id); // fresh: a dropped update would sink everything after it
        await raw.ready();
        raw.doc.getMap('comments').set(`m:t1:${m.id}`, m);
        await settled(raw, [a]);
        raw.destroy();
        assert(!a.doc.getMap('comments').has(`m:t1:${m.id}`), `D could comment under ${what}`);
      }
      // A rename reaches D's open socket before the answer: the next comment under it is accepted.
      const raw = connectDoc(D, board.id);
      await raw.ready();
      const renamed = await D.req('PATCH', '/api/auth/me', { name: 'Dee Renamed' });
      assert(renamed.status === 200, `rename: ${renamed.status}`);
      raw.doc.getMap('comments').set('m:t1:n4', own('n4', 'Dee Renamed'));
      await waitFor(() => a.doc.getMap('comments').has('m:t1:n4'), 5000, "A to receive D's comment under D's new name");
      raw.destroy();
      // A tab loaded before that rename (on another device) still writes the old name, even after
      // its socket reconnects: its comments must not be dropped.
      const stale = connectDoc(D, board.id);
      await stale.ready();
      stale.doc.getMap('comments').set('m:t1:n5', own('n5', D.name));
      await waitFor(() => a.doc.getMap('comments').has('m:t1:n5'), 5000, "A to receive D's comment under D's previous name");
      stale.destroy();
      assert((await D.req('PATCH', '/api/auth/me', { name: 'Guest · Dee' })).status === 400, 'an account took a guest-style name');
      assert((await D.req('PATCH', '/api/auth/me', { name: D.name })).status === 200, 'rename back');
    });

    // ---- board layers: content the server withholds (private drafts, sealed ballots, hidden frames) ----
    await check("board layers: an editor's private draft syncs to their own other tab and to nobody else (owner, editor, viewer, commenter)", async () => {
      const b1 = await layerClient(B, board.id);
      const b2 = await layerClient(B, board.id);
      const others = await Promise.all([A, C, D].map((u) => layerClient(u, board.id)));
      b1.layers.private.getMap('elements').set('draft1', { id: 'draft1', type: 'sticky', text: 'SECRET-DRAFT' });
      await waitFor(() => b2.layers.private.getMap('elements').get('draft1')?.text === 'SECRET-DRAFT', 5000, "B's other tab to get B's draft");
      await settled(b1, others);
      for (const o of others) {
        const everything = sharedText(o) + JSON.stringify(o.layers.private.toJSON()) + JSON.stringify(o.layers.editors.toJSON());
        assert(!everything.includes('SECRET-DRAFT'), `${o.user.label} received B's private draft`);
      }
      // Asking for "private" always means one's own layer; nobody can name someone else's.
      for (const o of others) o.askLayer(`u:${B.id}`);
      for (const o of others) await settled(o); // an answer would have arrived before the echo
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
      await settled(a1, [c1, d1]);
      await settled(c1, [a1]);
      await settled(d1, [a1]);
      for (const o of [c1, d1]) assert(!JSON.stringify(o.layers.editors.toJSON()).includes('HIDDEN-CONTENT') && !sharedText(o).includes('HIDDEN-CONTENT'), `${o.user.label} received hidden content`);
      const seen = a1.layers.editors.getMap('elements');
      assert(!seen.has('cv') && !seen.has('dv'), 'a viewer/commenter wrote the editors layer');
      for (const c of [a1, b1, c1, d1]) c.destroy();
    });

    // ---- element content follows its element (KAI-230): table cells of a hidden / private table ----
    /** Every update a raw socket received, shared doc and layers (to prove text NEVER arrived, not just that it is gone). */
    const rawBytes = (c) => {
      const seen = [];
      for (const d of [c.doc, c.layers.private, c.layers.editors]) d.on('update', (u) => seen.push(Buffer.from(u)));
      return (text) => seen.some((b) => b.includes(Buffer.from(text)));
    };
    const tableEl = (id) => ({ id, type: 'table', x: 4000, y: 4000, w: 120, h: 40, z: 1, rotation: 0, rows: [{ id: 'r1', h: 40 }], cols: [{ id: 'c1', w: 120 }], header: false, fontSize: 14 });
    await check("element content: a hidden table's cell written into the shared doc (a client that hadn't seen the move) reaches owners/editors only; viewers' sockets and outlines never get it", async () => {
      const a1 = await layerClient(A, board.id);
      const b1 = await layerClient(B, board.id);
      const c1 = await layerClient(C, board.id);
      const d1 = await layerClient(D, board.id);
      const got = [c1, d1].map(rawBytes);
      a1.layers.editors.getMap('elements').set('ht1', tableEl('ht1'));
      await waitFor(() => b1.layers.editors.getMap('elements').has('ht1'), 5000, 'B to get the hidden table');
      a1.doc.getMap('tableCells').set('t:ht1:r1:c1', 'HIDDEN-CELL');
      await waitFor(() => b1.layers.editors.getMap('tableCells').get('t:ht1:r1:c1') === 'HIDDEN-CELL', 5000, "B to get the hidden table's cell in the editors layer");
      await waitFor(() => !a1.doc.getMap('tableCells').has('t:ht1:r1:c1'), 5000, "the writer's shared doc to be corrected");
      await settled(a1, [c1, d1]);
      assert(!got.some((has) => has('HIDDEN-CELL')), "a viewer/commenter socket received the hidden table's cell");
      assert(!b1.doc.getMap('tableCells').has('t:ht1:r1:c1'), "the hidden table's cell is in the shared doc");
      const outline = async (u) => (await u.req('GET', `/api/boards/${board.id}/outline?format=markdown`)).text;
      for (const u of [C, D]) assert(!(await outline(u)).includes('HIDDEN-CELL'), `${u.label}'s outline holds the hidden table's cell`);
      assert((await outline(A)).includes('HIDDEN-CELL'), "the owner's outline lacks the hidden table's cell");
      // Shown again (moved back to the shared doc, cells and all, as the web app does): everyone reads it.
      a1.doc.transact(() => {
        a1.doc.getMap('elements').set('ht1', tableEl('ht1'));
        a1.doc.getMap('tableCells').set('t:ht1:r1:c1', 'HIDDEN-CELL');
      });
      a1.layers.editors.transact(() => {
        a1.layers.editors.getMap('elements').delete('ht1');
        a1.layers.editors.getMap('tableCells').delete('t:ht1:r1:c1');
      });
      await waitFor(() => c1.doc.getMap('tableCells').get('t:ht1:r1:c1') === 'HIDDEN-CELL', 5000, 'the viewer to read the cell once the table is shared');
      a1.doc.transact(() => {
        a1.doc.getMap('elements').delete('ht1');
        a1.doc.getMap('tableCells').delete('t:ht1:r1:c1');
      });
      for (const c of [a1, b1, c1, d1]) c.destroy();
    });

    await check("element content: a private table's cells reach nobody else until an owner/editor reveals the draft, and then come with it", async () => {
      const b1 = await layerClient(B, board.id);
      const others = await Promise.all([A, C, D].map((u) => layerClient(u, board.id)));
      const got = others.map(rawBytes);
      b1.layers.private.transact(() => {
        b1.layers.private.getMap('elements').set('pt1', tableEl('pt1'));
        b1.layers.private.getMap('tableCells').set('t:pt1:r1:c1', 'PRIVATE-CELL');
      });
      // A stale tab of B writing the cell into the shared doc: it goes to B's private layer.
      b1.doc.getMap('tableCells').set('f:pt1:r1:c1', '#PRIVATE-FILL');
      await waitFor(() => b1.layers.private.getMap('tableCells').get('f:pt1:r1:c1') === '#PRIVATE-FILL', 5000, "B's misplaced fill to land in B's private layer");
      await settled(b1, others);
      assert(!got.some((has) => has('PRIVATE-CELL') || has('#PRIVATE-FILL')), "someone else's socket received B's private table cells");
      // Cells are never revealed on their own: they follow their table.
      others[0].layerOp({ type: 'reveal', collection: 'tableCells' });
      await settled(others[0], [others[1]]);
      assert(!got.some((has) => has('PRIVATE-CELL')), 'a reveal of tableCells alone revealed a private table');
      others[0].layerOp({ type: 'reveal', collection: 'elements', prefix: 'pt1' });
      await waitFor(() => others[1].doc.getMap('tableCells').get('t:pt1:r1:c1') === 'PRIVATE-CELL' && others[1].doc.getMap('elements').has('pt1'), 5000, 'the viewer to get the revealed table with its cells');
      await waitFor(() => !b1.layers.private.getMap('tableCells').has('t:pt1:r1:c1'), 5000, "the revealed cells to leave B's private layer");
      others[0].doc.transact(() => {
        others[0].doc.getMap('elements').delete('pt1');
        for (const k of ['t:pt1:r1:c1', 'f:pt1:r1:c1']) others[0].doc.getMap('tableCells').delete(k);
      });
      for (const c of [b1, ...others]) c.destroy();
    });

    await check('board layers: sealed ballots are revealed into the shared doc only by an owner/editor, while their author is offline', async () => {
      const b1 = await layerClient(B, board.id);
      // A ballot is only taken for the running session (votingRules.ts): B votes in s0, then in s1.
      const vote = (id) => ({ id, active: true, title: 'Vote', votesPerUser: 3, elementIds: null, anonymous: true, startedBy: B.id, startedAt: Date.now(), endedAt: null });
      b1.doc.getMap('voting').set('session', vote('s0'));
      b1.layers.private.getMap('voting').set(`s0:${B.id}`, { sessionId: 's0', userId: B.id, elementIds: ['e2'] });
      b1.doc.getMap('voting').set('session', vote('s1'));
      b1.layers.private.getMap('voting').set(`s1:${B.id}`, { sessionId: 's1', userId: B.id, elementIds: ['e1', 'e1'] });
      await settled(b1); // the server has both ballots
      assert(b1.layers.private.getMap('voting').size === 2, `the server undid a ballot: ${JSON.stringify(b1.layers.private.toJSON())}`);
      b1.destroy();
      const c1 = await layerClient(C, board.id); // viewer
      const d1 = await layerClient(D, board.id); // commenter
      for (const x of [c1, d1]) x.layerOp({ type: 'reveal', collection: 'voting' });
      // A socket's messages after a reveal wait until it is applied, so an accepted one would show first.
      for (const x of [c1, d1]) await settled(x);
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

    // ---- semantic read model (KAI-166) + layout from structure (KAI-167), over REST ----
    await check("board outline: each role reads the board as it sees it — never another user's draft, hidden content only for owners/editors", async () => {
      const md = async (u) => {
        const r = await u.req('GET', `/api/boards/${board.id}/outline?format=markdown`);
        assert(r.status === 200, `${u.label}: ${r.status} ${r.text}`);
        return r.text;
      };
      for (const u of [C, D]) {
        const t = await md(u);
        assert(!t.includes('HIDDEN-CONTENT') && !t.includes('SECRET-DRAFT'), `${u.label}'s outline holds withheld content`);
      }
      const a = await md(A);
      assert(a.includes('HIDDEN-CONTENT') && !a.includes('SECRET-DRAFT'), "the owner's outline: hidden content yes, B's draft no");
      assert((await md(B)).includes('SECRET-DRAFT'), 'B does not see their own draft in the outline');
      const json = await C.req('GET', `/api/boards/${board.id}/outline`);
      assert(json.status === 200 && json.json.outline.outlineVersion === 1 && /^W\/"/.test(json.headers.get('etag') ?? ''), json.text);
    });

    await check('insert structure: an editor lays a Mermaid flowchart into the live board (one change everyone sees, read back through the outline); viewers may not', async () => {
      const watcher = connectDoc(A, board.id);
      await watcher.ready();
      const source = 'flowchart TD\n  plan[VERIFY-Plan] -->|go| build{VERIFY-Build ok?}\n  build -->|yes| ship([VERIFY-Ship])\n  build -->|no| plan';
      const denied = await C.req('POST', `/api/boards/${board.id}/insert-structure`, { structure: { kind: 'mermaid', source } });
      assert(denied.status === 403, `a viewer inserted structure: ${denied.status}`);
      const bad = await B.req('POST', `/api/boards/${board.id}/insert-structure`, { structure: { kind: 'mermaid', source: 'flowchart TD\n  a ~~> b{' } });
      assert(bad.status === 400 && /line 2/.test(bad.json?.error ?? ''), `malformed Mermaid: ${bad.status} ${bad.text}`);
      const r = await B.req('POST', `/api/boards/${board.id}/insert-structure`, { structure: { kind: 'mermaid', source } });
      assert(r.status === 201 && r.json.created.length === 6, `${r.status} ${r.text}`);
      await waitFor(() => r.json.created.every((id) => els(watcher).has(id)), 5000, 'the owner to see the inserted diagram');
      assert(r.json.created.every((id) => els(watcher).get(id).createdBy === B.id), 'not attributed to the editor who inserted it');
      const o = await C.req('GET', `/api/boards/${board.id}/outline`);
      const outline = o.json.outline;
      const shapes = JSON.stringify(outline.items);
      assert(['VERIFY-Plan', 'VERIFY-Build ok?', 'VERIFY-Ship'].every((t) => shapes.includes(t)), 'the viewer does not read the inserted shapes');
      const ids = new Set(r.json.created);
      const edges = outline.edges.filter((e) => ids.has(e.id));
      assert(edges.length === 3 && edges.every((e) => ids.has(e.from) && ids.has(e.to)), `inserted edges: ${JSON.stringify(edges)}`);
      watcher.destroy();
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
      await waitUnloaded(); // saved; then a hard kill
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
      await waitUnloaded(); // the doc is loaded again by the sockets below, all at once
      const clients = [A, B, A].map((u, i) =>
        connectDoc(u, board.id, (doc) => doc.getMap('elements').set(`off${i}`, { id: `off${i}`, type: 'sticky', text: `offline ${i}` })),
      );
      await Promise.all(clients.map((c) => c.ready()));
      for (const c of clients) {
        await waitFor(() => els(c).get('e1')?.text === 'from A' && [0, 1, 2].every((i) => els(c).has(`off${i}`)), 5000, `${c.user.label} to have the stored content and every offline edit`);
      }
      for (const c of clients) c.destroy();
      await waitUnloaded(); // read back from the database, not the live room
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
        await settled(g); // reached the server, but well inside the 1.5s save debounce
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
      await settled(bc); // its layers were answered before the echo
      assert(!JSON.stringify(bc.layers.private.toJSON()).includes('SECRET-DRAFT'), "B's private draft was copied into B's duplicate");
      bc.destroy();
      assert((await C.req('GET', `/api/boards/${copy.id}`)).status === 403, "members don't carry over to copies");
      // A viewer's copy must not contain what the viewer could never read.
      const rc = await C.req('POST', `/api/boards/${board.id}/duplicate`);
      assert(rc.status === 201, rc.text);
      const cc = await layerClient(C, rc.json.board.id);
      await settled(cc);
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
      await settled(h1);
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
      await settled(live); // the private draft t3 too
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

    // ---- workspaces (KAI-37/38/39/41/42) ----
    const WO = new User('WO'); // team owner
    const WM = new User('WM'); // member
    const WM2 = new User('WM2'); // member, later a board owner
    const WX = new User('WX'); // outsider
    const WN = new User('WN'); // invited by email before having an account → guest
    let team = null;
    let tb = null; // a team board
    await check('workspaces: everyone gets a personal workspace; a team workspace is created with its creator as owner', async () => {
      for (const u of [WO, WM, WM2, WX]) await u.signup();
      await WO.verifyEmail(dataDir);
      const mine = await WO.req('GET', '/api/workspaces');
      assert(mine.status === 200 && mine.json.workspaces[0]?.kind === 'personal' && mine.json.workspaces[0].role === 'owner', mine.text);
      const created = await WO.req('POST', '/api/workspaces', { name: 'Acme' });
      assert(created.status === 201 && created.json.workspace.role === 'owner' && created.json.workspace.kind === 'team', created.text);
      team = created.json.workspace;
      const b = await WO.req('POST', '/api/boards', { title: 'Team plan', workspaceId: team.id });
      assert(b.status === 201 && b.json.board.workspaceId === team.id, b.text);
      tb = b.json.board;
      // A board created without a workspace lands in the personal one.
      const p = await WO.req('POST', '/api/boards', { title: 'Mine' });
      assert(p.json.board.workspaceId === mine.json.workspaces[0].id, 'default workspace');
    });
    if (!team || !tb) return;

    await check('workspaces: a non-member can’t list, open or join the socket of a team board — until invited to that board directly', async () => {
      assert((await WX.req('GET', `/api/boards?workspace=${team.id}`)).status === 404, 'listing a workspace you are not in');
      for (const f of ['all', 'shared', 'recent', 'starred'])
        assert(!titles(await WX.req('GET', `/api/boards?filter=${f}`)).includes(tb.id), `listed in ${f}`);
      assert((await WX.req('GET', `/api/boards/${tb.id}`)).status === 403, 'opened');
      assert((await wsCloseCode(tb.id, WX.cookie)) === 4403, 'socket joined');
      const inv = await WO.req('POST', `/api/boards/${tb.id}/members`, { email: WX.email, role: 'commenter' });
      assert(inv.status === 201, inv.text);
      const direct = (await WX.req('GET', `/api/boards/${tb.id}`)).json?.board;
      assert(direct?.role === 'commenter' && direct.member === true, `direct invite not honoured: ${JSON.stringify(direct)}`);
      const c = connectDoc(WX, tb.id);
      await c.ready();
      assert(c.role === 'commenter', `socket role ${c.role}`);
      c.destroy();
      assert(titles(await WX.req('GET', '/api/boards?filter=shared')).includes(tb.id), 'not in "shared with me"');
      assert((await WX.req('GET', `/api/boards?workspace=${team.id}`)).status === 404, 'a board invite opened the whole workspace');
    });

    await check('workspace members: existing accounts join at once, others by an emailed invite (as guest); members see team boards, guests only theirs', async () => {
      const m = await WO.req('POST', `/api/workspaces/${team.id}/members`, { email: WM.email, role: 'member' });
      assert(m.status === 201 && m.json.member?.role === 'member', m.text);
      assert((await WO.req('POST', `/api/workspaces/${team.id}/members`, { email: WM2.email, role: 'member' })).status === 201, 'WM2');
      assert(titles(await WM.req('GET', `/api/boards?workspace=${team.id}`)).includes(tb.id), 'member does not see the team board');
      const viaTeam = (await WM.req('GET', `/api/boards/${tb.id}`)).json?.board;
      // Team access is not a board membership: nothing to "leave" on the board itself (KAI-94).
      assert(viaTeam?.role === 'editor' && viaTeam.member === false, `member is not a team editor: ${JSON.stringify(viaTeam)}`);
      // Pickers (mentions, assignees) and comment author names know team members too.
      const listed = (await WO.req('GET', `/api/boards/${tb.id}/members`)).json.members.find((m) => m.userId === WM.id);
      assert(listed?.team === true && listed.role === 'editor', `team member not in the member list: ${JSON.stringify(listed)}`);
      const people = (await WO.req('GET', `/api/boards/${tb.id}/people?ids=${WM.id}`)).json.people;
      assert(people.some((p) => p.id === WM.id), 'people lookup does not know a team member');
      const g = await WO.req('POST', `/api/workspaces/${team.id}/members`, { email: WN.email, role: 'guest' });
      assert(g.status === 201 && g.json.invite?.email === WN.email.toLowerCase(), g.text);
      await WN.signup();
      const token = await mailedToken(dataDir, WN.email.toLowerCase(), '/workspace-invite');
      assert((await WN.req('GET', `/api/workspace-invites/${token}`)).json?.invite?.workspaceName === 'Acme', 'preview');
      const acc = await WN.req('POST', `/api/workspace-invites/${token}/accept`);
      assert(acc.status === 200 && acc.json.workspaceId === team.id, acc.text);
      assert((await WN.req('POST', `/api/workspace-invites/${token}/accept`)).status === 404, 'invite link used twice');
      const wsList = (await WN.req('GET', '/api/workspaces')).json.workspaces;
      assert(wsList.some((w) => w.id === team.id && w.role === 'guest'), JSON.stringify(wsList));
      assert(!titles(await WN.req('GET', `/api/boards?workspace=${team.id}`)).includes(tb.id), 'guest sees a team board');
      assert((await WN.req('GET', `/api/boards/${tb.id}`)).status === 403, 'guest opens a team board');
      assert((await WN.req('POST', '/api/boards', { title: 'x', workspaceId: team.id })).status === 403, 'guest creates a board in the team');
      // Roles: members can't manage; the only owner can't step down.
      assert((await WM.req('PATCH', `/api/workspaces/${team.id}/members/${WM2.id}`, { role: 'admin' })).status === 403, 'member changed a role');
      assert((await WO.req('PATCH', `/api/workspaces/${team.id}/members/${WO.id}`, { role: 'admin' })).status === 409, 'last owner stepped down');
      assert((await WO.req('DELETE', `/api/workspaces/${team.id}/members/${WO.id}`)).status === 409, 'last owner left');
    });

    await check('projects: a private project hides its boards from members outside it; only owners/admins move boards; a non-empty project can’t be deleted', async () => {
      const p = await WO.req('POST', `/api/workspaces/${team.id}/projects`, { name: 'Secret', access: 'private' });
      assert(p.status === 201, p.text);
      const pid = p.json.project.id;
      const moved = await WO.req('PATCH', `/api/boards/${tb.id}`, { projectId: pid });
      assert(moved.status === 200 && moved.json.board.projectId === pid, moved.text);
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).status === 403, 'member outside the private project opens its board');
      assert((await WM.req('GET', `/api/boards/${tb.id}/versions`)).status === 403, 'member outside the private project reads its version history');
      assert(!(await WM.req('GET', `/api/workspaces/${team.id}/projects`)).json.projects.some((x) => x.id === pid), 'member lists the private project');
      assert((await WO.req('PUT', `/api/projects/${pid}/members/${WM.id}`)).status === 200, 'add to project');
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).json?.board?.role === 'editor', 'project member can’t open');
      // Version history is for editors: team access counts like any other editor access.
      assert((await WM.req('GET', `/api/boards/${tb.id}/versions`)).status === 200, 'team editor can’t read version history');
      assert(titles(await WM.req('GET', `/api/boards?workspace=${team.id}&project=${pid}`)).includes(tb.id), 'project filter');
      assert((await WM.req('PATCH', `/api/boards/${tb.id}`, { projectId: null })).status === 403, 'a non-owner member moved the board');
      assert((await WO.req('DELETE', `/api/projects/${pid}`)).status === 409, 'deleted a project with boards');
      assert((await WO.req('PATCH', `/api/boards/${tb.id}`, { projectId: null, description: 'Q4 goals' })).json?.board?.description === 'Q4 goals', 'move out + describe');
      assert((await WO.req('DELETE', `/api/projects/${pid}`)).status === 200, 'empty project delete');
    });

    await check('sharing policies: link role capped, outside sharing switched off (live outsiders cut), downloads limited, live embeds off — all on the server', async () => {
      const pol = (policies) => WO.req('PATCH', `/api/workspaces/${team.id}`, { policies });
      assert((await WM.req('PATCH', `/api/workspaces/${team.id}`, { policies: { linkSharing: 'none' } })).status === 403, 'member changed policies');
      assert((await pol({ linkSharing: 'viewer' })).status === 200, 'set link max');
      assert((await WO.req('PATCH', `/api/boards/${tb.id}`, { linkAccess: 'editor' })).status === 403, 'link above the maximum');
      const okLink = await WO.req('PATCH', `/api/boards/${tb.id}`, { linkAccess: 'viewer' });
      assert(okLink.status === 200 && okLink.json.board.permissions.maxLinkAccess === 'viewer', okLink.text);
      // The outsider invited directly is connected when outside sharing is switched off.
      const live = connectDoc(WX, tb.id);
      await live.ready();
      assert((await pol({ externalSharing: 'none' })).status === 200, 'set external none');
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'the outsider’s socket to close');
      live.destroy();
      assert((await WX.req('GET', `/api/boards/${tb.id}`)).status === 403, 'outsider still opens it');
      assert((await WO.req('POST', `/api/boards/${tb.id}/members`, { email: 'nobody-yet@verify.freero.app', role: 'viewer' })).status === 403, 'invited an outsider');
      assert((await pol({ externalSharing: 'anyone', downloads: 'admins' })).status === 200, 'set downloads');
      assert((await WM.req('POST', `/api/boards/${tb.id}/duplicate`)).status === 403, 'member duplicated despite the policy');
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).json.board.permissions.canExport === false, 'UI not told');
      assert((await WO.req('POST', `/api/boards/${tb.id}/duplicate`)).status === 201, 'owner duplicate');
      // Live embeds (KAI-127): the board tells its people when the workspace turned them off.
      assert((await pol({ liveEmbeds: 'sometimes' })).status === 400, 'an unknown live-embeds value was accepted');
      assert((await pol({ liveEmbeds: 'off' })).status === 200, 'set live embeds off');
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).json.board.permissions.liveEmbeds === false, 'the board still offers live embeds');
      assert((await pol({ downloads: 'anyone', linkSharing: 'editor', liveEmbeds: 'on' })).status === 200, 'reset');
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).json.board.permissions.liveEmbeds === true, 'live embeds not back on');
      assert((await WO.req('PATCH', `/api/boards/${tb.id}`, { linkAccess: 'none' })).status === 200, 'link off again');
    });

    await check('transfer: a team board to a member (previous owner keeps editing), the workspace to another owner (previous one becomes admin)', async () => {
      const t = await WO.req('POST', `/api/boards/${tb.id}/transfer`, { userId: WM2.id });
      assert(t.status === 200 && t.json.board.ownerId === WM2.id, t.text);
      assert((await WM2.req('GET', `/api/boards/${tb.id}`)).json.board.role === 'owner', 'new owner');
      assert((await WO.req('GET', `/api/boards/${tb.id}`)).json.board.role === 'editor', 'previous owner lost access');
      assert((await WO.req('POST', `/api/boards/${tb.id}/transfer`, { userId: WN.id })).status === 400, 'a guest got a team board');
      const w = await WO.req('POST', `/api/workspaces/${team.id}/transfer`, { userId: WM2.id });
      assert(w.status === 200 && w.json.workspace.role === 'admin', w.text);
      assert((await WM2.req('GET', '/api/workspaces')).json.workspaces.find((x) => x.id === team.id)?.role === 'owner', 'new workspace owner');
    });

    await check('removing a member cuts their live socket on the team’s boards at once (4403) and they no longer list it', async () => {
      const live = connectDoc(WM, tb.id);
      await live.ready();
      const r = await WM2.req('DELETE', `/api/workspaces/${team.id}/members/${WM.id}`);
      assert(r.status === 200, r.text);
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'the removed member’s socket to close');
      live.destroy();
      assert((await WM.req('GET', `/api/boards/${tb.id}`)).status === 403, 'removed member opens the board');
      assert((await WM.req('GET', `/api/boards?workspace=${team.id}`)).status === 404, 'removed member lists the workspace');
    });

    await check('workspace templates: shared with the team, listed for members, not for outsiders', async () => {
      const content = { elements: [{ id: 's1', type: 'sticky', x: 0, y: 0, w: 100, h: 100 }] };
      const t = await WM2.req('POST', '/api/templates', { name: 'Team retro', content, workspaceId: team.id, boardId: tb.id });
      assert(t.status === 201 && t.json.template.workspaceId === team.id, t.text);
      assert((await WO.req('GET', '/api/templates')).json.templates.some((x) => x.id === t.json.template.id), 'member does not see it');
      assert(!(await WX.req('GET', '/api/templates')).json.templates.some((x) => x.id === t.json.template.id), 'outsider sees it');
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
      // Others see the new name live, before the purge has saved it, deleted the avatar and the
      // account; its last step (the account row, memberships cascading) is what to wait for.
      await waitFor(async () => !(await V.req('GET', `/api/boards/${theirs.id}/members`)).json.members.some((m) => m.userId === U.id), 10_000, 'the purge to finish (U no longer a member)');
      const comments = v.doc.getMap('comments');
      assert(comments.get('m:t1:u').text === `from ${U.name}` && comments.get('m:t1:v').authorName === V.name, JSON.stringify(comments.toJSON()));
      assert((await V.req('GET', `/api/boards/${theirs.id}`)).status === 200, "V's board survived");
      assert((await fetch(`http://127.0.0.1:${proc.port}${avatar}`)).status === 404, "U's avatar still served");
      // Part of V's board now; files nothing references any more are left to the uploads sweep.
      assert((await fetch(`http://127.0.0.1:${proc.port}${upload.json.url}`)).status === 200, "an image U placed on V's board was deleted");
      const login = await new User('t', proc.port).req('POST', '/api/auth/login', { email: U.email, password: 'password-123' });
      assert(login.status === 401, `purged account can log in: ${login.status}`);
      // A fresh document load (not just the live room) has the anonymized name too.
      for (const c of clients.splice(0)) c.destroy();
      await waitUnloaded(proc);
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
    // Conditions to wait on instead of fixed sleeps (KAI-173), from the server's /metrics.
    const handled = () => gauge(proc, 'freero_notifications_comment_messages_handled_total');
    const digestRuns = () => gauge(proc, 'freero_notifications_digest_runs_total');
    /** Resolves after `n` more complete digest runs (each one considered everything due when it started). */
    const moreDigestRuns = async (n, what) => {
      const start = await digestRuns();
      await waitFor(async () => (await digestRuns()) >= start + n + 1, 15_000, what); // +1: one may be mid-run now
    };

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
      await settled(forged, [a]); // the server has handled (and dropped) the forged message
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

    await check('a comment naming the address of someone invited without an account becomes their mention once they join (through the invite link, or by verifying that address)', async () => {
      const Z = new User('NotifyInvitee', port); // joins through the invite link
      const W = new User('NotifyVerifier', port); // joins by verifying the invited address
      for (const u of [Z, W])
        assert((await A.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role: 'commenter' })).json?.invite, `invite ${u.label}`);
      const now = Date.now();
      const before = await handled();
      clients[0].doc.transact(() => {
        const m = clients[0].doc.getMap('comments');
        m.set('t:t2', { kind: 'thread', id: 't2', x: 50, y: 50, createdAt: now, createdBy: A.id });
        m.set('m:t2:z1', { kind: 'message', threadId: 't2', id: 'z1', authorId: A.id, authorName: A.name, text: `welcome ${Z.email.toUpperCase()} and ${W.email}.`, createdAt: now });
      });
      // The server records the pending mentions as it handles the message: wait until it has.
      await waitFor(async () => (await handled()) > before, 10_000, 'the server to handle the message naming the invited addresses');
      await Z.signup();
      const token = await mailedToken(dataDir, Z.email, '/invite');
      assert((await Z.req('POST', `/api/invites/${token}/accept`)).status === 200, 'accept the invite');
      await W.signup();
      await W.verifyEmail(dataDir);
      for (const u of [Z, W]) {
        await waitFor(async () => (await list(u)).notifications.length > 0, 5000, `${u.label}'s mention`);
        const all = (await list(u)).notifications;
        assert(all.length === 1, `${u.label}: ${JSON.stringify(all)}`);
        assert(all[0].type === 'comment.mention' && all[0].link === `/board/${board.id}?thread=t2` && all[0].actor?.id === A.id, JSON.stringify(all[0]));
      }
    });

    let digest = null;
    await check('one digest email batches the unread notifications; its links open the board and the thread', async () => {
      await waitFor(() => (digest = outbox(dataDir).find((m) => m.to === B.email && /notification/i.test(m.subject + m.text))), 15_000, 'the digest to B');
      await moreDigestRuns(2, 'two more digest runs'); // nothing is sent twice
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
      // Past the 5 s email delay (when it would be due), then two digest runs that saw it due.
      const due = Date.now() + 5000;
      await waitFor(() => Date.now() > due, 7000, 'the mention to be due for email');
      await moreDigestRuns(2, 'two digest runs after the mention was due');
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
  const OP = new User('MOp'); // an operator (moderation), verified below
  // Rate-limit counters live in the shared Redis, also across the single-instance run above.
  const { startMockDns } = await import('./lib/mock-dns.mjs');
  const multiDns = await startMockDns(); // domain verification (SCIM check)
  const AUTO_VERSION_MS = 1000; // automatic versions of open boards (KAI-82), instead of 30 min
  const FACILITATOR_GRACE_MS = 1000; // a facilitator gone this long ends their session (KAI-129)
  // Accounts are purged right away, and only by instance 2 (instance 1's job would run hourly).
  const env = (i) => ({
    DATABASE_URL: url,
    REDIS_URL,
    RATE_LIMIT_SIGNUP: '200/1h',
    ACCOUNT_DELETION_GRACE_DAYS: '0',
    ACCOUNT_PURGE_INTERVAL_SECONDS: i === 0 ? '3600' : '1',
    // Instance 1 re-checks its sockets' sessions every second, instance 2 hourly: what instance 2
    // closes at once can only have come from an announcement (KAI-146).
    SESSION_RECHECK_SECONDS: i === 0 ? '1' : '3600',
    FREERO_SNAPSHOT_EVERY_MS: String(AUTO_VERSION_MS),
    FREERO_FACILITATOR_GRACE_MS: String(FACILITATOR_GRACE_MS),
    SSO_DNS_SERVERS: multiDns.server,
    OPERATOR_EMAILS: OP.email,
  });
  const docRows = async (boardId) =>
    (await adminQuery(`SELECT count(*)::int AS n FROM board_doc_updates WHERE board_id = '${boardId}'`, url))[0].n;
  try {
    const up = await check('two instances start on one database and one Redis', async () => {
      url = await createDatabase();
      for (let i = 0; i < 2; i++) procs.push(await spawnServer(path.join(dataDir, `i${i}`), env(i)));
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

    await check('outbox across instances (KAI-148): links saved on both instances are indexed, and every board.content event is consumed exactly once in total — never by both', async () => {
      const consumedOn = async (p) => {
        const res = await fetch(`http://127.0.0.1:${p.port}/metrics`, { headers: { authorization: `Bearer ${RUN_METRICS_TOKEN}` } });
        const m = /^freero_outbox_consumed_total\{consumer="references"\} (\S+)$/m.exec(await res.text());
        return m ? Number(m[1]) : 0;
      };
      const events = async () => (await adminQuery(`SELECT count(*)::int AS n FROM _outbox WHERE topic = 'board.content'`, url))[0].n;
      const target = (await A.req('POST', '/api/boards', { title: 'Linked target' })).json.board;
      const linkers = [];
      for (const [who, port, i] of [[A, one, 1], [A, two, 2], [A, one, 3], [A, two, 4]]) {
        const lb = (await who.req('POST', '/api/boards', { title: `Linker ${i}` })).json.board;
        const c = connectDoc(who, lb.id, undefined, port);
        await c.ready();
        els(c).set('l', { id: 'l', type: 'sticky', x: 0, y: 0, w: 10, h: 10, text: `see freero://board/${target.id}` });
        await settled(c);
        linkers.push({ board: lb, client: c });
      }
      const listed = async (port) =>
        ((await A.req('GET', `/api/objects/backlinks?uri=${encodeURIComponent(`freero://board/${target.id}`)}`, undefined, { port })).json?.backlinks ?? []).length;
      await waitFor(async () => (await listed(one)) === 4 && (await listed(two)) === 4, 15_000, 'both instances to list the four linking boards');
      for (const l of linkers) l.client.destroy();
      await waitFor(async () => (await consumedOn(procs[0])) + (await consumedOn(procs[1])) === (await events()), 15_000, 'every outbox event to be consumed once');
      // A double delivery would show up as more consumed than written, also after a few more polls.
      await sleep(2500);
      const [c1, c2, n] = [await consumedOn(procs[0]), await consumedOn(procs[1]), await events()];
      assert(c1 + c2 === n, `consumed ${c1} + ${c2} events of ${n}`);
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

    await check('facilitator controls across instances (KAI-129): a participant on the other instance is locked at once, and the facilitator there keeps the session past the grace period', async () => {
      const C = new User('MC');
      await C.signup();
      await C.verifyEmail(path.join(dataDir, 'i0'));
      assert((await A.req('POST', `/api/boards/${board.id}/members`, { email: C.email, role: 'editor' })).status === 201, 'invite C');
      const c = connectDoc(C, board.id, undefined, one);
      await c.ready();
      const fac = (x) => x.doc.getMap('facilitation');
      fac(b).set('session', { by: B.id, byName: B.name, startedAt: Date.now(), locked: true, allowedTypes: null, follow: false, cursorsHidden: false });
      await waitFor(() => c.role === 'commenter' && c.limits?.locked, 5000, 'the participant on instance 1 to be locked');
      els(c).set('lockedOut', { id: 'lockedOut', type: 'sticky' });
      await settled(c, [a, b]);
      assert(!els(a).has('lockedOut') && !els(b).has('lockedOut'), "a locked participant's write crossed instances");
      // Instance 1 holds no socket of the facilitator: only their presence from instance 2 keeps it.
      await sleep(FACILITATOR_GRACE_MS * 2);
      assert(fac(a).get('session')?.by === B.id && c.role === 'commenter', 'the session ended while the facilitator was on the other instance');
      fac(b).delete('session');
      await waitFor(() => c.role === 'editor' && !c.limits, 5000, 'the participant to be released');
      c.destroy();
    });

    await check("opening the board on instance 2 right after an edit on instance 1 shows it before it is even saved", async () => {
      const fresh = (await A.req('POST', '/api/boards', { title: 'Unsaved' })).json.board;
      const w = connectDoc(A, fresh.id, undefined, one);
      await w.ready();
      els(w).set('u1', { id: 'u1', type: 'sticky', text: 'not saved yet' });
      await settled(w); // reached instance 1; its save waits ~1.5 s (debounce)
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
      await settled(w);
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
      await settled(w);
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
      await settled(w);
      const v1 = (await A.req('POST', `/api/boards/${vb.id}/versions`, { name: 'v1' }, { port: one })).json.version;
      assert(v1?.kind === 'named', 'name v1');
      els(w).set('r1', { id: 'r1', type: 'sticky', text: 'v2, not saved yet' });
      await settled(w);
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
      await settled(b1, [a, b]); // a's on instance 1, b's on instance 2
      assert(!els(a).has('ignored') && !els(b).has('ignored'), "a viewer's write crossed instances");
      assert((await A.req('PATCH', `/api/boards/${board.id}/members/${B.id}`, { role: 'editor' }, { port: two })).status === 200, 'restore');
      await waitFor(() => b.role === 'editor', 5000, 'B on instance 2 to be editor again');
      b1.destroy();
    });

    await check('removing a workspace member through instance 2 closes their socket on instance 1 at once (4403)', async () => {
      const team = (await A.req('POST', '/api/workspaces', { name: 'Multi team' })).json.workspace;
      const r = await A.req('POST', `/api/workspaces/${team.id}/members`, { email: B.email, role: 'member' });
      assert(r.status === 201, r.text);
      const tboard = (await A.req('POST', '/api/boards', { title: 'Team only', workspaceId: team.id })).json.board;
      const live = connectDoc(B, tboard.id, undefined, one);
      await live.ready();
      assert(live.role === 'editor', `team member role ${live.role}`);
      assert((await A.req('DELETE', `/api/workspaces/${team.id}/members/${B.id}`, undefined, { port: two })).status === 200, 'remove');
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'the socket on instance 1 to close');
      live.destroy();
    });

    await check('moderation across instances: a board taken down through instance 2 closes its sockets on instance 1 (4451) and neither instance lets anyone back in', async () => {
      await OP.signup();
      await OP.verifyEmail(path.join(dataDir, 'i0'));
      const t = (await A.req('POST', '/api/boards', { title: 'Taken down on two' })).json.board;
      assert((await A.req('POST', `/api/boards/${t.id}/members`, { email: B.email, role: 'editor' })).status === 201, 'invite');
      const onOne = connectDoc(B, t.id, undefined, one);
      const onTwo = connectDoc(A, t.id, undefined, two);
      await Promise.all([onOne.ready(), onTwo.ready()]);
      const r = await OP.req('POST', '/api/moderation/actions', { action: 'board.take_down', targetId: t.id, reason: 'spam', statement: 'Spam.' }, { port: two });
      assert(r.status === 200, r.text);
      await waitFor(() => onOne.closeCodes.includes(4451), 5000, 'the socket on instance 1 to close with 4451');
      await waitFor(() => onTwo.closeCodes.includes(4451), 5000, 'the socket on instance 2 to close with 4451');
      for (const port of [one, two]) {
        assert((await B.req('GET', `/api/boards/${t.id}`, undefined, { port })).status === 451, `REST on ${port}`);
        const again = connectDoc(B, t.id, undefined, port);
        await waitFor(() => again.closeCodes.includes(4451), 5000, `a new socket on ${port} to be refused`);
        again.destroy();
      }
      onOne.destroy();
      onTwo.destroy();
    });

    await check('moderation across instances: suspending an account through instance 2 closes its socket on instance 1 at once (4401)', async () => {
      const V = new User('MSusp');
      await V.signup();
      const own = (await V.req('POST', '/api/boards', { title: 'V' })).json.board;
      const live = connectDoc(V, own.id, undefined, one);
      await live.ready();
      const r = await OP.req('POST', '/api/moderation/actions', { action: 'user.suspend', targetId: V.id, reason: 'spam', statement: 'Spam.' }, { port: two });
      assert(r.status === 200, r.text);
      await waitFor(() => live.closeCodes.includes(4401), 5000, 'the socket on instance 1 to close with 4401');
      assert((await V.req('GET', '/api/auth/me', undefined, { port: one })).status === 401, 'still signed in on instance 1');
      live.destroy();
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

    // KAI-146: sessions ended outside any server process.
    await check('sessions deleted with SQL lose their open board socket and bell within SESSION_RECHECK_SECONDS (4401); other sessions stay connected', async () => {
      const S = new User('MSql');
      await S.signup();
      const own = (await S.req('POST', '/api/boards', { title: 'S' })).json.board;
      const keep = new User('MSql-laptop');
      keep.email = S.email;
      assert((await keep.req('POST', '/api/auth/login', { email: S.email, password: 'password-123' })).status === 200, 'second login');
      const live = connectDoc(S, own.id, undefined, one);
      const bell = notificationsSocket(S, one);
      const other = connectDoc(keep, own.id, undefined, one);
      await Promise.all([live.ready(), other.ready()]);
      await waitFor(() => bell.lastUnread() !== null, 5000, 'the bell to connect');
      const sid = (await S.req('GET', '/api/auth/sessions')).json.sessions.find((s) => s.current).id;
      await adminQuery(`DELETE FROM sessions WHERE id = '${sid}'`, url);
      await waitFor(() => live.closeCodes.includes(4401) && bell.closeCode === 4401, 5000, 'the board socket and the bell of the deleted session to close with 4401');
      await settled(other);
      assert(!other.closeCodes.length, `the other session's socket closed too: ${other.closeCodes}`);
      for (const c of [live, other]) c.destroy();
    });

    await check('`npm run admin -- two-factor:reset` (its own process, next to the instances) closes the board socket and bell of every session it ends at once (4401), on an instance that would not re-check for an hour', async () => {
      const R = new User('MReset');
      await R.signup();
      const setup = await R.req('POST', '/api/auth/two-factor/setup', { password: 'password-123' });
      assert((await R.req('POST', '/api/auth/two-factor/enable', { code: await totpCode({ secret: setup.json.secret }) })).status === 200, 'two-step on');
      const own = (await R.req('POST', '/api/boards', { title: 'R' })).json.board;
      const live = connectDoc(R, own.id, undefined, two);
      const bell = notificationsSocket(R, two);
      await live.ready();
      await waitFor(() => bell.lastUnread() !== null, 5000, 'the bell to connect');
      const cli = spawnSync(process.execPath, ['--import', 'tsx', 'apps/server/src/admin.ts', 'two-factor:reset', R.email, '--operator', 'verify', '--reason', 'KAI-146 check', '--yes'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env(1), FREERO_DATA_DIR: path.join(dataDir, 'i1'), NODE_ENV: 'test', SESSION_SECRET: RUN_SECRET, LOG_LEVEL: 'warn' },
        timeout: 60_000,
      });
      assert(cli.status === 0 && /Done:/.test(cli.stdout), `reset: ${cli.status} ${cli.stdout} ${cli.stderr}`);
      await waitFor(() => live.closeCodes.includes(4401) && bell.closeCode === 4401, 5000, 'the board socket and the bell on instance 2 to close with 4401');
      live.destroy();
    });

    await check('notifications across instances: an @mention written through a board socket on instance 1 updates the bell on instance 2 live; logging out through instance 1 closes that bell', async () => {
      // B's phone: its own session, its bell connected to instance 2 (B's board tab stays signed in).
      const phone = new User('MB-phone');
      phone.email = B.email;
      assert((await phone.req('POST', '/api/auth/login', { email: B.email, password: 'password-123' }, { port: two })).status === 200, 'login');
      const bell = notificationsSocket(phone, two);
      await waitFor(() => bell.lastUnread() !== null, 5000, 'the first unread count on instance 2');
      const before = bell.lastUnread();
      const now = Date.now();
      a.doc.transact(() => {
        const m = a.doc.getMap('comments');
        m.set('t:mt1', { kind: 'thread', id: 'mt1', x: 0, y: 0, createdAt: now, createdBy: A.id });
        m.set('m:mt1:m1', { kind: 'message', threadId: 'mt1', id: 'm1', authorId: A.id, authorName: A.name, text: `over to you <@${B.id}>`, createdAt: now });
      });
      await waitFor(() => bell.lastUnread() === before + 1, 5000, 'the mention to reach the bell on instance 2');
      const n = (await phone.req('GET', '/api/notifications', undefined, { port: two })).json.notifications[0];
      assert(n?.type === 'comment.mention' && n.link === `/board/${board.id}?thread=mt1`, JSON.stringify(n));
      assert((await phone.req('POST', '/api/auth/logout', undefined, { port: one })).status === 200, 'logout');
      await waitFor(() => bell.closeCode === 4401, 5000, 'the bell on instance 2 to close with 4401');
      assert((await B.req('GET', '/api/auth/me', undefined, { port: two })).status === 200, "B's other session was signed out too");
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
      await settled(b1, [a2, v1, v2]);
      await settled(a2, [v1, v2]);
      for (const o of [a2, v1, v2]) {
        const all = sharedText(o) + JSON.stringify(o.layers.private.toJSON()) + JSON.stringify(o.layers.editors.toJSON());
        assert(!all.includes('MULTI-DRAFT'), `${o.user.label} got B's private draft`);
        if (o.user === V) assert(!all.includes('MULTI-HIDDEN'), 'the viewer got hidden-frame content');
      }
      for (const c of [b1, b2, a2, v1, v2]) c.destroy();
    });

    await check("element content across instances: a hidden table's cell written into the shared doc on instance 1 reaches the editor on instance 2 in the editors layer, never a viewer's socket on either (KAI-230)", async () => {
      const a1 = await layerClient(A, board.id, one);
      const b2 = await layerClient(B, board.id, two);
      const v1 = await layerClient(V, board.id, one);
      const v2 = await layerClient(V, board.id, two);
      const seen = [];
      for (const c of [v1, v2]) for (const d of [c.doc, c.layers.private, c.layers.editors]) d.on('update', (u) => seen.push(Buffer.from(u)));
      const t = { id: 'mtab', type: 'table', x: 9000, y: 9000, w: 120, h: 40, z: 1, rotation: 0, rows: [{ id: 'r1', h: 40 }], cols: [{ id: 'c1', w: 120 }], header: false, fontSize: 14 };
      a1.layers.editors.getMap('elements').set(t.id, t);
      await waitFor(() => b2.layers.editors.getMap('elements').has(t.id), 5000, 'the hidden table to reach instance 2');
      a1.doc.getMap('tableCells').set('t:mtab:r1:c1', 'MULTI-HIDDEN-CELL');
      await waitFor(() => b2.layers.editors.getMap('tableCells').get('t:mtab:r1:c1') === 'MULTI-HIDDEN-CELL', 5000, "the editor on instance 2 to get the cell in the editors layer");
      await settled(a1, [b2, v1, v2]);
      assert(!seen.some((b) => b.includes(Buffer.from('MULTI-HIDDEN-CELL'))), "a viewer's socket received the hidden table's cell");
      assert(!b2.doc.getMap('tableCells').has('t:mtab:r1:c1'), "the hidden table's cell is in the shared doc on instance 2");
      for (const c of [a1, b2, v1, v2]) c.destroy();
    });

    await check('board layers across instances: opening the board on instance 2 right after a private edit on instance 1 gets it before it is saved', async () => {
      const fresh = (await A.req('POST', '/api/boards', { title: 'Layer catch-up' })).json.board;
      const w = await layerClient(A, fresh.id, one);
      w.layers.private.getMap('elements').set('early', { id: 'early', type: 'sticky', text: 'unsaved draft' });
      await settled(w); // reached instance 1; its save waits ~1.5 s (debounce)
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
      await settled(b1);
      await settled(r1);
      r1.destroy();
      assert((await A.req('DELETE', `/api/boards/${board.id}/members/${R.id}`)).status === 200, 'remove R');
      const a2 = await layerClient(A, board.id, two);
      const v1 = await layerClient(V, board.id, one);
      // B keeps typing in the draft at the very moment the owner reveals.
      a2.layerOp({ type: 'reveal', collection: 'elements' });
      b1.layers.private.getMap('elements').set('rv', { id: 'rv', type: 'sticky', text: 'v2' });
      await waitFor(() => els(v1).get('off')?.text === 'author offline' && els(v1).has('rv'), 5000, 'the viewer on instance 1 to see the revealed drafts');
      // Settled: the reveal reached instance 1's sockets (a2's later messages wait for it), and B's
      // racing edit reached both instances.
      await settled(a2, [b1, v1]);
      await settled(b1, [a2, v1]);
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

    await check('a board kept open on both instances and edited lightly gets an automatic version every period, one per period across both (KAI-82)', async () => {
      const open = (await A.req('POST', '/api/boards', { title: 'Open all day' })).json.board;
      assert((await A.req('POST', `/api/boards/${open.id}/members`, { email: B.email, role: 'editor' })).status === 201, 'invite');
      const p = connectDoc(A, open.id, undefined, one);
      const q = connectDoc(B, open.id, undefined, two);
      await Promise.all([p.ready(), q.ready()]);
      const autos = async () =>
        (
          await adminQuery(
            `SELECT (extract(epoch FROM created_at) * 1000)::float8 AS at FROM board_doc_snapshots WHERE board_id = '${open.id}' AND kind = 'auto' ORDER BY created_at`,
            url,
          )
        ).map((r) => Number(r.at));
      // A small edit every 200 ms, alternating instances; both sockets stay connected throughout.
      let n = 0;
      await waitFor(
        async () => {
          els(n % 2 ? p : q).set('note', { id: 'note', type: 'sticky', text: `edit ${++n}` });
          await sleep(200);
          return (await autos()).length >= 3;
        },
        20_000,
        'three automatic versions while the board stays open',
      );
      const at = await autos();
      for (let i = 1; i < at.length; i++) assert(at[i] - at[i - 1] >= AUTO_VERSION_MS, `two automatic versions in one period: ${at.join(', ')}`);
      p.destroy();
      q.destroy();
    });

    await check("an account purged by instance 2 shows its comment that only instance 1 holds (not saved yet) as \"Deleted user\", live and after a reload", async () => {
      const U = new User('MU');
      await U.signup();
      const cb = (await A.req('POST', '/api/boards', { title: 'Purge across instances' })).json.board;
      assert((await A.req('POST', `/api/boards/${cb.id}/members`, { email: U.email, role: 'commenter' })).status === 201, 'invite');
      const watcher = connectDoc(A, cb.id, undefined, one);
      const u = connectDoc(U, cb.id, undefined, one);
      await Promise.all([watcher.ready(), u.ready()]);
      const comment = () => watcher.doc.getMap('comments').get('m:t1:u');
      u.doc.getMap('comments').set('m:t1:u', { kind: 'message', threadId: 't1', id: 'u', authorId: U.id, authorName: U.name, authorColor: '#1C7ED6', text: 'unsaved', createdAt: Date.now() });
      await waitFor(() => comment()?.authorName === U.name, 5000, "U's comment to reach A");
      // A keeps typing on instance 1, which keeps postponing its (debounced) save while instance 2
      // purges: the comment is in instance 1's memory only.
      let typing = true;
      const keepTyping = (async () => {
        for (let i = 0; typing; i++) {
          els(watcher).set('k', { id: 'k', type: 'sticky', text: `typing ${i}` });
          await sleep(300);
        }
      })();
      try {
        assert((await U.req('POST', '/api/auth/account/delete', { password: 'password-123' }, { port: two })).status === 200, 'delete');
        await waitFor(() => comment()?.authorName === 'Deleted user', 8000, "A's open board (instance 1) to show U's comment as Deleted user");
      } finally {
        typing = false;
        await keepTyping;
      }
      watcher.destroy();
      u.destroy();
      await Promise.all(procs.map((p) => waitUnloaded(p)));
      const again = connectDoc(A, cb.id, undefined, two);
      await again.ready();
      const stored = again.doc.getMap('comments').get('m:t1:u');
      assert(stored?.authorName === 'Deleted user' && stored.text === 'unsaved', `after reload: ${JSON.stringify(stored)}`);
      again.destroy();
    });

    await check('an instance killed before saving loses nothing: the other instance saves what it relayed', async () => {
      const k = connectDoc(A, board.id, undefined, one);
      const s = connectDoc(B, board.id, undefined, two);
      await Promise.all([k.ready(), s.ready()]);
      els(k).set('crash', { id: 'crash', type: 'sticky', text: 'made on the instance that dies' });
      await waitFor(() => els(s).has('crash'), 5000, 'the edit to reach instance 2');
      k.destroy(); // its client goes away too (otherwise it would re-send the edit on reconnect)
      await stopProc(procs[0]); // hard kill, well inside the save debounce
      s.destroy(); // instance 2 saves what it relayed and unloads the board after FREERO_DOC_IDLE_MS
      await waitUnloaded(procs[1]);
      const after = connectDoc(A, board.id, undefined, two);
      await after.ready();
      assert(els(after).get('crash')?.text === 'made on the instance that dies', 'the edit died with its instance');
      after.destroy();
      // Instance 1 comes back (as after a crash restart) for the delete check below.
      procs[0] = await waitUp(await spawnServer(path.join(dataDir, 'i0b'), env(0)));
    });

    await check('deleting the board through instance 2 disconnects its sockets on instance 1 (4403)', async () => {
      const live = connectDoc(B, board.id, undefined, procs[0].port);
      await live.ready();
      assert((await A.req('DELETE', `/api/boards/${board.id}`, undefined, { port: two })).status === 200, 'delete');
      await waitFor(() => live.closeCodes.includes(4403), 5000, 'the socket on instance 1 to close with 4403');
      live.destroy();
    });

    await check('SCIM deprovisioning through instance 1 closes the person’s board socket and ends their session on instance 2 (KAI-46)', async () => {
      const domain = `multi-${Date.now()}.test`;
      const p1 = procs[0].port; // instance 1 was restarted (i0b) by an earlier check
      const O = new User('MO', p1);
      O.email = `owner@${domain}`;
      await O.signup();
      await O.verifyEmail(path.join(dataDir, 'i0b'));
      const Z = new User('MZ', two);
      Z.email = `zed@${domain}`;
      await Z.signup(); // a password account at the domain, signed in on instance 2
      const ws = (await O.req('POST', '/api/workspaces', { name: 'Directory' })).json.workspace;
      const d = (await O.req('POST', `/api/workspaces/${ws.id}/sso/domains`, { domain })).json.domains[0];
      multiDns.setTxt(d.txtName, [d.txtValue]);
      assert((await O.req('POST', `/api/workspaces/${ws.id}/sso/domains/${d.id}/verify`)).status === 200, 'verify domain');
      const token = (await O.req('POST', `/api/workspaces/${ws.id}/scim/tokens`, {})).json.token;
      const { scimClient } = await import('./lib/scim-compliance.mjs');
      const scim = scimClient(`http://127.0.0.1:${p1}/scim/v2`, token);
      const zed = (await scim('POST', '/Users', { userName: Z.email, active: true })).json;
      assert(zed.id === Z.id, `provisioned ${JSON.stringify(zed)}`);
      const tb = (await O.req('POST', '/api/boards', { title: 'Team', workspaceId: ws.id })).json.board;
      const live = connectDoc(Z, tb.id, undefined, two);
      await live.ready();
      assert(live.role === 'editor', `role ${live.role}`);
      const off = await scim('PATCH', `/Users/${zed.id}`, { Operations: [{ op: 'replace', value: { active: false } }] });
      assert(off.status === 200, off.text);
      await waitFor(() => live.closeCodes.some((c) => c === 4401 || c === 4403), 5000, "Zed's socket on instance 2 to close");
      live.destroy();
      assert((await Z.req('GET', '/api/auth/me')).status === 401, 'the session on instance 2 survived');
    });
  } finally {
    closeAllDocs();
    server = null;
    await multiDns?.close();
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
  /** `form`: an HTML form post (application/x-www-form-urlencoded) instead of a JSON `body`. */
  async fetch(url, { method = 'GET', body, form, headers = {} } = {}) {
    const abs = new URL(url, this.origin);
    const own = abs.origin === this.origin;
    const h = { ...headers };
    if (own && this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    if (form !== undefined) h['content-type'] = 'application/x-www-form-urlencoded';
    const payload = form !== undefined ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(abs, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie();
    if (own) {
      for (const c of setCookies) {
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
    return { status: res.status, location: res.headers.get('location'), json, text, url: abs.href, setCookies };
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
      // An account made by a provider gets its personal workspace like any other (on first use).
      const ws = (await b.fetch('/api/workspaces')).json?.workspaces ?? [];
      assert(ws.length === 1 && ws[0].kind === 'personal' && ws[0].role === 'owner', `workspaces ${JSON.stringify(ws)}`);
      const made = await b.fetch('/api/boards', { method: 'POST', body: { title: 'From Google' } });
      assert(made.status === 201 && made.json.board.workspaceId === ws[0].id, `board ${made.status} ${made.text}`);
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

      const since = outboxMark(dataDir);
      const forgot = await new Browser(port).fetch('/api/auth/password/forgot', { method: 'POST', body: { email: P.email } });
      assert(forgot.status === 200, `forgot: ${forgot.status} ${forgot.text}`);
      const token = await mailedToken(dataDir, P.email, '/reset-password', { since });
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

    // KAI-86: security notices, read from the dev outbox.
    const noticesTo = (to, subject) => outbox(dataDir).filter((m) => m.to === to && subject.test(m.subject));
    await check('new-browser sign-in notice: mailed once to the owner with the device and approximate place; the browser that signed up, or one that signed in before, gets none', async () => {
      const email = address('nora');
      const firefox = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'x-forwarded-for': '203.0.113.9' };
      const iphone = {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        'x-forwarded-for': '198.51.100.7',
      };
      const login = (b, headers) => b.fetch('/api/auth/login', { method: 'POST', body: { email, password: 'password-123' }, headers });
      const home = new Browser(port);
      const signup = await home.fetch('/api/auth/signup', { method: 'POST', body: { name: 'Nora', email, password: 'password-123' }, headers: firefox });
      assert(signup.status === 201 && home.jar.has('freero_device'), `signup: ${signup.status}, device cookie ${home.jar.has('freero_device')}`);
      await home.fetch('/api/auth/logout', { method: 'POST' });
      assert((await login(home, firefox)).status === 200, 'login from the signup browser');
      const phone = new Browser(port);
      assert((await login(phone, iphone)).status === 200, 'login from a new browser');
      await waitFor(() => noticesTo(email, /New sign-in/).length === 1, 5000, 'the new sign-in notice');
      const { text } = noticesTo(email, /New sign-in/)[0];
      assert(/Safari on iPhone/.test(text) && /Japan/.test(text) && /with its password/.test(text), text);
      assert(!text.includes('198.51.100.7'), 'the full address is in the mail');
      await phone.fetch('/api/auth/logout', { method: 'POST' });
      assert((await login(phone, iphone)).status === 200, 'second login from the phone');
      // Barrier instead of a pause: one more new browser, whose notice is mailed after any the phone's
      // second login could have caused; then exactly that one must have been added.
      assert((await login(new Browser(port), firefox)).status === 200, 'login from another new browser');
      await waitFor(() => noticesTo(email, /New sign-in/).length >= 2, 5000, 'the notice for the other new browser');
      const notices = noticesTo(email, /New sign-in/);
      assert(notices.length === 2 && /Firefox/.test(notices[1].text), `notices: ${notices.map((n) => n.text.slice(0, 80)).join(' | ')} (the signup or a known browser was reported)`);
    });

    await check('"this wasn\'t me": an email change mails the previous (verified) address a link that takes the account back — new password, intruder signed out — once', async () => {
      const O = new User('Owner', port);
      O.email = address('owner');
      await O.signup();
      await O.verifyEmail(dataDir);
      const intruder = new User('Intruder', port);
      intruder.email = O.email;
      assert((await intruder.req('POST', '/api/auth/login', { email: O.email, password: 'password-123' })).status === 200, 'intruder login');
      const theirs = address('theirs');
      assert((await intruder.req('POST', '/api/auth/email', { email: theirs, password: 'password-123' })).status === 200, 'email change request');
      const confirm = await mailedToken(dataDir, theirs, '/confirm-email');
      assert((await intruder.req('POST', '/api/auth/email/confirm', { token: confirm })).status === 200, 'confirm');
      const revert = await mailedToken(dataDir, O.email, '/revert-email');
      const notice = noticesTo(O.email, /email address was changed/)[0];
      assert(notice && !notice.text.includes(theirs), `the old address learns the new one in full: ${notice?.text}`);

      const b = new Browser(port);
      const back = await b.fetch('/api/auth/email/revert', { method: 'POST', body: { token: revert, password: 'owner-password-2' } });
      assert(back.status === 200 && back.json.user?.email === O.email && b.jar.has('freero_session'), `revert: ${back.status} ${back.text}`);
      assert((await intruder.req('GET', '/api/auth/me')).status === 401, "the intruder's session survived");
      assert((await new User('t', port).req('POST', '/api/auth/login', { email: O.email, password: 'owner-password-2' })).status === 200, 'new password');
      assert((await new User('t', port).req('POST', '/api/auth/login', { email: O.email, password: 'password-123' })).status === 401, 'old password still works');
      const again = await new Browser(port).fetch('/api/auth/email/revert', { method: 'POST', body: { token: revert, password: 'intruder-pass-9' } });
      assert(again.status === 400, `link reused: ${again.status}`);
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
// Two-step verification recovery (KAI-99), on its own server with a short recovery delay: someone
// with the password locks the owner out with their own authenticator, and the owner gets back in
// through the notice's "this wasn't me" link, a delayed recovery or an operator (the admin CLI) —
// while the mailbox alone, or the password alone, never removes a second factor the owner holds.
// ---------------------------------------------------------------------------
async function twoFactorRecoveryChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-recovery-'));
  const DELAY_S = 4;
  const env = {
    TWO_FACTOR_RECOVERY_DELAY_SECONDS: String(DELAY_S),
    // Every request here comes from 127.0.0.1 (and with REDIS_URL the counters are shared with the run).
    RATE_LIMIT_TWO_FACTOR: '200/15m',
    RATE_LIMIT_PASSWORD: '200/15m',
    RATE_LIMIT_LOGIN: '500/5m',
    RATE_LIMIT_TWO_FACTOR_RECOVERY: '100/1h',
  };
  let proc = null;
  const start = async () => (proc = await waitUp(await spawnServer(dataDir, env)));
  try {
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('recovery server boots (two-step recovery delay of a few seconds)', start);
    if (!ok) return;
    const stamp = Date.now();
    const verified = async (label) => {
      const u = new User(label, proc.port);
      u.email = `${label.toLowerCase()}-${stamp}@recovery.verify.freero.app`;
      await u.signup();
      await u.verifyEmail(dataDir);
      return u;
    };
    /** `u` (any session of the account) turns two-step verification on with a new authenticator. */
    const enrol = async (u, password = 'password-123') => {
      const setup = await u.req('POST', '/api/auth/two-factor/setup', { password });
      const enable = await u.req('POST', '/api/auth/two-factor/enable', { code: await totpCode({ secret: setup.json.secret }) });
      assert(enable.status === 200, `enable: ${enable.text}`);
      return setup.json.secret;
    };
    const nextCode = (secret) => totpCode({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const login = (b, email, password) => b.fetch('/api/auth/login', { method: 'POST', body: { email, password } });
    const mails = (to, re) => outbox(dataDir).filter((m) => m.to === to && (re.test(m.subject) || re.test(m.text)));
    /** Someone else signs in with the owner's password (no second step yet) and locks it with their own authenticator. */
    const intrude = async (owner) => {
      const intruder = new User('Intruder', proc.port);
      intruder.email = owner.email;
      assert((await intruder.req('POST', '/api/auth/login', { email: owner.email, password: 'password-123' })).status === 200, 'intruder login');
      await enrol(intruder);
      return intruder;
    };

    await check('"this wasn\'t me" in the two-step-on notice: the owner locked out by an intruder\'s authenticator takes the account back from the mail; the intruder is signed out; the link works once', async () => {
      const O = await verified('Locked');
      const intruder = await intrude(O);
      const locked = await login(new Browser(proc.port), O.email, 'password-123');
      assert(locked.json?.twoFactorRequired === true, `the owner is not locked out: ${locked.text}`);
      const undo = await mailedToken(dataDir, O.email, '/undo-two-factor');
      const b = new Browser(proc.port);
      const back = await b.fetch('/api/auth/two-factor/undo', { method: 'POST', body: { token: undo, password: 'owner-password-2' } });
      assert(back.status === 200 && back.json.user?.email === O.email && b.jar.has('freero_session'), `undo: ${back.status} ${back.text}`);
      assert((await intruder.req('GET', '/api/auth/me')).status === 401, "the intruder's session survived");
      const again = await login(new Browser(proc.port), O.email, 'owner-password-2');
      assert(again.status === 200 && again.json.user?.id === O.id, `the owner still needs the intruder's code: ${again.text}`);
      const replay = await new Browser(proc.port).fetch('/api/auth/two-factor/undo', { method: 'POST', body: { token: undo, password: 'intruder-pass-9' } });
      assert(replay.status === 400, `link reused: ${replay.status}`);
    });

    await check('lost authenticator: the mailbox alone (a reset link) cannot start a recovery; one started with the password removes two-step verification only after the waiting period, through the link then mailed', async () => {
      const M = await verified('Mailbox');
      await enrol(M);
      const after = Date.now();
      await new Browser(proc.port).fetch('/api/auth/password/forgot', { method: 'POST', body: { email: M.email } });
      const m = new Browser(proc.port);
      const reset = await m.fetch('/api/auth/password/reset', { method: 'POST', body: { token: await mailedToken(dataDir, M.email, '/reset-password', { after }), password: 'mailbox-pass-1' } });
      assert(reset.json?.twoFactorRequired === true, reset.text);
      const viaLink = await m.fetch('/api/auth/login/two-factor/recovery', { method: 'POST' });
      assert(viaLink.status === 403 && viaLink.json.code === 'recovery_needs_password', `reset link: ${viaLink.status} ${viaLink.text}`);
      await login(m, M.email, 'mailbox-pass-1'); // the password the mailbox chose is no better
      const viaPassword = await m.fetch('/api/auth/login/two-factor/recovery', { method: 'POST' });
      assert(viaPassword.status === 403, `password set through the link: ${viaPassword.status} ${viaPassword.text}`);

      const R = await verified('Recover');
      await enrol(R);
      const b = new Browser(proc.port);
      assert((await login(b, R.email, 'password-123')).json?.twoFactorRequired === true, 'second step expected');
      const started = await b.fetch('/api/auth/login/two-factor/recovery', { method: 'POST' });
      assert(started.status === 200 && started.json.readyAt > Date.now(), `start: ${started.status} ${started.text}`);
      await waitFor(() => mails(R.email, /recovery started/i).length === 1, 5000, 'the "recovery started" mail');
      assert(mails(R.email, /\/recover-two-factor/).length === 0, 'the finishing link was mailed before the waiting period ended');
      const finish = await mailedToken(dataDir, R.email, '/recover-two-factor', { timeoutMs: DELAY_S * 1000 + 15_000 });
      assert(Date.now() >= started.json.readyAt, 'the finishing link came early');
      assert(mails(R.email, /removable soon/).length === 1, 'no reminder before the end');
      const done = await new Browser(proc.port).fetch('/api/auth/two-factor/recovery/finish', { method: 'POST', body: { token: finish, password: 'recovered-pass-1' } });
      assert(done.status === 200 && done.json.user?.id === R.id, `finish: ${done.status} ${done.text}`);
      assert((await R.req('GET', '/api/auth/me')).status === 401, 'the sessions from before survived');
      const fresh = await login(new Browser(proc.port), R.email, 'recovered-pass-1');
      assert(fresh.status === 200 && fresh.json.user, `two-step verification is still on: ${fresh.text}`);
    });

    await check('the authenticator wins: signing in with it cancels a recovery that someone with only the password started, and no finishing link is ever mailed', async () => {
      const S = await verified('Safe');
      const secret = await enrol(S);
      const attacker = new Browser(proc.port);
      await login(attacker, S.email, 'password-123');
      assert((await attacker.fetch('/api/auth/login/two-factor/recovery', { method: 'POST' })).status === 200, 'start');
      const owner = new Browser(proc.port);
      await login(owner, S.email, 'password-123');
      const signedIn = await owner.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code: await nextCode(secret) } });
      assert(signedIn.status === 200, signedIn.text);
      assert((await owner.fetch('/api/auth/security')).json.twoFactor.recovery === null, 'recovery still in progress');
      await waitFor(() => mails(S.email, /recovery cancelled/i).length === 1, 5000, 'the "recovery cancelled" mail');
      await sleep(DELAY_S * 1000 + 2000);
      assert(mails(S.email, /\/recover-two-factor/).length === 0, 'a finishing link was mailed for a cancelled recovery');
    });

    await check('operator path: `npm run admin -- two-factor:reset` changes nothing without --yes; with it, the intruder\'s authenticator and the password go, everyone is signed out, an audit line is logged, and the owner gets in through a reset link', async () => {
      const O = await verified('Operator');
      const intruder = await intrude(O);
      const admin = (...args) =>
        spawnSync(process.execPath, ['--import', 'tsx', 'apps/server/src/admin.ts', ...args], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, ...env, FREERO_DATA_DIR: dataDir, NODE_ENV: 'test', SESSION_SECRET: RUN_SECRET, LOG_LEVEL: 'info' },
          timeout: 60_000,
        });
      // PGlite is one process: the CLI runs while the server is stopped (on Postgres it could run alongside).
      await stopProc(proc);
      const dry = admin('two-factor:reset', O.email, '--operator', 'verify', '--reason', 'KAI-99 check');
      assert(dry.status === 0 && /Nothing changed/.test(dry.stdout) && /two-step\s+on since/.test(dry.stdout), `dry run: ${dry.status} ${dry.stdout} ${dry.stderr}`);
      const real = admin('two-factor:reset', O.email, '--operator', 'verify', '--reason', 'KAI-99 check', '--yes');
      assert(real.status === 0 && /Done:/.test(real.stdout), `reset: ${real.status} ${real.stdout} ${real.stderr}`);
      const auditLine = real.stdout.split('\n').find((l) => l.includes('"audit"'));
      assert(auditLine && JSON.parse(auditLine).audit.action === 'auth.two_factor.reset_by_operator' && JSON.parse(auditLine).audit.actor.name === 'verify', `audit line: ${auditLine}`);
      await start();
      intruder.port = proc.port;
      assert((await intruder.req('GET', '/api/auth/me')).status === 401, "the intruder's session survived");
      assert((await login(new Browser(proc.port), O.email, 'password-123')).status === 401, 'the old password still works');
      assert(mails(O.email, /was reset on your Freero account/).length === 1, 'no notice to the owner');
      const after = Date.now();
      await new Browser(proc.port).fetch('/api/auth/password/forgot', { method: 'POST', body: { email: O.email } });
      const b = new Browser(proc.port);
      const reset = await b.fetch('/api/auth/password/reset', { method: 'POST', body: { token: await mailedToken(dataDir, O.email, '/reset-password', { after }), password: 'owner-password-3' } });
      assert(reset.status === 200 && reset.json.user?.id === O.id && b.jar.has('freero_session'), `reset after the operator: ${reset.text}`);
    });
  } finally {
    if (proc) await stopProc(proc);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// SESSION_SECRET rotation (KAI-87), on its own server restarted with different secrets: an
// authenticator enrolled under the old secret must keep working through the whole procedure in
// docs/operations.md, including for someone who never signs in while it runs.
// ---------------------------------------------------------------------------
async function secretRotationChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-rotation-'));
  const oldSecret = randomBytes(32).toString('base64url');
  const newSecret = randomBytes(32).toString('base64url');
  let proc = null;
  try {
    const env = { RATE_LIMIT_TWO_FACTOR: '200/15m', LOG_LEVEL: 'info' }; // info: the re-sealing job reports there
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    await check('SESSION_SECRET rotation: an authenticator enrolled under the old secret works after the swap (re-sealed by the job, no sign-in needed) and after the old secret is dropped', async () => {
      proc = await waitUp(await spawnServer(dataDir, { ...env, SESSION_SECRET: oldSecret }));
      const u = new User('Rotate', proc.port);
      await u.signup();
      const setup = await u.req('POST', '/api/auth/two-factor/setup', { password: 'password-123' });
      const enable = await u.req('POST', '/api/auth/two-factor/enable', { code: await totpCode({ secret: setup.json.secret }) });
      assert(enable.status === 200, `enrol: ${enable.text}`);
      await stopProc(proc);

      proc = await waitUp(await spawnServer(dataDir, { ...env, SESSION_SECRET: newSecret, SESSION_SECRET_PREVIOUS: oldSecret }));
      const logged = () => proc.log.join('');
      await waitFor(() => logged().includes('sealed 1 two-step verification secret(s) again'), 15_000, 'the re-sealing job');
      assert(!/open with no configured SESSION_SECRET/.test(logged()), 'a secret could not be opened');
      await stopProc(proc);

      proc = await waitUp(await spawnServer(dataDir, { ...env, SESSION_SECRET: newSecret }));
      const b = new Browser(proc.port);
      const login = await b.fetch('/api/auth/login', { method: 'POST', body: { email: u.email, password: 'password-123' } });
      assert(login.json?.twoFactorRequired === true, login.text);
      const code = await totpCode({ secret: setup.json.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const second = await b.fetch('/api/auth/login/two-factor', { method: 'POST', body: { code } });
      assert(second.status === 200 && b.jar.has('freero_session'), `authenticator code after the rotation: ${second.status} ${second.text}`);
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
    const place = async (boardId, url, el = { id: 'img', type: 'image' }) => {
      const c = connectDoc(U, boardId);
      await c.ready();
      els(c).set(el.id, { x: 0, y: 0, w: 10, h: 10, src: url, ...el });
      await settled(c); // the server has it
      c.destroy(); // the last client leaving saves the doc right away
    };

    await check('uploads sweep: images on a live, a trashed, a purged and a copied board, in a template, as an avatar, and one never used; a file card and an attachment never placed', async () => {
      for (const k of ['live', 'trashed', 'purged', 'copied', 'template', 'avatar', 'unused']) {
        const r = await U.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
        assert(r.status === 201, `upload ${k} -> ${r.status}`);
        files[k] = r.json.url;
      }
      const live = await board('Live');
      await place(live, files.live);
      // File cards (KAI-128): an attachment on the live board, and one never placed.
      for (const k of ['card', 'cardUnused']) {
        const r = await U.req('POST', '/api/uploads?as=attachment', Buffer.from(`notes ${k}`), { raw: true, headers: { 'content-type': 'text/plain' } });
        assert(r.status === 201, `attach ${k} -> ${r.status}`);
        files[k] = r.json.url;
      }
      await place(live, files.card, { id: 'card', type: 'file', name: 'notes.txt', size: 11, mime: 'text/plain' });
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
      await waitUnloaded(); // every doc saved; then a hard kill
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
      // The file card on the live board stays; the attachment never placed went with the round.
      const kept = ['live', 'trashed', 'copied', 'template', 'avatar', 'card'].map((k) => files[k].slice('/uploads/'.length)).sort();
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

// ---------------------------------------------------------------------------
// Enterprise: workspace single sign-on (KAI-45), against a local SAML identity provider that signs
// with a real key (scripts/lib/mock-saml.mjs), a local OpenID provider, and a local DNS server the
// server's real resolver asks for the verification TXT records (SSO_DNS_SERVERS).
// ---------------------------------------------------------------------------

/** The SAMLResponse and RelayState of the identity provider's auto-posting form. */
function postedForm(html) {
  const field = (n) => new RegExp(`name="${n}" value="([^"]*)"`).exec(html)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"') ?? null;
  return { SAMLResponse: field('SAMLResponse'), RelayState: field('RelayState'), action: /action="([^"]+)"/.exec(html)?.[1] ?? null };
}

/** Starts an SP-initiated SAML sign-in in `b`; returns the request it sent and where to post the answer. */
async function startSaml(b, workspaceId, idp, next = '') {
  const start = await b.fetch(`/api/sso/${workspaceId}/start${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  assert(start.status === 302 && start.location?.startsWith(idp.ssoUrl), `start: ${start.status} ${start.location} ${start.text}`);
  const url = new URL(start.location);
  const request = await idp.readRequest(url);
  return { url, request, relay: url.searchParams.get('RelayState') };
}

/** Posts a SAMLResponse to the ACS from the IdP's origin (cross-site, like the real form); returns the ACS answer. */
function postToAcs(b, acsUrl, samlResponse, relay, idp) {
  return b.fetch(acsUrl, { method: 'POST', form: { SAMLResponse: samlResponse, RelayState: relay ?? '' }, headers: { origin: new URL(idp.ssoUrl).origin } });
}

async function ssoChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-sso-'));
  const { startMockSaml } = await import('./lib/mock-saml.mjs');
  const { startMockDns } = await import('./lib/mock-dns.mjs');
  const { selfSignedCertificate } = await import('./lib/test-cert.mjs');
  const dns = await startMockDns();
  const idp = await startMockSaml();
  const google = await startMockOidc({ clientId: 'freero-google', clientSecret: 'google-secret' });
  const wsOidc = await startMockOidc({ clientId: 'beta-client', clientSecret: 'beta-secret' });
  let proc = null;
  try {
    const env = {
      SSO_DNS_SERVERS: dns.server,
      OIDC_GOOGLE_CLIENT_ID: 'freero-google',
      OIDC_GOOGLE_CLIENT_SECRET: 'google-secret',
      OIDC_GOOGLE_ISSUER: google.issuer,
      RATE_LIMIT_SSO: '5000/10m',
      RATE_LIMIT_PASSWORD: '200/15m',
      RATE_LIMIT_LOGIN: '500/5m',
    };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const up = await check('SSO server boots with a DNS server for domain verification', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!up) return;
    const port = proc.port;
    const stamp = Date.now();
    const domain = `acme-${stamp}.test`;
    const at = (local) => `${local}@${domain}`;

    // The owner: a password account at the organization's domain (break-glass later).
    const O = new User('SsoOwner', port);
    O.email = at('owner');
    await O.signup();
    await O.verifyEmail(dataDir);
    const ws = (await O.req('POST', '/api/workspaces', { name: `Acme ${stamp}` })).json.workspace;
    const sso = (sub = '') => `/api/workspaces/${ws.id}/sso${sub}`;
    // Bob: an existing password account at the domain, signed in before SSO is enforced.
    const B = new User('SsoBob', port);
    B.email = at('bob');
    await B.signup();
    await B.verifyEmail(dataDir);

    let domainId = null;
    await check('a domain is verified only by its DNS TXT record (missing or wrong record: refused), and only one workspace can hold it', async () => {
      const added = await O.req('POST', sso('/domains'), { domain: domain.toUpperCase() });
      assert(added.status === 201, added.text);
      const d = added.json.domains[0];
      assert(d.domain === domain && !d.verified && d.txtName === `_freero-verification.${domain}` && d.txtValue.startsWith('freero-verification='), JSON.stringify(d));
      domainId = d.id;
      assert((await O.req('POST', sso(`/domains/${d.id}/verify`))).status === 409, 'verified without a record');
      dns.setTxt(d.txtName, ['freero-verification=not-the-token', 'v=spf1 -all']);
      assert((await O.req('POST', sso(`/domains/${d.id}/verify`))).status === 409, 'verified with a wrong record');
      dns.setTxt(d.txtName, ['v=spf1 -all', d.txtValue]);
      const ok = await O.req('POST', sso(`/domains/${d.id}/verify`));
      assert(ok.status === 200 && ok.json.domains[0].verified, ok.text);
      // Another team claims the same domain and publishes its own token: the first proof wins.
      const P = new User('SsoRival', port);
      await P.signup();
      const rival = (await P.req('POST', '/api/workspaces', { name: 'Rival' })).json.workspace;
      const claim = (await P.req('POST', `/api/workspaces/${rival.id}/sso/domains`, { domain })).json.domains[0];
      dns.setTxt(claim.txtName, [d.txtValue, claim.txtValue]);
      const taken = await P.req('POST', `/api/workspaces/${rival.id}/sso/domains/${claim.id}/verify`);
      assert(taken.status === 409 && /another workspace/.test(taken.json.error), `${taken.status} ${taken.text}`);
      // Members can't see or change it.
      assert((await B.req('GET', sso())).status === 404, 'a non-member reads SSO settings');
    });

    await check("the SAML connection is configured from the identity provider's metadata (entity ID, SSO URL, signing certificate)", async () => {
      const bad = await O.req('PUT', sso('/connection'), { protocol: 'saml', enabled: true, samlMetadataXml: '<x/>' });
      assert(bad.status === 400, `bad metadata accepted: ${bad.status}`);
      const r = await O.req('PUT', sso('/connection'), { protocol: 'saml', enabled: true, samlMetadataXml: idp.metadataXml(), defaultRole: 'member' });
      assert(r.status === 200, r.text);
      const c = r.json.connection;
      assert(c.saml.entityId === idp.entityId && c.saml.ssoUrl === idp.ssoUrl && c.saml.certificates.length === 1 && c.testedAt === null, JSON.stringify(c));
      const meta = await new Browser(port).fetch(`/api/sso/${ws.id}/saml/metadata`);
      assert(meta.status === 200 && meta.text.includes(r.json.serviceProvider.acsUrl), meta.text.slice(0, 300));
      const early = await O.req('POST', sso('/enforce'), { enforced: true, breakGlassUserId: O.id });
      assert(early.status === 409, `enforced before any sign-in went through: ${early.status}`);
    });

    let alice = null;
    await check('SP-initiated SAML sign-in: a newcomer at the domain gets a verified account and joins the workspace with the default role; the session ends with the IdP session', async () => {
      const b = new Browser(port);
      const email = at('alice');
      const { url } = await startSaml(b, ws.id, idp, '/board/welcome');
      idp.queueSignIn({ email, name: 'Alice Directory', sessionNotOnOrAfter: Date.now() + 2 * 3_600_000 });
      const posted = postedForm(await (await fetch(url)).text());
      assert(posted.SAMLResponse && posted.action.endsWith(`/api/sso/${ws.id}/saml/acs`), JSON.stringify(posted).slice(0, 200));
      const acs = await postToAcs(b, posted.action, posted.SAMLResponse, posted.RelayState, idp);
      assert(acs.status === 303 && acs.location.startsWith(`/api/sso/${ws.id}/saml/finish`), `acs: ${acs.status} ${acs.location} ${acs.text}`);
      const fin = await b.fetch(acs.location);
      assert(fin.status === 303 && fin.location === '/board/welcome', `finish: ${fin.status} ${fin.location}`);
      const cookie = fin.setCookies.find((c) => c.startsWith('freero_session='));
      const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie ?? '')?.[1]);
      assert(maxAge > 7000 && maxAge <= 7200, `session cookie Max-Age ${maxAge} (IdP session: 2 h)`);
      const me = (await b.fetch('/api/auth/me')).json.user;
      assert(me.email === email && me.emailVerified && me.name === 'Alice Directory', JSON.stringify(me));
      const mine = (await b.fetch('/api/workspaces')).json.workspaces.find((w) => w.id === ws.id);
      assert(mine?.role === 'member', `membership: ${JSON.stringify(mine)}`);
      const sessions = (await b.fetch('/api/auth/sessions')).json.sessions;
      assert(sessions[0].methodLabel === 'Single sign-on', JSON.stringify(sessions));
      alice = { browser: b, id: me.id, email };
      const tested = (await O.req('GET', sso())).json.connection.testedAt;
      assert(tested !== null, 'the connection does not record that a sign-in went through');
    });

    await check('SAML: only the browser that started the sign-in finishes it, and a response is accepted once (replay of the same response, or of its assertion under a new request, is refused)', async () => {
      const email = at('carol');
      const victim = new Browser(port);
      const { request, relay } = await startSaml(victim, ws.id, idp);
      const resp = idp.buildResponse({ email, inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer, assertionId: '_fixed-assertion-' + stamp });
      const acs = await postToAcs(victim, request.acsUrl, resp, relay, idp);
      assert(acs.status === 303 && acs.location.includes('/saml/finish'), `acs: ${acs.status} ${acs.location}`);
      // Someone else's browser holding the finish link gets nothing (no binding cookie).
      const other = new Browser(port);
      const stolen = await other.fetch(acs.location);
      assert(stolen.location === '/login?error=sso_failed' && !other.jar.has('freero_session'), `stolen finish: ${stolen.location}`);
      const replayed = await postToAcs(new Browser(port), request.acsUrl, resp, relay, idp);
      assert(replayed.location === '/login?error=sso_failed', `same response posted again: ${replayed.location}`);
      const fin = await victim.fetch(acs.location);
      assert(fin.location === `/app?ws=${ws.id}` && victim.jar.has('freero_session'), `the real browser: ${fin.location}`);
      // The same assertion (same ID) answering a fresh request: refused as a replay.
      const c2 = new Browser(port);
      const s2 = await startSaml(c2, ws.id, idp);
      const again = idp.buildResponse({ email, inResponseTo: s2.request.id, acsUrl: s2.request.acsUrl, audience: s2.request.issuer, assertionId: '_fixed-assertion-' + stamp });
      const r2 = await postToAcs(c2, s2.request.acsUrl, again, s2.relay, idp);
      assert(r2.location === '/login?error=sso_failed', `replayed assertion ID: ${r2.location}`);
    });

    await check('SAML responses that fail validation are refused and sign nobody in: unsigned, signed by another key, wrong audience, wrong recipient, expired, not yet valid, unsolicited (IdP-initiated), or answering another request', async () => {
      const email = at('mallory');
      const other = selfSignedCertificate('Not the IdP');
      const cases = {
        unsigned: { sign: 'none' },
        'another key': { key: other },
        'wrong audience': { audience: 'https://elsewhere.example/sp' },
        'wrong recipient': { recipient: 'https://elsewhere.example/acs' },
        expired: { issueInstant: Date.now() - 30 * 60_000, now: Date.now() - 30 * 60_000, notOnOrAfter: Date.now() - 20 * 60_000 },
        'not yet valid': { notBefore: Date.now() + 10 * 60_000 },
        unsolicited: { inResponseTo: null },
        'another request': { inResponseTo: '_not-a-request-we-sent' },
      };
      const accepted = [];
      for (const [name, o] of Object.entries(cases)) {
        const b = new Browser(port);
        const { request, relay } = await startSaml(b, ws.id, idp);
        const resp = idp.buildResponse({ email, inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer, ...o });
        const acs = await postToAcs(b, request.acsUrl, resp, relay, idp);
        const fin = acs.location?.includes('/saml/finish') ? await b.fetch(acs.location) : null;
        if (acs.location !== '/login?error=sso_failed' || b.jar.has('freero_session')) accepted.push(`${name}: ${acs.status} ${acs.location} ${fin?.location ?? ''}`);
      }
      assert(accepted.length === 0, `accepted: ${accepted.join('; ')}`);
    });

    await check('XML signature wrapping: a validly signed assertion with a forged one wrapped around it never signs in as the forged address', async () => {
      const victim = at('victim');
      const attempts = [];
      for (const variant of ['forged first', 'signed one hidden in Extensions']) {
        const b = new Browser(port);
        const { request, relay } = await startSaml(b, ws.id, idp);
        const legit = Buffer.from(
          idp.buildResponse({ email: at('attacker'), inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer }),
          'base64',
        ).toString('utf8');
        const signedAssertion = /<saml:Assertion[\s\S]*<\/saml:Assertion>/.exec(legit)[0];
        const forged = signedAssertion
          .replace(/ID="[^"]+"/, 'ID="_forged"')
          .replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, '')
          .replaceAll(at('attacker'), victim);
        const wrapped =
          variant === 'forged first'
            ? legit.replace(signedAssertion, forged + signedAssertion)
            : legit.replace(signedAssertion, `<samlp:Extensions>${signedAssertion}</samlp:Extensions>${forged}`);
        const acs = await postToAcs(b, request.acsUrl, Buffer.from(wrapped).toString('base64'), relay, idp);
        if (acs.location?.includes('/saml/finish')) await b.fetch(acs.location);
        const me = (await b.fetch('/api/auth/me')).json?.user;
        if (me?.email === victim) attempts.push(`${variant}: signed in as the victim`);
        else if (me) attempts.push(`${variant}: accepted (as ${me.email})`);
      }
      assert(attempts.length === 0, attempts.join('; '));
    });

    await check("a SAML identity provider can't vouch for addresses outside the workspace's verified domains", async () => {
      const b = new Browser(port);
      const { request, relay } = await startSaml(b, ws.id, idp);
      const acs = await postToAcs(b, request.acsUrl, idp.buildResponse({ email: `ceo-${stamp}@gmail.test`, inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer }), relay, idp);
      const fin = await b.fetch(acs.location);
      assert(fin.location === '/login?error=sso_domain' && !b.jar.has('freero_session'), `${acs.location} -> ${fin.location}`);
    });

    await check('discovery routes an address at the domain to the IdP (by domain only); "Enforce SSO" needs an owner as break-glass', async () => {
      const d = (await new Browser(port).fetch(`/api/sso/discover?email=${encodeURIComponent(at('anyone'))}&next=%2Fboard%2Fx`)).json.sso;
      assert(d && d.startUrl.startsWith(`/api/sso/${ws.id}/start?`) && d.startUrl.includes('next=%2Fboard%2Fx') && d.enforced === false, JSON.stringify(d));
      assert((await new Browser(port).fetch('/api/sso/discover?email=someone@unrelated.test')).json.sso === null, 'routed an unrelated domain');
      const notOwner = await O.req('POST', sso('/enforce'), { enforced: true, breakGlassUserId: alice.id });
      assert(notOwner.status === 400, `a member as break-glass: ${notOwner.status}`);
    });

    await check('"Enforce SSO": password, reset-link, signup and personal-provider sign-ins at the domain are refused (before the password is checked); existing non-SSO sessions end; SSO sessions and the break-glass owner keep working', async () => {
      assert((await B.req('GET', '/api/auth/me')).status === 200, "Bob's password session before enforcing");
      const on = await O.req('POST', sso('/enforce'), { enforced: true, breakGlassUserId: O.id });
      assert(on.status === 200 && on.json.connection.enforced && on.json.sessionsEnded >= 1, on.text);
      assert((await B.req('GET', '/api/auth/me')).status === 401, "Bob's password session survived");
      assert((await alice.browser.fetch('/api/auth/me')).status === 200, "Alice's SSO session ended");
      const wrong = await new User('x', port).req('POST', '/api/auth/login', { email: B.email, password: 'not-his-password' });
      const right = await new User('x', port).req('POST', '/api/auth/login', { email: B.email, password: 'password-123' });
      assert(wrong.status === 403 && wrong.json.code === 'sso_required' && right.status === 403 && right.json.code === 'sso_required', `${wrong.status} ${right.status}`);
      const signup = await new User('x', port).req('POST', '/api/auth/signup', { name: 'New', email: at('newbie'), password: 'password-123' });
      assert(signup.status === 403 && signup.json.code === 'sso_required', `signup: ${signup.status}`);
      const after = Date.now();
      await new Browser(port).fetch('/api/auth/password/forgot', { method: 'POST', body: { email: B.email } });
      const token = await mailedToken(dataDir, B.email, '/reset-password', { after });
      const reset = await new Browser(port).fetch('/api/auth/password/reset', { method: 'POST', body: { token, password: 'bob-new-pass-1' } });
      assert(reset.status === 403 && reset.json.code === 'sso_required', `reset link signed in: ${reset.status} ${reset.text}`);
      google.queueSignIn({ email: B.email });
      const viaGoogle = await new Browser(port).navigate('/api/auth/oidc/google/start');
      assert(viaGoogle.startsWith('/login?error=sso_required'), `Google sign-in: ${viaGoogle}`);
      google.queueSignIn({ email: at('fresh-google') });
      assert((await new Browser(port).navigate('/api/auth/oidc/google/start')).startsWith('/login?error=sso_required'), 'Google made an account at the domain');
      const breakGlass = await new User('x', port).req('POST', '/api/auth/login', { email: O.email, password: 'password-123' });
      assert(breakGlass.status === 200, `break-glass owner: ${breakGlass.status} ${breakGlass.text}`);
      // Bob through SSO reaches his existing account (connected to it), not a new one.
      const b = new Browser(port);
      const { request, relay } = await startSaml(b, ws.id, idp);
      const acs = await postToAcs(b, request.acsUrl, idp.buildResponse({ email: B.email, inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer }), relay, idp);
      await b.fetch(acs.location);
      assert((await b.fetch('/api/auth/me')).json?.user?.id === B.id, 'SSO did not reach Bob’s account');
    });

    await check('OpenID Connect per workspace (reusing the generic client): sign-in through the workspace issuer, newcomers join as the default role, the client secret is never sent back', async () => {
      const betaDomain = `beta-${stamp}.test`;
      const Q = new User('BetaOwner', port);
      await Q.signup();
      const beta = (await Q.req('POST', '/api/workspaces', { name: 'Beta' })).json.workspace;
      const d = (await Q.req('POST', `/api/workspaces/${beta.id}/sso/domains`, { domain: betaDomain })).json.domains[0];
      dns.setTxt(d.txtName, [d.txtValue]);
      assert((await Q.req('POST', `/api/workspaces/${beta.id}/sso/domains/${d.id}/verify`)).status === 200, 'verify beta');
      const saved = await Q.req('PUT', `/api/workspaces/${beta.id}/sso/connection`, {
        protocol: 'oidc',
        enabled: true,
        oidcIssuer: wsOidc.issuer,
        oidcClientId: 'beta-client',
        oidcClientSecret: 'beta-secret',
        defaultRole: 'guest',
      });
      assert(saved.status === 200 && saved.json.connection.oidc.hasClientSecret && !saved.text.includes('beta-secret'), saved.text);
      const b = new Browser(port);
      wsOidc.queueSignIn({ email: `dana@${betaDomain}`, name: 'Dana' });
      const landed = await b.navigate(`/api/sso/${beta.id}/start?next=%2Fapp`);
      assert(landed === `/app?ws=${beta.id}`, `landed on ${landed} (not the workspace signed in to)`);
      const me = (await b.fetch('/api/auth/me')).json.user;
      const role = (await b.fetch('/api/workspaces')).json.workspaces.find((w) => w.id === beta.id)?.role;
      assert(me.email === `dana@${betaDomain}` && role === 'guest', `${me.email} ${role}`);
      wsOidc.queueSignIn({ email: `eve@${domain}` }); // Acme's domain, not Beta's
      assert((await new Browser(port).navigate(`/api/sso/${beta.id}/start`)) === '/login?error=sso_domain', "Beta's provider vouched for Acme's address");
    });
  } finally {
    if (proc) await stopProc(proc);
    await idp.close();
    await dns.close();
    await google.close();
    await wsOidc.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

/** A team workspace owned by `owner` with `domain` verified (through `dns`) and a SAML connection to `idp`. */
async function ssoWorkspace(owner, dns, idp, domain, name) {
  const ws = (await owner.req('POST', '/api/workspaces', { name })).json.workspace;
  const d = (await owner.req('POST', `/api/workspaces/${ws.id}/sso/domains`, { domain })).json.domains[0];
  dns.setTxt(d.txtName, [d.txtValue]);
  const v = await owner.req('POST', `/api/workspaces/${ws.id}/sso/domains/${d.id}/verify`);
  assert(v.status === 200, `verify ${domain}: ${v.text}`);
  const c = await owner.req('PUT', `/api/workspaces/${ws.id}/sso/connection`, { protocol: 'saml', enabled: true, samlMetadataXml: idp.metadataXml() });
  assert(c.status === 200, c.text);
  return ws;
}

/** Signs `email` in through the workspace's SAML provider in a fresh browser; returns { browser, landed }. */
async function samlSignIn(port, workspaceId, idp, email) {
  const b = new Browser(port);
  const { request, relay } = await startSaml(b, workspaceId, idp);
  const acs = await postToAcs(b, request.acsUrl, idp.buildResponse({ email, inResponseTo: request.id, acsUrl: request.acsUrl, audience: request.issuer }), relay, idp);
  if (!acs.location?.includes('/saml/finish')) return { browser: b, landed: acs.location };
  return { browser: b, landed: (await b.fetch(acs.location)).location };
}

/** A connectDoc-able user for a Browser's session. */
const asSocketUser = (b, id, label) => ({ id, label, name: label, port: b.port, cookie: `freero_session=${b.jar.get('freero_session')}` });

// ---------------------------------------------------------------------------
// Enterprise: SCIM 2.0 provisioning (KAI-46) — the Okta / Entra request sequences
// (scripts/lib/scim-compliance.mjs), then what provisioning does in Freero.
// ---------------------------------------------------------------------------
async function scimChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-scim-'));
  const { startMockSaml } = await import('./lib/mock-saml.mjs');
  const { startMockDns } = await import('./lib/mock-dns.mjs');
  const { runScimCompliance, scimClient } = await import('./lib/scim-compliance.mjs');
  const dns = await startMockDns();
  const idp = await startMockSaml();
  let proc = null;
  try {
    const env = { SSO_DNS_SERVERS: dns.server, RATE_LIMIT_SSO: '5000/10m' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const up = await check('SCIM server boots', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!up) return;
    const port = proc.port;
    server = proc; // connectDoc / wsCloseCode default to `server`
    const stamp = Date.now();
    const domain = `scim-${stamp}.test`;
    const O = new User('ScimOwner', port);
    O.email = `owner@${domain}`;
    await O.signup();
    await O.verifyEmail(dataDir);
    const ws = await ssoWorkspace(O, dns, idp, domain, `Directory ${stamp}`);
    const api = (sub = '') => `/api/workspaces/${ws.id}/scim${sub}`;
    let token = null;

    await check('provisioning tokens: owners/admins generate them (shown once, stored hashed — never listed), members cannot', async () => {
      const made = await O.req('POST', api('/tokens'), { label: 'Okta' });
      assert(made.status === 201 && made.json.token.startsWith('frscim_') && made.json.settings.tokens.length === 1, made.text);
      token = made.json.token;
      const listed = await O.req('GET', api());
      assert(listed.status === 200 && !listed.text.includes(token) && listed.json.tokens[0].prefix === token.slice(0, 13), listed.text);
      const M = new User('ScimMember', port);
      await M.signup();
      assert((await M.req('POST', api('/tokens'), {})).status === 404, 'an outsider made a token');
    });
    if (!token) return;
    const base = `http://127.0.0.1:${port}/scim/v2`;
    await runScimCompliance({ baseUrl: base, token, domain, check, assert });
    const scim = scimClient(base, token);

    await check('SCIM provisions only addresses at the workspace’s verified domains', async () => {
      const r = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `someone-${stamp}@gmail.test`, active: true });
      assert(r.status === 400 && r.json.scimType === 'invalidValue', `${r.status} ${r.text}`);
    });

    // Zed: provisioned, signs in through SSO, opens a team board.
    const zedEmail = `zed@${domain}`;
    const zed = (await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: zedEmail, name: { givenName: 'Zed', familyName: 'Dir' }, active: true })).json;
    const board = (await O.req('POST', '/api/boards', { title: 'Team plan', workspaceId: ws.id })).json.board;

    await check('a provisioned person is a member of the workspace and signs in through SSO to the same account', async () => {
      const { browser, landed } = await samlSignIn(port, ws.id, idp, zedEmail);
      assert(landed === `/app?ws=${ws.id}`, `landed ${landed}`);
      const me = (await browser.fetch('/api/auth/me')).json.user;
      assert(me.id === zed.id && me.name === 'Zed Dir', JSON.stringify(me));
      assert((await browser.fetch('/api/workspaces')).json.workspaces.find((w) => w.id === ws.id)?.role === 'member', 'not a member');
      zed.browser = browser;
    });

    const adminMember = async (id) => (await O.req('GET', `/api/workspaces/${ws.id}/admin/members`)).json.members.find((m) => m.userId === id);
    const auditActions = async () => (await O.req('GET', `/api/workspaces/${ws.id}/audit?limit=200`)).json.events.map((e) => e.action);
    await check('deprovisioning (active: false) is the admin console’s deactivation: the board socket closes at once, the organization account is signed out, SSO keeps them out; reactivating lets them back; the directory’s changes are in the workspace’s audit log', async () => {
      const client = connectDoc(asSocketUser(zed.browser, zed.id, 'Zed'), board.id);
      await client.ready();
      assert(client.role === 'editor', `role ${client.role}`);
      const off = await scim('PATCH', `/Users/${zed.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] });
      assert(off.status === 200 && off.json.active === false, off.text);
      await waitFor(() => client.closeCodes.some((c) => c === 4401 || c === 4403), 5000, "Zed's board socket to close");
      client.destroy();
      assert((await zed.browser.fetch('/api/auth/me')).status === 401, 'session survived deprovisioning');
      const m = await adminMember(zed.id);
      assert(m?.deactivated === true && m.role === 'member', `in the admin console: ${JSON.stringify(m)}`);
      const again = await samlSignIn(port, ws.id, idp, zedEmail);
      assert(again.landed === '/login?error=sso_removed' && !again.browser.jar.has('freero_session'), `SSO after deprovisioning: ${again.landed}`);
      const on = await scim('PATCH', `/Users/${zed.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'True' }] });
      assert(on.json.active === true, on.text);
      assert((await adminMember(zed.id))?.deactivated === false, 'still deactivated after the directory reactivated them');
      const back = await samlSignIn(port, ws.id, idp, zedEmail);
      assert(back.landed === `/app?ws=${ws.id}` &&(await back.browser.fetch('/api/workspaces')).json.workspaces.some((w) => w.id === ws.id), `after reactivating: ${back.landed}`);
      const actions = await auditActions();
      for (const a of ['scim.token_created', 'scim.user_provisioned', 'scim.user_deprovisioned', 'scim.user_reactivated', 'sso.login_refused', 'sso.login', 'sso.domain_verified', 'sso.connection_saved'])
        assert(actions.includes(a), `${a} missing from the audit log (${[...new Set(actions)].join(', ')})`);
    });

    await check('an admin’s deactivation in the console also keeps someone out of SSO, and the directory’s next sync does not lift it', async () => {
      assert((await O.req('POST', `/api/workspaces/${ws.id}/admin/members/${zed.id}/deactivate`)).status === 200, 'deactivate');
      await scim('PUT', `/Users/${zed.id}`, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: zedEmail, name: { givenName: 'Zed', familyName: 'Dir' }, active: true });
      assert((await adminMember(zed.id))?.deactivated === true, 'a directory sync reactivated someone an admin deactivated');
      assert((await samlSignIn(port, ws.id, idp, zedEmail)).landed === '/login?error=sso_removed', 'SSO let a deactivated member in');
      assert((await O.req('POST', `/api/workspaces/${ws.id}/admin/members/${zed.id}/reactivate`)).status === 200, 'reactivate');
    });

    await check('directory groups map to roles in Freero: the highest mapped role wins, leaving the group returns the default role, and an owner is never changed', async () => {
      const ownerScim = (await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: O.email, active: true })).json;
      assert(ownerScim.id === O.id, 'the owner was not linked to their account');
      const admins = (await scim('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: `Admins ${stamp}`, members: [{ value: zed.id }, { value: O.id }] })).json;
      const guests = (await scim('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: `Guests ${stamp}`, members: [{ value: O.id }] })).json;
      const roleOf = async (id) => (await O.req('GET', `/api/workspaces/${ws.id}/members`)).json.members.find((m) => m.userId === id)?.role;
      assert((await roleOf(zed.id)) === 'member', 'role before mapping');
      assert((await O.req('PUT', api(`/groups/${admins.id}`), { mapping: { kind: 'role', role: 'admin' } })).status === 200, 'map admins');
      assert((await O.req('PUT', api(`/groups/${guests.id}`), { mapping: { kind: 'role', role: 'guest' } })).status === 200, 'map guests');
      assert((await roleOf(zed.id)) === 'admin', `mapped admin: ${await roleOf(zed.id)}`);
      assert((await roleOf(O.id)) === 'owner', `the owner was changed to ${await roleOf(O.id)}`);
      await scim('PATCH', `/Groups/${admins.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'remove', path: `members[value eq "${zed.id}"]` }] });
      assert((await roleOf(zed.id)) === 'member', `after leaving the group: ${await roleOf(zed.id)}`);
    });

    await check("a directory group mapped to a private project gives its members that project's boards; leaving the group takes them away", async () => {
      const project = (await O.req('POST', `/api/workspaces/${ws.id}/projects`, { name: 'Secret', access: 'private' })).json.project;
      const secret = (await O.req('POST', '/api/boards', { title: 'Secret plan', workspaceId: ws.id, projectId: project.id })).json.board;
      const zb = (await samlSignIn(port, ws.id, idp, zedEmail)).browser;
      assert((await zb.fetch(`/api/boards/${secret.id}`)).status !== 200, 'Zed sees the private board before the mapping');
      const team = (await scim('POST', '/Groups', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: `Secret team ${stamp}`, members: [{ value: zed.id }] })).json;
      assert((await O.req('PUT', api(`/groups/${team.id}`), { mapping: { kind: 'project', projectId: project.id } })).status === 200, 'map project');
      assert((await zb.fetch(`/api/boards/${secret.id}`)).status === 200, 'Zed does not see the private board after the mapping');
      await scim('PATCH', `/Groups/${team.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Remove', path: 'members', value: [{ value: zed.id }] }] });
      assert((await zb.fetch(`/api/boards/${secret.id}`)).status !== 200, 'Zed kept the private board after leaving the group');
    });

    await check('token rotation: a rotated token stops working at once and its replacement works; with overlap, a second token works and the revoked one is refused; all audited', async () => {
      const old = (await O.req('GET', api())).json.tokens.find((t) => token.startsWith(t.prefix));
      const rotated = await O.req('POST', api(`/tokens/${old.id}/rotate`));
      assert(rotated.status === 200 && rotated.json.token !== token, rotated.text);
      assert((await scim('GET', '/Users')).status === 401, 'the rotated token still works');
      const viaRotated = scimClient(base, rotated.json.token);
      assert((await viaRotated('GET', '/Users')).status === 200, 'the replacement token');
      const second = (await O.req('POST', api('/tokens'), { label: 'Okta (overlap)' })).json;
      assert((await scimClient(base, second.token)('GET', '/Users')).status === 200, 'second token');
      const replaced = second.settings.tokens.find((t) => rotated.json.token.startsWith(t.prefix));
      assert((await O.req('DELETE', api(`/tokens/${replaced.id}`))).status === 200, 'revoke');
      assert((await viaRotated('GET', '/Users')).status === 401, 'revoked token still works');
      const actions = await auditActions();
      assert(['scim.token_rotated', 'scim.token_revoked', 'scim.group_mapped'].every((a) => actions.includes(a)), [...new Set(actions)].join(', '));
    });
  } finally {
    closeAllDocs();
    if (proc) await stopProc(proc);
    server = null;
    await idp.close();
    await dns.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Enterprise: data exports and workspace deletion (KAI-50). Built by the job, announced by mail,
// downloaded with the requester's session; the ZIP's contents are read back.
// ---------------------------------------------------------------------------
async function privacyChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-privacy-'));
  const { unzipSync, strFromU8 } = await import('fflate');
  let proc = null;
  try {
    const env = { DATA_EXPORT_INTERVAL_SECONDS: '1' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const up = await check('privacy server boots', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!up) return;
    const port = proc.port;
    server = proc;
    const U = new User('Exporter', port);
    const W = new User('Other', port);
    for (const u of [U, W]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    /**
     * Waits for the "ready" mail to `to` (its link opens the page that lists the export: Account
     * settings, or the workspace's settings), then returns the newest ready export's download path.
     */
    const mailedExport = async (u, after, { workspaceId = null } = {}) => {
      let mail = null;
      await waitFor(
        () => (mail = outbox(dataDir).filter((x) => x.to === u.email && x.sentAt >= after - 50 && /export/i.test(x.subject)).at(-1)),
        30_000,
        `the export mail to ${u.email}`,
      );
      const page = workspaceId ? `/admin/${workspaceId}?tab=retention#data` : '/settings#data';
      assert(mail.text.includes(page), `the mail links elsewhere: ${mail.text}`);
      const list = (await u.req('GET', workspaceId ? `/api/workspaces/${workspaceId}/exports` : '/api/me/exports')).json.exports;
      assert(list[0]?.status === 'ready', JSON.stringify(list));
      return `/api/exports/${list[0].id}/download`;
    };
    const download = async (u, link) => {
      const res = await fetch(`http://127.0.0.1:${port}${link}`, { headers: { cookie: u.cookie } });
      return { status: res.status, type: res.headers.get('content-type'), bytes: new Uint8Array(await res.arrayBuffer()) };
    };

    // U's data: a board with a sticky and an image, a comment on W's board (W replies), a template, an avatar.
    const image = (await U.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).json.url;
    const mine = (await U.req('POST', '/api/boards', { title: 'My roadmap' })).json.board;
    const wBoard = (await W.req('POST', '/api/boards', { title: 'Their board' })).json.board;
    await W.req('POST', `/api/boards/${wBoard.id}/members`, { email: U.email, role: 'commenter' });
    const uc = connectDoc(U, mine.id);
    await uc.ready();
    uc.doc.transact(() => {
      els(uc).set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: '<p>Ship exports</p>', index: 0 });
      els(uc).set('i1', { id: 'i1', type: 'image', x: 300, y: 0, w: 100, h: 100, src: image, index: 1 });
    });
    const onW = connectDoc(U, wBoard.id);
    await onW.ready();
    onW.doc.transact(() => {
      onW.doc.getMap('comments').set('t:th1', { kind: 'thread', id: 'th1', x: 10, y: 10, elementId: null, createdAt: Date.now(), createdBy: U.id });
      onW.doc.getMap('comments').set('m:th1:m1', { kind: 'message', threadId: 'th1', id: 'm1', authorId: U.id, authorName: U.name, text: 'My exported comment', createdAt: Date.now() });
    });
    const wc = connectDoc(W, wBoard.id);
    await wc.ready();
    await waitFor(() => wc.doc.getMap('comments').has('m:th1:m1'), 5000, 'W to receive the comment');
    wc.doc.getMap('comments').set('m:th1:m2', { kind: 'message', threadId: 'th1', id: 'm2', authorId: W.id, authorName: W.name, text: 'W private reply', createdAt: Date.now() });
    await sleep(800); // saved
    await U.req('POST', '/api/templates', { name: 'Kickoff', description: '', content: { elements: [{ id: 'f1', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Kickoff', index: 0 }] } });

    let files = null;
    await check('personal data export: built by the job, mailed as a link, downloaded by its owner as a ZIP of profile, memberships, comments (with board context), owned boards (JSON + Yjs + images), templates, uploads and notifications', async () => {
      const after = Date.now();
      const r = await U.req('POST', '/api/me/exports');
      assert(r.status === 202 && r.json.export.status === 'pending', r.text);
      const link = await mailedExport(U, after);
      const dl = await download(U, link);
      assert(dl.status === 200 && dl.type === 'application/zip', `download: ${dl.status} ${dl.type}`);
      files = unzipSync(dl.bytes);
      const read = (p) => JSON.parse(strFromU8(files[p]));
      const names = Object.keys(files);
      assert(read('account.json').profile.email === U.email, 'account.json');
      assert(!strFromU8(files['account.json']).includes('scrypt'), 'a password hash leaked into the export');
      const comments = read('comments.json');
      const onTheirs = comments.find((c) => c.board.id === wBoard.id);
      assert(onTheirs?.board.title === 'Their board' && onTheirs.threads[0].messages.map((m) => m.text).join() === 'My exported comment', JSON.stringify(comments));
      assert(!strFromU8(files['comments.json']).includes('W private reply'), "another person's reply is in the export");
      const boardDir = names.find((n) => n.endsWith(`-${mine.id}/board.json`))?.replace('/board.json', '');
      assert(boardDir, `no board folder in ${names.join(', ')}`);
      const board = read(`${boardDir}/board.json`);
      assert(board.board.title === 'My roadmap' && board.content.elements.s1.text.includes('Ship exports'), JSON.stringify(board).slice(0, 300));
      const yd = new Y.Doc();
      Y.applyUpdate(yd, files[`${boardDir}/board.yjs`]);
      assert(yd.getMap('elements').get('i1')?.src === image, 'board.yjs does not hold the board');
      const imageName = image.slice('/uploads/'.length);
      assert(files[`${boardDir}/files/${imageName}`]?.length === PNG_1PX.length && files[`uploads/${imageName}`], 'images missing');
      assert(names.some((n) => /^templates\/kickoff-.*\.json$/.test(n)), 'template missing');
      assert(read('notifications.json').notifications.some((n) => n.type === 'board.shared' || n.boardId === wBoard.id), JSON.stringify(read('notifications.json')).slice(0, 300));
      assert(read('memberships.json').boards.some((b) => b.boardId === wBoard.id && b.role === 'commenter'), 'board membership missing');
    });

    await check("an export link works only for the person who asked for it", async () => {
      const exports = (await U.req('GET', '/api/me/exports')).json.exports;
      const link = `/api/exports/${exports[0].id}/download`;
      assert((await download(W, link)).status === 404, 'someone else downloaded it');
      assert((await fetch(`http://127.0.0.1:${port}${link}`)).status === 401, 'downloaded signed out');
    });

    const O = new User('WsOwner', port);
    const M = new User('WsMember', port);
    for (const u of [O, M]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const team = (await O.req('POST', '/api/workspaces', { name: `Exported team ${Date.now()}` })).json.workspace;
    assert((await O.req('POST', `/api/workspaces/${team.id}/members`, { email: M.email, role: 'member' })).status === 201, 'add member');
    const teamBoard = (await O.req('POST', '/api/boards', { title: 'Team board', workspaceId: team.id })).json.board;
    let wsLink = null;
    await check('workspace export: owners/admins only; the ZIP holds the directory (members with emails, projects) and every board', async () => {
      assert((await M.req('POST', `/api/workspaces/${team.id}/exports`)).status === 403, 'a member exported the workspace');
      const after = Date.now();
      assert((await O.req('POST', `/api/workspaces/${team.id}/exports`)).status === 202, 'owner export');
      wsLink = await mailedExport(O, after, { workspaceId: team.id });
      const dl = await download(O, wsLink);
      assert(dl.status === 200, `download ${dl.status}`);
      const z = unzipSync(dl.bytes);
      const ws = JSON.parse(strFromU8(z['workspace.json']));
      assert(ws.members.some((m) => m.email === M.email && m.role === 'member') && ws.workspace.id === team.id, JSON.stringify(ws).slice(0, 300));
      assert(Object.keys(z).some((n) => n.endsWith(`-${teamBoard.id}/board.json`)), 'team board missing');
      // The workspace's export is its own audit event; a member's personal export is not the team's business.
      assert((await M.req('POST', '/api/me/exports')).status === 202, "the member's own export");
      await sleep(300);
      const actions = (await O.req('GET', `/api/workspaces/${team.id}/audit?limit=200`)).json.events.map((e) => e.action);
      assert(actions.includes('workspace.export_requested') && actions.includes('workspace.export_downloaded'), actions.join(', '));
      assert(!actions.includes('account.export_requested'), 'a member’s personal export shows in the team’s audit log');
    });

    await check('deleting a workspace mails every owner a receipt, and its exports stop being downloadable', async () => {
      const after = Date.now();
      const del = await O.req('DELETE', `/api/workspaces/${team.id}`, { confirm: team.name });
      assert(del.status === 200, del.text);
      await waitFor(() => outbox(dataDir).some((m) => m.to === O.email && m.sentAt >= after - 50 && /was deleted/.test(m.subject)), 5000, 'the deletion receipt');
      assert((await download(O, wsLink)).status === 404, 'the deleted workspace’s export is still downloadable');
    });
  } finally {
    closeAllDocs();
    if (proc) await stopProc(proc);
    server = null;
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Teams & workspaces follow-ups: request access (KAI-40), guests on shared links (KAI-43), the
// activity feed (KAI-44) and the team access level (KAI-93), on a server of their own.
// ---------------------------------------------------------------------------
async function teamsChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-teams-'));
  let proc = null;
  const clients = [];
  const sockets = [];
  try {
    // An operator (KAI-142) for the moderation checks; the guest-join limit has counters of its own.
    const OP = new User('TeamOperator');
    const env = { ACTIVITY_IDLE_SECONDS: '1', RATE_LIMIT_GUEST_JOIN: '4/1h', OPERATOR_EMAILS: OP.email };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('teams server boots (activity bursts end after 1 s, 4 guest joins per IP)', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const port = proc.port;
    const O = new User('TeamOwner', port);
    const R = new User('TeamAsker', port);
    const M = new User('TeamMember', port);
    OP.port = port;
    for (const u of [O, R, M, OP]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const board = (await O.req('POST', '/api/boards', { title: 'Roadmap Q3' })).json.board;
    const unread = async (u) => (await u.req('GET', '/api/notifications')).json.unread;

    await check('request access: asking twice files one request, the owner approves it as a role from the inbox, and the waiting requester is let in live', async () => {
      assert((await R.req('GET', `/api/boards/${board.id}`)).status === 403, 'the requester could open the board');
      const before = (await R.req('GET', `/api/boards/${board.id}/access-request`)).json;
      assert(before.status === 'none' && before.canRequest, JSON.stringify(before));
      const live = notificationsSocket(R, port);
      sockets.push(live);
      await waitFor(() => live.lastUnread() === 0, 5000, 'the requester’s notifications socket');
      const asks = await Promise.all([1, 2].map(() => R.req('POST', `/api/boards/${board.id}/access-request`, { role: 'editor', message: 'Need it for planning' })));
      assert(asks.every((a) => a.status === 201 && a.json.status === 'pending'), JSON.stringify(asks.map((a) => a.json)));
      const asked = (await O.req('GET', '/api/notifications')).json.notifications.filter((n) => n.type === 'access.request');
      assert(asked.length === 1 && asked[0].accessRequest?.canDecide && asked[0].body === 'Need it for planning', JSON.stringify(asked));
      assert(!asked[0].title.includes('@'), 'an email address in the title');
      const approve = await O.req('POST', `/api/boards/${board.id}/access-requests/${R.id}`, { decision: 'approve', role: 'commenter' });
      assert(approve.status === 200, approve.text);
      await waitFor(() => live.lastUnread() === 1, 5000, 'the answer to reach the requester live');
      const opened = await R.req('GET', `/api/boards/${board.id}`);
      assert(opened.status === 200 && opened.json.board.role === 'commenter', opened.text);
      const again = await O.req('POST', `/api/boards/${board.id}/access-requests/${R.id}`, { decision: 'deny' });
      assert(again.status === 409, `a second decision -> ${again.status}`);
    });

    const G = new User('Guest', port);
    await check('a visitor without an account joins a "can edit" link as a commenter named "Guest · …", and never sees the member list', async () => {
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'editor' })).status === 200, 'link on');
      const info = (await G.req('GET', `/api/guest/boards/${board.id}`)).json;
      assert(info.allowed && info.role === 'commenter' && info.title === 'Roadmap Q3', JSON.stringify(info));
      const joined = await G.req('POST', `/api/guest/boards/${board.id}/join`, { name: '  Kim‮ ' });
      assert(joined.status === 201 && joined.json.guest.name === 'Kim' && G.cookie.startsWith('freero_guest='), joined.text);
      G.id = joined.json.guest.id;
      G.name = 'Guest · Kim';
      const own = await G.req('GET', `/api/guest/boards/${board.id}/board`);
      assert(own.status === 200 && own.json.board.role === 'commenter', own.text);
      assert((await G.req('GET', `/api/boards/${board.id}/members`)).status === 401, 'a guest listed the members');
      assert((await G.req('GET', '/api/boards')).status === 401, 'a guest listed boards');
      const people = (await G.req('GET', `/api/boards/${board.id}/people?ids=${O.id}`)).json.people;
      assert(people.length === 1 && people[0].email === undefined, JSON.stringify(people));
      const other = (await O.req('POST', '/api/boards', { title: 'Other' })).json.board;
      await O.req('PATCH', `/api/boards/${other.id}`, { linkAccess: 'viewer' });
      assert((await G.req('GET', `/api/guest/boards/${other.id}/board`)).status === 403, 'a guest opened a board they did not join');
      assert((await wsCloseCode(other.id, G.cookie, port)) === 4403, 'a guest socket reached another board');
    });

    await check('a guest appears in presence as "Guest · …" and can comment only under that name', async () => {
      const o = connectDoc(O, board.id);
      const g = connectDoc(G, board.id);
      clients.push(o, g);
      await Promise.all([o.ready(), g.ready()]);
      assert(g.role === 'commenter', `guest role ${g.role}`);
      await waitFor(() => [...o.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Guest · Kim' && s.user?.id === G.id), 5000, 'the guest in presence');
      const msg = (id, authorName) => ({ kind: 'message', threadId: 'gt', id, authorId: G.id, authorName, text: 'hello from a guest', createdAt: Date.now() });
      g.doc.transact(() => {
        g.doc.getMap('comments').set('t:gt', { kind: 'thread', id: 'gt', x: 0, y: 0, createdAt: Date.now(), createdBy: G.id });
        g.doc.getMap('comments').set('m:gt:ok', msg('ok', 'Guest · Kim'));
      });
      await waitFor(() => o.doc.getMap('comments').has('m:gt:ok'), 5000, 'the guest’s comment');
      const forger = connectDoc(G, board.id);
      clients.push(forger);
      await forger.ready();
      forger.doc.getMap('comments').set('m:gt:fake', msg('fake', O.name));
      await sleep(600);
      assert(!o.doc.getMap('comments').has('m:gt:fake'), 'a guest commented under a member’s name');
    });

    await check('the activity feed: one entry per burst from the server’s own record, guests included; hidden frames’ contents only for editors', async () => {
      // R (invited as commenter) stays a commenter: the link no longer gives everyone edit access.
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'commenter' })).status === 200, 'link to commenter');
      const o = withLayers(connectDoc(O, board.id));
      clients.push(o);
      await o.ready();
      o.askLayer('editors');
      els(o).set('f1', { id: 'f1', type: 'frame', x: 0, y: 0, w: 800, h: 600, title: 'Ideas', fill: '#fff', index: 1, frameId: null });
      await sleep(1600); // the frame's burst ends
      o.doc.transact(() => {
        for (const id of ['s1', 's2', 's3']) els(o).set(id, { id, type: 'sticky', x: 10, y: 10, w: 100, h: 100, frameId: 'f1', text: `<p>secret ${id}</p>` });
      });
      const feed = async (u) => (await u.req('GET', `/api/boards/${board.id}/activity`)).json?.entries ?? [];
      await waitFor(async () => (await feed(O)).some((e) => e.text === 'added 3 sticky notes in frame “Ideas”'), 8000, 'the sticky burst');
      // Hide the frame: its contents move into the editors layer (what editors' clients do).
      o.doc.transact(() => {
        els(o).set('f1', { ...els(o).get('f1'), hidden: true });
        for (const id of ['s1', 's2', 's3']) els(o).delete(id);
      });
      o.layers.editors.transact(() => {
        for (const id of ['s4', 's5']) o.layers.editors.getMap('elements').set(id, { id, type: 'sticky', x: 20, y: 20, w: 100, h: 100, frameId: 'f1', text: '<p>hidden</p>' });
      });
      await waitFor(async () => (await feed(O)).some((e) => e.text.includes('(hidden from viewers)')), 8000, 'the hidden-frame entry for the owner');
      const forR = await feed(R);
      const forGuest = await feed(G);
      for (const list of [forR, forGuest]) {
        assert(!list.some((e) => /hidden|removed/.test(e.text)), `leaked: ${JSON.stringify(list.map((e) => e.text))}`);
        assert(list.some((e) => e.actorName === 'Guest · Kim' && e.text === 'commented'), `no guest comment: ${JSON.stringify(list.map((e) => [e.actorName, e.text]))}`);
        assert(!JSON.stringify(list).includes('secret'), 'element text in the feed');
      }
      const ws = (await O.req('GET', '/api/workspaces')).json.workspaces.find((w) => w.kind === 'personal');
      const wsFeed = (await O.req('GET', `/api/workspaces/${ws.id}/activity`)).json.entries;
      assert(wsFeed.some((e) => e.boardTitle === 'Roadmap Q3' && e.actorName === O.name), JSON.stringify(wsFeed));
      assert((await M.req('GET', `/api/workspaces/${ws.id}/activity`)).status === 404, 'someone outside the workspace read its feed');
    });

    await check('the activity feed tells what happened to the board as a whole (KAI-188): created, renamed, moved to a project, a version restored, trashed and restored, and a copy names its original', async () => {
      const team = (await O.req('POST', '/api/workspaces', { name: 'Lifecycle team' })).json.workspace;
      const project = (await O.req('POST', `/api/workspaces/${team.id}/projects`, { name: 'Launch', access: 'workspace' })).json.project;
      const b = (await O.req('POST', '/api/boards', { title: 'Plan', workspaceId: team.id })).json.board;
      assert((await O.req('PATCH', `/api/boards/${b.id}`, { title: 'Plan v2' })).status === 200, 'rename');
      assert((await O.req('PATCH', `/api/boards/${b.id}`, { projectId: project.id })).status === 200, 'move');
      const v = (await O.req('POST', `/api/boards/${b.id}/versions`, { name: 'Kickoff' })).json.version;
      assert((await O.req('POST', `/api/boards/${b.id}/versions/${v.id}/restore`)).status === 200, 'restore version');
      const copy = (await O.req('POST', `/api/boards/${b.id}/duplicate`)).json.board;
      assert((await O.req('DELETE', `/api/boards/${b.id}`)).status < 300, 'trash');
      assert((await O.req('POST', `/api/boards/${b.id}/restore`)).status === 200, 'restore from trash');
      const feed = async (id) => (await O.req('GET', `/api/boards/${id}/activity`)).json.entries;
      const texts = (await feed(b.id)).filter((e) => e.kind === 'board' && e.actorName === O.name).map((e) => e.text);
      for (const t of [
        'created this board',
        'renamed the board to “Plan v2” (was “Plan”)',
        'moved the board to project “Launch”',
        'restored the version “Kickoff”',
        'moved the board to the trash',
        'restored the board from the trash',
      ])
        assert(texts.includes(t), `missing “${t}” in ${JSON.stringify(texts)}`);
      assert((await feed(copy.id)).some((e) => e.kind === 'board' && e.text === 'made this board as a copy of “Plan v2”'), 'copy entry');
    });

    await check('lowering a team’s access level to "can view" turns a connected member’s socket read-only at once', async () => {
      const team = (await O.req('POST', '/api/workspaces', { name: 'Verify team' })).json.workspace;
      assert((await O.req('POST', `/api/workspaces/${team.id}/members`, { email: M.email, role: 'member' })).status === 201, 'add member');
      const tb = (await O.req('POST', '/api/boards', { title: 'Team board', workspaceId: team.id })).json.board;
      const m = connectDoc(M, tb.id);
      clients.push(m);
      await m.ready();
      assert(m.role === 'editor', `member role ${m.role}`);
      assert((await O.req('PATCH', `/api/workspaces/${team.id}`, { policies: { teamAccess: 'viewer' } })).status === 200, 'policy');
      await waitFor(() => m.role === 'viewer', 5000, 'the member’s live role to drop to viewer');
      const members = (await O.req('GET', `/api/boards/${tb.id}/members`)).json.members;
      assert(members.find((x) => x.userId === M.id)?.role === 'viewer', JSON.stringify(members));
      // The audit log (KAI-48): the level change, an access request and its approval, a guest joining.
      await O.req('PATCH', `/api/boards/${tb.id}`, { linkAccess: 'viewer' });
      const joined = await new User('AuditGuest', port).req('POST', `/api/guest/boards/${tb.id}/join`, { name: 'Lee' });
      assert(joined.status === 201, joined.text);
      const privateProject = (await O.req('POST', `/api/workspaces/${team.id}/projects`, { name: 'Private', access: 'private' })).json.project;
      const pb = (await O.req('POST', '/api/boards', { title: 'Private board', workspaceId: team.id, projectId: privateProject.id })).json.board;
      assert((await M.req('POST', `/api/boards/${pb.id}/access-request`, { role: 'viewer' })).status === 201, 'request');
      assert((await O.req('POST', `/api/boards/${pb.id}/access-requests/${M.id}`, { decision: 'approve' })).status === 200, 'approve');
      const events = (await O.req('GET', `/api/workspaces/${team.id}/audit?limit=200`)).json.events;
      const has = (action, ok = () => true) => events.some((e) => e.action === action && ok(e));
      assert(has('workspace.policies_changed', (e) => e.metadata['teamAccess.to'] === 'viewer'), 'no team access level event');
      assert(has('board.guest_joined', (e) => e.actor === null && e.metadata.name === 'Lee'), 'no guest join event');
      assert(has('board.access_requested', (e) => e.actor?.id === M.id) && has('board.access_approved', (e) => e.actor?.id === O.id), 'no access request events');
    });

    await check('turning the link off drops a connected guest at once; guest joins are rate-limited per IP', async () => {
      const g = clients.find((c) => c.user === G);
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'none' })).status === 200, 'link off');
      await waitFor(() => g.closeCodes.includes(4403), 5000, 'the guest socket to close with 4403');
      assert((await G.req('GET', `/api/guest/boards/${board.id}/board`)).status === 403, 'the guest still opens the board');
      await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'viewer' });
      // Two joins so far from this address (Kim, and Lee in the team check): two more, then 429.
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await new User(`G${i}`, port).req('POST', `/api/guest/boards/${board.id}/join`, { name: `V${i}` })).status);
      assert(statuses.join(',') === '201,201,429', statuses.join(','));
    });

    await check('moderation and guests: a guest reports with a contact address; a link block and a take-down shut guests out live; visitors can’t report boards only signed-in people may open', async () => {
      const act = (body) => OP.req('POST', '/api/moderation/actions', { reason: 'spam', statement: 'Checked by verify.', ...body });
      // The board's link is "can view" again (previous check): the guest is back in.
      let g = connectDoc(G, board.id);
      clients.push(g);
      await g.ready();
      assert(g.role === 'viewer', `guest role ${g.role}`);
      const rep = await G.req('POST', '/api/reports', { boardId: board.id, target: { kind: 'board' }, reason: 'spam', note: 'from a guest', contactEmail: 'kim@example.com' });
      assert(rep.status === 202, rep.text);
      const q = (await OP.req('GET', '/api/moderation/queue')).json.items;
      assert(q.some((i) => i.boardId === board.id && i.contactEmail === 'kim@example.com' && i.reporter === null), JSON.stringify(q));

      assert((await act({ action: 'board.disable_link', targetId: board.id })).status === 200, 'link block');
      await waitFor(() => g.closeCodes.includes(4403), 5000, 'the guest socket to close when the link is blocked');
      assert((await G.req('GET', `/api/guest/boards/${board.id}/board`)).status === 403, 'a guest opened a board whose link is blocked');
      assert((await new User('Late', port).req('GET', `/api/guest/boards/${board.id}`)).json?.allowed === false, 'guests still offered on a blocked link');
      assert((await act({ action: 'board.restore_link', targetId: board.id })).status === 200, 'link restored');

      g = connectDoc(G, board.id);
      clients.push(g);
      await g.ready();
      assert((await act({ action: 'board.take_down', targetId: board.id })).status === 200, 'take down');
      await waitFor(() => g.closeCodes.includes(4451), 5000, 'the guest socket to close as removed (4451)');
      assert((await G.req('GET', `/api/guest/boards/${board.id}/board`)).status === 451, 'the guest page does not say the board was removed');
      assert((await wsCloseCode(board.id, G.cookie, port)) === 4451, 'a guest socket reached a taken-down board');
      assert((await act({ action: 'board.restore', targetId: board.id })).status === 200, 'restore');

      // A team that requires sign-in for links: an anonymous visitor can't report what they can't open.
      const closed = (await O.req('POST', '/api/workspaces', { name: 'Signed-in only' })).json.workspace;
      await O.req('PATCH', `/api/workspaces/${closed.id}`, { policies: { publicLinks: 'signedIn' } });
      const cb = (await O.req('POST', '/api/boards', { title: 'Members only', workspaceId: closed.id })).json.board;
      await O.req('PATCH', `/api/boards/${cb.id}`, { linkAccess: 'viewer' });
      const anon = await new User('Anon', port).req('POST', '/api/reports', { boardId: cb.id, target: { kind: 'board' }, reason: 'spam' });
      assert(anon.status === 404, `anonymous report on a sign-in-only board -> ${anon.status}`);
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
// Enterprise admin (KAI-47, KAI-48, KAI-51), on its own server: the audit log written by real
// sign-ins and team changes, read and exported only by the workspace's owners/admins; the
// two-step requirement and deactivation closing the team's boards (REST and sockets); exports
// reported by the app; an operator's reset from the CLI landing in the team's log.
// ---------------------------------------------------------------------------
async function enterpriseAdminChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-admin-'));
  const env = { RATE_LIMIT_TWO_FACTOR: '200/15m', RATE_LIMIT_LOGIN: '500/5m', RATE_LIMIT_LOGIN_ACCOUNT: '500/5m', RATE_LIMIT_INVITE: '500/1h' };
  let proc = null;
  const start = async () => (proc = await waitUp(await spawnServer(dataDir, env)));
  const socketClose = (port, boardId, cookie) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/boards/${boardId}`, { headers: { cookie } });
      const t = setTimeout(() => {
        ws.terminate();
        resolve('open');
      }, 4000);
      ws.on('close', (code) => {
        clearTimeout(t);
        resolve(code);
      });
      ws.on('error', () => {});
    });
  try {
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('admin server boots', start))) return;
    const stamp = Date.now();
    const verified = async (label) => {
      const u = new User(label, proc.port);
      u.email = `${label.toLowerCase()}-${stamp}@admin.verify.freero.app`;
      await u.signup();
      await u.verifyEmail(dataDir);
      return u;
    };
    const enrol = async (u) => {
      const setup = await u.req('POST', '/api/auth/two-factor/setup', { password: 'password-123' });
      const enable = await u.req('POST', '/api/auth/two-factor/enable', { code: await totpCode({ secret: setup.json.secret }) });
      assert(enable.status === 200, `enable: ${enable.text}`);
    };
    const O = await verified('Owner');
    const M = await verified('Member');
    const G = await verified('Guest');
    const ws = (await O.req('POST', '/api/workspaces', { name: 'Audited team' })).json.workspace.id;
    for (const [u, role] of [
      [M, 'member'],
      [G, 'guest'],
    ])
      assert((await O.req('POST', `/api/workspaces/${ws}/members`, { email: u.email, role })).status === 201, `add ${u.label}`);
    const board = (await O.req('POST', '/api/boards', { title: 'Plans', workspaceId: ws })).json.board.id;
    const audit = async (query = '') => (await O.req('GET', `/api/workspaces/${ws}/audit?limit=200${query}`)).json.events;

    await check('the audit log records real sign-ins, failed sign-ins and role changes of the team, with who, from where and what changed', async () => {
      assert((await new User('x', proc.port).req('POST', '/api/auth/login', { email: M.email, password: 'wrong-password' })).status === 401, 'bad password accepted');
      const again = new User('Member again', proc.port);
      assert((await again.req('POST', '/api/auth/login', { email: M.email, password: 'password-123' }, { headers: { 'user-agent': 'VerifyBrowser/1.0' } })).status === 200, 'login');
      assert((await O.req('PATCH', `/api/workspaces/${ws}/members/${M.id}`, { role: 'admin' })).status === 200, 'role change');
      assert((await O.req('PATCH', `/api/workspaces/${ws}/members/${M.id}`, { role: 'member' })).status === 200, 'role back');
      const events = await audit();
      const failed = events.find((e) => e.action === 'auth.login_failed' && e.target?.id === M.id);
      assert(failed && failed.actor === null && failed.metadata.reason === 'password' && failed.ip, `failed sign-in: ${JSON.stringify(failed)}`);
      const login = events.find((e) => e.action === 'auth.login' && e.actor?.id === M.id && e.userAgent === 'VerifyBrowser/1.0');
      assert(login && login.metadata.method === 'password', `sign-in: ${JSON.stringify(events.filter((e) => e.action === 'auth.login'))}`);
      const promoted = events.find((e) => e.action === 'member.role_changed' && e.metadata.to === 'admin');
      assert(promoted && promoted.actor.id === O.id && promoted.metadata.from === 'member' && promoted.target.label === M.email, `role change: ${JSON.stringify(promoted)}`);
      // A guest's own sign-ins stay theirs: not in the team's log.
      await new User('Guest again', proc.port).req('POST', '/api/auth/login', { email: G.email, password: 'password-123' });
      assert(!(await audit('&action=auth.')).some((e) => e.actor?.id === G.id), "a guest's sign-in reached the team's log");
    });

    await check('only owners/admins of that workspace read its audit log, usage and settings; the export is CSV/JSON, formula-safe and itself audited; the chain verifies', async () => {
      for (const url of [`/api/workspaces/${ws}/audit`, `/api/workspaces/${ws}/admin/usage`, `/api/workspaces/${ws}/admin/settings`, `/api/workspaces/${ws}/audit/export`]) {
        const r = await M.req('GET', url);
        assert(r.status === 403, `member reads ${url}: ${r.status}`);
      }
      const outsider = await verified('Outsider');
      assert((await outsider.req('GET', `/api/workspaces/${ws}/audit`)).status === 404, 'outsider reached the log');
      assert((await O.req('PATCH', `/api/boards/${board}`, { title: '=HYPERLINK("http://x","y")' })).status === 200, 'rename');
      assert((await O.req('DELETE', `/api/boards/${board}`)).status === 200 && (await O.req('POST', `/api/boards/${board}/restore`)).status === 200, 'trash + restore');
      const csv = await O.req('GET', `/api/workspaces/${ws}/audit/export?format=csv`);
      assert(csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && /attachment; filename="freero-audit-audited-team-/.test(csv.headers.get('content-disposition')), `csv headers: ${csv.status}`);
      const lines = csv.text.trim().split('\n');
      assert(lines[0].startsWith('id,time,action,description,actor_id') && lines.some((l) => l.includes(',board.trashed,')), `csv rows: ${lines.slice(0, 3).join(' | ')}`);
      assert(!lines.some((l) => /,=HYPERLINK/.test(l) || /,"=HYPERLINK/.test(l)), 'a formula reached the CSV unescaped');
      const json = await O.req('GET', `/api/workspaces/${ws}/audit/export?format=json&action=board.`);
      assert(json.status === 200 && Array.isArray(json.json) && json.json.length > 0 && json.json.every((e) => e.action.startsWith('board.')), `json export: ${json.text.slice(0, 200)}`);
      const exported = (await audit('&action=audit.exported')).filter((e) => e.actor?.id === O.id);
      assert(exported.length === 2 && exported.some((e) => e.metadata.format === 'json' && e.metadata.actions?.[0] === 'board.'), `export not audited: ${JSON.stringify(exported)}`);
      const integrity = (await O.req('GET', `/api/workspaces/${ws}/audit/integrity`)).json.integrity;
      assert(integrity.ok && integrity.events > 5 && /^[0-9a-f]{64}$/.test(integrity.headHash), `integrity: ${JSON.stringify(integrity)}`);
      const usage = (await O.req('GET', `/api/workspaces/${ws}/admin/usage`)).json.usage;
      assert(usage.boards === 1 && usage.members.owner === 1 && usage.members.member === 1 && usage.members.guest === 1, `usage: ${JSON.stringify(usage)}`);
    });

    await check('requiring two-step verification closes the team\'s boards to members without it (REST and sockets), keeps them from turning it off, and needs it on for whoever sets it', async () => {
      const needOwn = await O.req('PATCH', `/api/workspaces/${ws}/admin/settings`, { requireTwoFactor: true });
      assert(needOwn.status === 403, `set without own two-step: ${needOwn.status}`);
      await enrol(O);
      assert((await O.req('PATCH', `/api/workspaces/${ws}/admin/settings`, { requireTwoFactor: true })).json.settings.requireTwoFactor === true, 'setting not saved');
      assert((await M.req('GET', `/api/boards/${board}`)).status === 403, 'member without two-step still opens the board');
      assert((await socketClose(proc.port, board, M.cookie)) === 4403, 'socket admitted without two-step');
      const listed = (await M.req('GET', '/api/workspaces')).json.workspaces.find((w) => w.id === ws);
      assert(listed.blocked === 'two_factor_required', `blocked: ${listed.blocked}`);
      await enrol(M);
      assert((await M.req('GET', `/api/boards/${board}`)).status === 200, 'member with two-step still locked out');
      const off = await M.req('POST', '/api/auth/two-factor/disable', { password: 'password-123', code: '000000' });
      assert(off.status === 409 && /Audited team requires two-step verification/.test(off.text), `turned off: ${off.status} ${off.text}`);
      assert((await O.req('PATCH', `/api/workspaces/${ws}/admin/settings`, { requireTwoFactor: false })).status === 200, 'unset');
    });

    await check('a deactivated member opens nothing in the workspace until reactivated, while others keep working; deactivation is audited', async () => {
      const r = await O.req('POST', `/api/workspaces/${ws}/admin/members/${M.id}/deactivate`);
      assert(r.status === 200 && r.json.member.deactivated === true, `deactivate: ${r.text}`);
      assert((await M.req('GET', `/api/boards/${board}`)).status === 403, 'deactivated member opens the board');
      assert((await socketClose(proc.port, board, M.cookie)) === 4403, 'deactivated member socket admitted');
      assert((await M.req('POST', '/api/boards', { title: 'x', workspaceId: ws })).status === 403, 'deactivated member creates boards');
      assert((await O.req('GET', `/api/boards/${board}`)).status === 200, 'owner locked out');
      assert((await O.req('POST', `/api/workspaces/${ws}/admin/members/${M.id}/reactivate`)).status === 200, 'reactivate');
      assert((await M.req('GET', `/api/boards/${board}`)).status === 200, 'reactivated member still locked out');
      const evs = await audit('&action=member.deactivated,member.reactivated');
      assert(evs.length === 2 && evs.every((e) => e.actor.id === O.id && e.target.id === M.id), `audit: ${JSON.stringify(evs)}`);
    });

    await check('exports the app reports are audited, and refused when the downloads policy forbids them', async () => {
      assert((await M.req('POST', `/api/boards/${board}/exported`, { format: 'pdf' })).status === 200, 'report');
      assert((await O.req('PATCH', `/api/workspaces/${ws}`, { policies: { downloads: 'admins' } })).status === 200, 'policy');
      assert((await M.req('POST', `/api/boards/${board}/exported`, { format: 'png' })).status === 403, 'member export allowed by a policy that forbids it');
      const evs = await audit('&action=board.exported');
      assert(evs.length === 1 && evs[0].actor.id === M.id && evs[0].metadata.format === 'pdf', `exports: ${JSON.stringify(evs)}`);
    });

    await check("operator CLI: a two-step reset lands in the team's audit log naming the operator, and audit:verify re-checks the chain", async () => {
      const cli = (...args) =>
        spawnSync(process.execPath, ['--import', 'tsx', 'apps/server/src/admin.ts', ...args], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, ...env, FREERO_DATA_DIR: dataDir, NODE_ENV: 'test', SESSION_SECRET: RUN_SECRET, LOG_LEVEL: 'warn' },
          timeout: 60_000,
        });
      await stopProc(proc); // PGlite is one process (on Postgres the CLI could run alongside)
      const reset = cli('two-factor:reset', M.email, '--operator', 'Sam from support', '--reason', 'ticket 42', '--yes');
      assert(reset.status === 0, `reset: ${reset.status} ${reset.stdout} ${reset.stderr}`);
      const verify = cli('audit:verify', ws);
      assert(verify.status === 0 && /intact\s+yes/.test(verify.stdout), `audit:verify: ${verify.status} ${verify.stdout} ${verify.stderr}`);
      await start();
      O.port = proc.port; // sessions are in the database: the owner is still signed in
      const ev = (await audit('&action=auth.two_factor.')).find((e) => e.action === 'auth.two_factor.reset_by_operator');
      assert(ev && ev.actor === null && ev.metadata.operator === 'Sam from support' && ev.metadata.reason === 'ticket 42' && ev.target.id === M.id, `operator event: ${JSON.stringify(ev)}`);
    });
  } finally {
    if (proc) await stopProc(proc);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Abuse reports and operator moderation (KAI-142): reports from people who can open a board (and
// only them), the operator queue, and every action enforced live — a link turned off drops
// link-only sockets, a taken-down board closes and refuses everyone, a removed file answers 410
// (also after the uploads sweep ran), a suspended account is locked out at once — plus appeals.
// ---------------------------------------------------------------------------

/** The newest /appeal?t= link mailed to `to` (the notice an action sends), waiting for it. */
async function mailedAppealToken(dataDir, to, after = 0) {
  let token = null;
  await waitFor(
    () => {
      const m = outbox(dataDir)
        .filter((mail) => mail.to === to && mail.sentAt >= after - 50)
        .map((mail) => /\/appeal\?t=([A-Za-z0-9_.%-]+)/.exec(mail.text))
        .filter(Boolean)
        .at(-1);
      token = m ? decodeURIComponent(m[1]) : null;
      return token !== null;
    },
    8000,
    `an appeal link mailed to ${to}`,
  );
  return token;
}

async function moderationChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-moderation-'));
  const outerDbUrl = db.url;
  const Op = new User('Operator'); // listed and verified: an operator
  const Fake = new User('FakeOp'); // listed but never verified: not an operator
  const O = new User('ModOwner');
  const M = new User('ModMember'); // invited editor
  const L = new User('ModLink'); // reaches boards only through their links
  const S = new User('ModStranger');
  const REPORT_LIMIT = 8;
  const env = {
    OPERATOR_EMAILS: `${Op.email}, ${Fake.email}`,
    ABUSE_CONTACT_EMAIL: 'abuse@verify.freero.app',
    RATE_LIMIT_REPORT: `${REPORT_LIMIT}/1h`,
  };
  const boot = async () => {
    server = await spawnServer(dataDir, env);
    return waitUp(server);
  };
  const act = (body) => Op.req('POST', '/api/moderation/actions', { reason: 'spam', statement: 'Checked by verify.', ...body });
  const fileStatus = async (url) => (await fetch(`http://127.0.0.1:${server.port}${url}`, { redirect: 'manual' })).status;
  try {
    if (ADMIN_URL) db.url = await createDatabase();
    if (!(await check('moderation: server boots with operators configured', boot))) return;
    for (const u of [Op, Fake, O, M, L, S]) await u.signup();
    await Op.verifyEmail(dataDir);
    await O.verifyEmail(dataDir); // sharing by link needs a verified address

    const board = async (title, linkAccess = 'viewer') => {
      const b = (await O.req('POST', '/api/boards', { title })).json.board;
      assert((await O.req('PATCH', `/api/boards/${b.id}`, { linkAccess })).status === 200, 'share by link');
      assert((await O.req('POST', `/api/boards/${b.id}/members`, { email: M.email, role: 'editor' })).status === 201, 'invite member');
      return b;
    };

    await check('moderation: /.well-known/security.txt names the abuse contact and an expiry', async () => {
      const r = await fetch(`http://127.0.0.1:${server.port}/.well-known/security.txt`);
      const text = await r.text();
      assert(r.status === 200 && /^Contact: mailto:abuse@verify\.freero\.app$/m.test(text) && /^Expires: \d{4}-/m.test(text), `${r.status} ${text}`);
    });

    let reported = null;
    await check('moderation: a report on a private board gets exactly the answer an unknown board gets; anyone who can open a board — signed out too — can report it', async () => {
      const hidden = (await O.req('POST', '/api/boards', { title: 'Private' })).json.board;
      reported = await board('Reported');
      const body = (boardId) => ({ boardId, target: { kind: 'board' }, reason: 'spam', note: 'ads everywhere' });
      const unknown = await S.req('POST', '/api/reports', body('zzzzzzzzzz'));
      const priv = await S.req('POST', '/api/reports', body(hidden.id));
      assert(unknown.status === 404 && priv.status === unknown.status && priv.text === unknown.text, `${unknown.status} ${unknown.text} / ${priv.status} ${priv.text}`);
      assert((await L.req('POST', '/api/reports', body(reported.id))).status === 202, 'link visitor report');
      const anon = await L.req('POST', '/api/reports', { ...body(reported.id), target: { kind: 'element', id: 'el1' }, contactEmail: 'someone@example.com' }, { cookie: false });
      assert(anon.status === 202, `signed-out report -> ${anon.status} ${anon.text}`);
    });

    await check('moderation: operators only — others (including an unverified account with an operator address) get 404 from the queue; the operator sees the reports with reporter, reason and note', async () => {
      for (const u of [S, Fake, O]) assert((await u.req('GET', '/api/moderation/queue')).status === 404, `${u.label} reached the queue`);
      assert((await Fake.req('GET', '/api/moderation/access')).json?.operator === false, 'an unverified address counts as operator');
      const q = await Op.req('GET', '/api/moderation/queue');
      assert(q.status === 200, q.text);
      const mine = q.json.items.filter((i) => i.boardId === reported.id);
      const byLink = mine.find((i) => i.reporter?.id === L.id);
      assert(byLink?.reason === 'spam' && byLink.message === 'ads everywhere' && byLink.board?.owner?.id === O.id, JSON.stringify(mine));
      assert(mine.some((i) => i.reporter === null && i.contactEmail === 'someone@example.com' && i.target.id === 'el1'), 'the signed-out report is missing');
      const preview = await fetch(`http://127.0.0.1:${server.port}/api/moderation/boards/${reported.id}/preview`, { headers: { cookie: Op.cookie } });
      assert(preview.status === 200 && preview.headers.get('content-type')?.includes('octet-stream'), `preview -> ${preview.status}`);
    });

    await check('moderation: turning a board’s link off drops link-only sockets live, members keep editing, the owner can’t turn it back on and is emailed an appeal link', async () => {
      const b = await board('Phishing', 'editor');
      const viaLink = connectDoc(L, b.id);
      const member = connectDoc(M, b.id);
      const owner = connectDoc(O, b.id);
      await Promise.all([viaLink.ready(), member.ready(), owner.ready()]);
      const since = Date.now();
      const r = await act({ action: 'board.disable_link', targetId: b.id, reason: 'phishing', statement: 'A login form copying a bank.' });
      assert(r.status === 200, r.text);
      await waitFor(() => viaLink.closeCodes.includes(4403), 5000, 'the link-only socket to close');
      els(member).set('after', { id: 'after', type: 'sticky', text: 'member still edits' });
      await waitFor(() => els(owner).get('after')?.text === 'member still edits', 5000, 'the member edit to reach the owner');
      const patch = await O.req('PATCH', `/api/boards/${b.id}`, { linkAccess: 'viewer' });
      assert(patch.status === 403 && patch.json?.code === 'link_blocked', `owner re-enabled the link: ${patch.status} ${patch.text}`);
      assert((await L.req('GET', `/api/boards/${b.id}`)).status === 403, 'the link still opens the board');
      const token = await mailedAppealToken(dataDir, O.email, since);
      const info = await O.req('GET', `/api/appeals/${encodeURIComponent(token)}`, undefined, { cookie: false });
      assert(info.status === 200 && info.json.appeal.action === 'board.disable_link', info.text);
      for (const c of [viaLink, member, owner]) c.destroy();
    });

    let downBoard = null;
    await check('moderation: a taken-down board closes every socket (4451), refuses to reopen (REST 451 for people who had access, 404 for others), leaves every list, and its public link is dead', async () => {
      downBoard = await board('Taken down');
      const owner = connectDoc(O, downBoard.id);
      const member = connectDoc(M, downBoard.id);
      const viaLink = connectDoc(L, downBoard.id);
      await Promise.all([owner.ready(), member.ready(), viaLink.ready()]);
      els(owner).set('keep', { id: 'keep', type: 'sticky', text: 'kept for review' });
      await waitFor(() => els(member).get('keep'), 5000, 'the edit to sync');
      const r = await act({ action: 'board.take_down', targetId: downBoard.id, statement: 'Spam campaign.' });
      assert(r.status === 200, r.text);
      for (const c of [owner, member, viaLink]) await waitFor(() => c.closeCodes.includes(4451), 5000, `${c.user.label}'s socket to close with 4451`);
      for (const u of [O, M, L]) {
        const g = await u.req('GET', `/api/boards/${downBoard.id}`);
        assert(g.status === 451 && g.json?.code === 'board_removed', `${u.label} GET -> ${g.status} ${g.text}`);
        assert((await wsCloseCode(downBoard.id, u.cookie)) === 4451, `${u.label} could reconnect`);
      }
      // Anyone signed in holds a link-shared board's link; a PRIVATE board taken down stays unknown to outsiders.
      const privateDown = (await O.req('POST', '/api/boards', { title: 'Private, taken down' })).json.board;
      assert((await act({ action: 'board.take_down', targetId: privateDown.id, statement: 'Spam.' })).status === 200, 'take down private');
      const outsider = await S.req('GET', `/api/boards/${privateDown.id}`);
      const unknown = await S.req('GET', '/api/boards/zzzzzzzzzz');
      assert(outsider.status === 404 && outsider.text === unknown.text, `a stranger learns the board exists: ${outsider.status} ${outsider.text}`);
      assert(!titles(await O.req('GET', '/api/boards')).includes(downBoard.id), 'still in the owner’s list');
      assert((await O.req('DELETE', `/api/boards/${downBoard.id}`)).status === 451, 'the owner could trash it');
      for (const c of [owner, member, viaLink]) c.destroy();
    });

    await check('moderation: restoring the taken-down board brings it back as it was, and the history records both actions with the operator', async () => {
      assert((await act({ action: 'board.restore', targetId: downBoard.id, statement: '' })).status === 200, 'restore');
      const back = connectDoc(M, downBoard.id);
      await back.ready();
      assert(els(back).get('keep')?.text === 'kept for review', 'content lost while taken down');
      back.destroy();
      const h = await Op.req('GET', `/api/moderation/boards/${downBoard.id}`);
      const kinds = h.json.actions.map((a) => `${a.action}:${a.operator?.id === Op.id}`);
      assert(kinds.includes('board.take_down:true') && kinds.includes('board.restore:true'), JSON.stringify(kinds));
    });

    let removed = null;
    let unused = null; // never placed anywhere: the sweep deletes it, which proves a round ran
    await check('moderation: a removed upload answers 410 at once (also to its uploader) and its owner is told', async () => {
      const up = await O.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
      removed = up.json.url;
      unused = (await O.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).json.url;
      const b = (await O.req('POST', '/api/boards', { title: 'With image' })).json.board;
      const c = connectDoc(O, b.id);
      await c.ready();
      els(c).set('img', { id: 'img', type: 'image', x: 0, y: 0, w: 10, h: 10, src: removed });
      await sleep(200);
      c.destroy();
      assert((await fileStatus(removed)) === 200, 'upload not served');
      const since = Date.now();
      const r = await act({ action: 'upload.remove', targetId: removed, reason: 'illegal', statement: 'Unlawful image.', boardId: b.id });
      assert(r.status === 200, r.text);
      assert((await fileStatus(removed)) === 410, `removed file -> ${await fileStatus(removed)}`);
      await mailedAppealToken(dataDir, O.email, since);
    });

    await check('moderation: a sweep round days later neither resurrects the removed file nor forgets it (still 410); restoring serves the same bytes again', async () => {
      await stopServer();
      // Days pass: age every upload so the sweep that runs at startup considers all of them.
      await withDb(dataDir, (q) =>
        q(`UPDATE uploads SET created_at = created_at - interval '5 days', last_referenced_at = last_referenced_at - interval '5 days'`),
      );
      await boot();
      await waitFor(async () => (await fileStatus(unused)) === 404, 15_000, 'the startup sweep round to delete the unused upload');
      assert((await fileStatus(removed)) === 410, `after the sweep -> ${await fileStatus(removed)}`);
      // Sessions survive the restart (cookies); restore through the operator.
      const r = await act({ action: 'upload.restore', targetId: removed, statement: '' });
      assert(r.status === 200, r.text);
      const res = await fetch(`http://127.0.0.1:${server.port}${removed}`);
      assert(res.status === 200 && Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG_1PX) === 0, `restored -> ${res.status}`);
    });

    await check('moderation: suspending an account locks it out live — board and notification sockets close, REST is signed out, sign-in is refused — and its notice’s appeal link works signed out and reaches the queue', async () => {
      const b = (await M.req('POST', '/api/boards', { title: 'Member board' })).json.board;
      const live = connectDoc(M, b.id);
      await live.ready();
      const bell = notificationsSocket(M, server.port);
      await waitFor(() => bell.ws.readyState === WebSocket.OPEN, 5000, 'the bell socket to open');
      const since = Date.now();
      const r = await act({ action: 'user.suspend', targetId: M.id, reason: 'harassment', statement: 'Repeated abuse in comments.' });
      assert(r.status === 200, r.text);
      await waitFor(() => live.closeCodes.includes(4401), 5000, 'the board socket to close');
      await waitFor(() => bell.closeCode !== null, 5000, 'the bell socket to close');
      assert((await M.req('GET', '/api/auth/me')).status === 401, 'still signed in');
      const login = await M.req('POST', '/api/auth/login', { email: M.email, password: 'password-123' });
      assert(login.status === 403 && login.json?.code === 'account_suspended', `login -> ${login.status} ${login.text}`);
      const token = await mailedAppealToken(dataDir, M.email, since);
      const appeal = await M.req('POST', '/api/appeals', { token, message: 'That was not me.' }, { cookie: false });
      assert(appeal.status === 202, appeal.text);
      assert((await M.req('POST', '/api/appeals', { token, message: 'Again' }, { cookie: false })).status === 409, 'a second open appeal');
      const q = await Op.req('GET', '/api/moderation/queue');
      assert(q.json.items.some((i) => i.kind === 'appeal' && i.reporter?.id === M.id && i.message === 'That was not me.'), 'appeal not in the queue');
      live.destroy();
      bell.ws.close();

      assert((await act({ action: 'user.restore', targetId: M.id, statement: '' })).status === 200, 'lift');
      assert((await M.req('POST', '/api/auth/login', { email: M.email, password: 'password-123' })).status === 200, 'login after the suspension was lifted');
    });

    await check('moderation (KAI-180): suspending with "take its boards down" closes every board the account owns to its link visitors at once, each recorded; lifting the suspension opens them again', async () => {
      const boards = [];
      for (const title of ['Spam 1', 'Spam 2']) boards.push(await board(title));
      const visitor = connectDoc(L, boards[0].id);
      await visitor.ready();
      const r = await act({ action: 'user.suspend', targetId: O.id, statement: 'Spam account.', boards: 'take_down' });
      assert(r.status === 200, r.text);
      await waitFor(() => visitor.closeCodes.includes(4451), 5000, "the link visitor's socket to close as removed");
      for (const b of boards) assert((await L.req('GET', `/api/boards/${b.id}`)).status === 451, `${b.title} still open to its link`);
      const history = (await Op.req('GET', `/api/moderation/boards/${boards[1].id}`)).json.actions;
      assert(history.some((a) => a.action === 'board.take_down' && a.parentId === r.json.action.id && a.subject?.email === O.email), JSON.stringify(history));
      visitor.destroy();
      assert((await act({ action: 'user.restore', targetId: O.id, statement: '' })).status === 200, 'lift');
      for (const b of boards) assert((await L.req('GET', `/api/boards/${b.id}`)).status === 200, `${b.title} not back after the lift`);
      assert((await O.req('POST', '/api/auth/login', { email: O.email, password: 'password-123' })).status === 200, 'owner signs in again');
    });

    await check('moderation (KAI-178): a team workspace holding a taken-down board cannot be deleted; once the operator deletes the board for good, it can', async () => {
      const team = (await O.req('POST', '/api/workspaces', { name: 'Held team' })).json.workspace;
      const b = (await O.req('POST', '/api/boards', { title: 'Held', workspaceId: team.id })).json.board;
      assert(b?.workspaceId === team.id, `board in team: ${JSON.stringify(b)}`);
      assert((await act({ action: 'board.take_down', targetId: b.id, reason: 'illegal', statement: 'Unlawful content.' })).status === 200, 'take down');
      const refused = await O.req('DELETE', `/api/workspaces/${team.id}`, { confirm: 'Held team' });
      assert(refused.status === 409 && refused.json?.code === 'workspace_board_held', `${refused.status} ${refused.text}`);
      assert((await Op.req('GET', `/api/moderation/boards/${b.id}`)).status === 200, 'the held board is gone');
      assert((await act({ action: 'board.delete', targetId: b.id, reason: 'illegal', statement: 'Deleted after review.' })).status === 200, 'delete for good');
      assert((await Op.req('GET', `/api/moderation/boards/${b.id}`)).status === 404, 'the board survived its deletion');
      const deleted = await O.req('DELETE', `/api/workspaces/${team.id}`, { confirm: 'Held team' });
      assert(deleted.status === 200 || deleted.status === 204, `${deleted.status} ${deleted.text}`);
    });

    await check('moderation (KAI-177): uploads are cached for an hour, then revalidated cheaply (304 by ETag) — and a browser revalidating a file removed meanwhile gets 410, not its copy', async () => {
      const url = (await O.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).json.url;
      const get = (headers = {}) => fetch(`http://127.0.0.1:${server.port}${url}`, { headers, redirect: 'manual' });
      const first = await get();
      const etag = first.headers.get('etag');
      assert(first.status === 200 && first.headers.get('cache-control') === 'public, max-age=3600' && etag, `${first.status} ${first.headers.get('cache-control')} ${etag}`);
      assert((await get({ 'if-none-match': etag })).status === 304, 'revalidation is not a 304');
      assert((await act({ action: 'upload.remove', targetId: url, reason: 'illegal', statement: 'Unlawful image.' })).status === 200, 'remove');
      const again = await get({ 'if-none-match': etag });
      assert(again.status === 410 && again.headers.get('cache-control') === 'no-store', `after removal: ${again.status} ${again.headers.get('cache-control')}`);
    });

    await check('moderation (KAI-179): with MODERATION_KEEP_REMOVED_DAYS=0 the retention job deletes the kept copy of a removed file (the URL stays 410); one with an open report is kept', async () => {
      await stopServer();
      env.MODERATION_KEEP_REMOVED_DAYS = '0';
      env.MODERATION_RETENTION_INTERVAL_SECONDS = '1';
      await boot();
      const upload = async () => (await O.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } })).json.url.slice('/uploads/'.length);
      const [expiring, contested] = [await upload(), await upload()];
      const shown = await board('Shows the contested file');
      // Under review before it is removed: the job (every second) never races the report.
      const reportFile = await L.req('POST', '/api/reports', { boardId: shown.id, target: { kind: 'upload', id: contested }, reason: 'copyright' });
      assert(reportFile.status === 202 || reportFile.status === 200, `report: ${reportFile.status} ${reportFile.text}`);
      for (const name of [contested, expiring]) assert((await act({ action: 'upload.remove', targetId: name, reason: 'illegal', statement: 'Unlawful image.' })).status === 200, 'remove');
      const file = async (name) => (await Op.req('GET', `/api/moderation/uploads/${name}`)).json.upload;
      await waitFor(async () => (await file(expiring))?.restorable === false, 8000, 'the retention job to delete the kept copy');
      assert((await fileStatus(`/uploads/${expiring}`)) === 410, 'the removed file is not 410 any more');
      assert((await file(contested))?.restorable === true, 'the kept copy of a file under appeal was deleted');
      delete env.MODERATION_KEEP_REMOVED_DAYS;
      delete env.MODERATION_RETENTION_INTERVAL_SECONDS;
    });

    await check('moderation: reports are rate-limited per address (429 with Retry-After)', async () => {
      let last = null;
      for (let i = 0; i < REPORT_LIMIT + 2 && last?.status !== 429; i++)
        last = await S.req('POST', '/api/reports', { boardId: reported.id, target: { kind: 'element', id: `flood${i}` }, reason: 'spam' }, { cookie: false });
      assert(last?.status === 429 && last.headers.get('retry-after'), `no 429: ${last?.status}`);
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

// ---------------------------------------------------------------------------
// AI (KAI-101, KAI-102): off unless configured; with a provider, the four board actions against a
// local mock model (scripts/lib/mock-model.mjs, never a paid API), workspace admin controls, the
// workspace's own key, rate limit, budget and audit.
// ---------------------------------------------------------------------------
async function aiChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-ai-'));
  const model = await startMockModel();
  let proc = null;
  const AI_LIMIT = 6;
  try {
    const env = {};
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const boot = async (extra) => {
      if (proc) await stopProc(proc);
      proc = await waitUp(await spawnServer(dataDir, { ...env, ...extra }));
      server = proc;
    };
    if (!(await check('ai: server without AI configured boots', () => boot({})))) return;
    const O = new User('AiOwner', proc.port);
    const M = new User('AiMember', proc.port);
    for (const u of [O, M]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const personal = (await O.req('POST', '/api/boards', { title: 'AI personal' })).json.board;

    await check('ai: with no AI configured, the board status says so ({ ai: null }), the AI actions do not exist (404) and nothing reaches a model', async () => {
      const status = await O.req('GET', `/api/boards/${personal.id}/ai`);
      const run = await O.req('POST', `/api/boards/${personal.id}/ai/actions`, { task: 'ideas', prompt: 'x' });
      assert(status.status === 200 && status.json?.ai === null && run.status === 404, `${status.status} ${status.text} ${run.status}`);
      assert(model.requests.length === 0, 'the model was called');
    });

    const aiEnv = {
      AI_PROVIDER: 'openai',
      AI_BASE_URL: `${model.url}/instance/v1`,
      AI_MODEL: 'mock-instance',
      AI_API_KEY: 'instance-secret-key',
      AI_INSTANCE_FOR: 'personal,teams',
      AI_WORKSPACE_KEYS: 'true',
      AI_WORKSPACE_PRIVATE_ENDPOINTS: 'true', // the mock listens on 127.0.0.1
      RATE_LIMIT_AI: `${AI_LIMIT}/1m`,
    };
    if (!(await check('ai: server with a provider boots', () => boot(aiEnv)))) return;
    for (const u of [O, M]) u.port = proc.port;
    const outlineCount = async (u, boardId) => (await u.req('GET', `/api/boards/${boardId}/outline`)).json.outline.meta.itemCount;

    await check('ai: a preview writes nothing; the same action on the board lands as one attributed change a connected collaborator receives live', async () => {
      const st = (await O.req('GET', `/api/boards/${personal.id}/ai`)).json.ai;
      assert(st?.available === true && !JSON.stringify(st).includes('instance-secret-key'), JSON.stringify(st));
      const preview = await O.req('POST', `/api/boards/${personal.id}/ai/actions`, { task: 'ideas', prompt: 'Icebreakers for a retro' });
      assert(preview.status === 200 && preview.json.snapshot.elements.filter((e) => e.type === 'sticky').length === 8, `${preview.status} ${preview.text.slice(0, 300)}`);
      assert((await outlineCount(O, personal.id)) === 0, 'the preview was written');
      const live = connectDoc(O, personal.id);
      await live.ready();
      const written = await O.req('POST', `/api/boards/${personal.id}/ai/actions`, { task: 'ideas', prompt: 'Icebreakers for a retro', target: 'board' });
      assert(written.status === 201, `${written.status} ${written.text}`);
      const els = live.doc.getMap('elements');
      await waitFor(() => written.json.created.every((id) => els.has(id)), 8000, 'the AI stickies on the live socket');
      assert(written.json.created.every((id) => els.get(id).createdBy === O.id), 'not attributed to the person who asked');
      const call = model.requests.at(-1);
      assert(call.path === '/instance/v1/chat/completions' && call.headers.authorization === 'Bearer instance-secret-key', `${call.path} ${call.headers.authorization}`);
      live.destroy();
    });

    // A team board with a member's notes (laid out by insert-structure), AI off until an admin turns it on.
    const team = (await O.req('POST', '/api/workspaces', { name: 'AI team' })).json.workspace;
    assert((await O.req('POST', `/api/workspaces/${team.id}/members`, { email: M.email, role: 'member' })).status === 201, 'member');
    const tb = (await O.req('POST', '/api/boards', { title: 'Retro', workspaceId: team.id })).json.board;
    const notes = ['Slow CI builds', 'Flaky tests', 'Great pairing sessions', 'Fun offsite', 'Deploys take too long', 'Helpful code reviews'];
    const seeded = await M.req('POST', `/api/boards/${tb.id}/insert-structure`, { structure: { kind: 'stickies', items: notes } });
    assert(seeded.status === 201, seeded.text);
    const noteIds = seeded.json.created;

    await check('ai: on a team board AI is off until an admin turns it on; members then use it, and switching it off stops them at once', async () => {
      const off = (await M.req('GET', `/api/boards/${tb.id}/ai`)).json.ai;
      assert(off.available === false && /off/.test(off.reason), JSON.stringify(off));
      assert((await M.req('PATCH', `/api/workspaces/${team.id}/admin/ai`, { enabled: true })).status === 403, 'a member changed the AI settings');
      const on = await O.req('PATCH', `/api/workspaces/${team.id}/admin/ai`, { enabled: true, source: 'instance' });
      assert(on.status === 200 && on.json.settings.enabled, on.text);
      assert((await M.req('GET', `/api/boards/${tb.id}/ai`)).json.ai.available === true, 'member still off');
      assert((await O.req('PATCH', `/api/workspaces/${team.id}/admin/ai`, { enabled: false })).status === 200, 'off');
      const refused = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'summarize' });
      assert(refused.status === 403 && refused.json.code === 'ai_unavailable', `${refused.status} ${refused.text}`);
    });

    await check('ai: a workspace’s own provider gets its own key (never shown again), and clustering moves the selected notes into named groups (someone else’s notes are only proposed)', async () => {
      const before = model.requests.length;
      const own = await O.req('PATCH', `/api/workspaces/${team.id}/admin/ai`, {
        enabled: true,
        source: 'workspace',
        provider: 'anthropic',
        baseUrl: model.url,
        model: 'mock-claude',
        apiKey: 'sk-team-verify',
      });
      assert(own.status === 200 && own.json.settings.hasKey && !own.text.includes('sk-team-verify'), own.text);
      assert(!(await O.req('GET', `/api/workspaces/${team.id}/admin/ai`)).text.includes('sk-team-verify'), 'the key came back');
      const r = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'cluster', ids: noteIds, target: 'board' });
      assert(r.status === 201 && r.json.moved.length === notes.length, `${r.status} ${r.text.slice(0, 400)}`);
      const call = model.requests.slice(before).find((x) => x.path === '/v1/messages');
      assert(call?.headers['x-api-key'] === 'sk-team-verify' && call.body.model === 'mock-claude', JSON.stringify(call?.headers));
      // Board text reached the model only inside the delimited data block.
      const userMsg = call.body.messages[0].content;
      assert(userMsg.indexOf('Flaky tests') > userMsg.indexOf('<board_content>') && !call.body.system.includes('Flaky tests'), 'board text outside the envelope');
      const outline = (await O.req('GET', `/api/boards/${tb.id}/outline`)).json.outline;
      const titles = JSON.stringify(outline.items);
      assert(titles.includes('Tooling and speed') && titles.includes('Team and collaboration'), titles.slice(0, 400));
      // Someone else sorting the member's notes moves nothing: it is proposed (KAI-169), "AI for" them.
      const where = JSON.stringify((await O.req('GET', `/api/boards/${tb.id}/outline`)).json.outline.items);
      const theirs = await O.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'cluster', ids: noteIds, target: 'board' });
      assert(theirs.status === 201 && theirs.json.target === 'suggestions' && theirs.json.groupId, `${theirs.status} ${theirs.text.slice(0, 300)}`);
      assert(JSON.stringify((await O.req('GET', `/api/boards/${tb.id}/outline`)).json.outline.items) === where, 'the AI moved someone else’s notes');
      const proposed = await O.req('GET', `/api/boards/${tb.id}/outline?format=markdown&include=suggestions`);
      assert(new RegExp(`by AI for ${O.name}`).test(proposed.text), `proposal: ${proposed.text.slice(-400)}`);
    });

    await check('ai: a summary and a diagram land as a note and as shapes joined by attached connectors', async () => {
      const s = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'summarize', target: 'board' });
      assert(s.status === 201, s.text);
      const d = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'diagram', prompt: 'Support ticket flow', target: 'board' });
      assert(d.status === 201, d.text);
      const live = connectDoc(O, tb.id);
      await live.ready();
      const els = live.doc.getMap('elements');
      const note = els.get(s.json.created[0]);
      assert(note?.type === 'shape' && /Where the board stands/.test(note.text), JSON.stringify(note));
      const made = d.json.created.map((id) => els.get(id));
      const shapes = new Set(made.filter((e) => e.type === 'shape').map((e) => e.id));
      const lines = made.filter((e) => e.type === 'connector');
      assert(shapes.size === 7 && lines.length === 7, `${shapes.size} shapes, ${lines.length} lines`);
      assert(lines.every((c) => shapes.has(c.start.elementId) && shapes.has(c.end.elementId)), 'a connector is not attached at both ends');
      live.destroy();
    });

    await check('ai: an answer that is not JSON (even after one repair turn) is refused with nothing written', async () => {
      const before = await outlineCount(O, tb.id);
      const r = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'ideas', prompt: 'MALFORMED please', target: 'board' });
      assert(r.status === 502 && r.json.code === 'ai_invalid_output', `${r.status} ${r.text}`);
      assert((await outlineCount(O, tb.id)) === before, 'something was written');
    });

    await check('ai: every request is in the workspace audit log with task, model and tokens — never the prompt or board text', async () => {
      const events = (await O.req('GET', `/api/workspaces/${team.id}/audit?action=ai.&limit=50`)).json.events;
      const requests = events.filter((e) => e.action === 'ai.request');
      // cluster, summary, diagram and the refused answer (whose tokens were still spent).
      assert(requests.length >= 4 && requests.every((e) => e.metadata.model && e.metadata.task && e.metadata.inputTokens > 0), JSON.stringify(requests.map((e) => e.metadata)));
      assert(events.some((e) => e.action === 'ai.settings_changed' && e.metadata.apiKey === 'replaced'), 'key change not audited');
      const all = JSON.stringify(events);
      assert(!all.includes('Support ticket flow') && !all.includes('Flaky tests') && !all.includes('sk-team-verify'), 'content or key in the audit log');
    });

    await check('ai: the workspace usage shows per-person totals, and a budget that is used up refuses the next action (429)', async () => {
      const usage = (await O.req('GET', `/api/workspaces/${team.id}/admin/ai`)).json.usage;
      assert(usage.byUser.some((u) => u.userId === M.id && u.requests >= 4), JSON.stringify(usage));
      assert((await O.req('PATCH', `/api/workspaces/${team.id}/admin/ai`, { monthlyTokenBudget: 1000 })).status === 200, 'budget');
      const r = await M.req('POST', `/api/boards/${tb.id}/ai/actions`, { task: 'ideas', prompt: 'More' });
      assert(r.status === 429 && r.json.code === 'ai_budget', `${r.status} ${r.text}`);
    });

    await check(`ai: the per-user rate limit refuses call ${AI_LIMIT + 1} in its window (429 with Retry-After)`, async () => {
      const R = new User('AiRate', proc.port);
      await R.signup();
      const b = (await R.req('POST', '/api/boards', { title: 'Rate' })).json.board;
      const statuses = [];
      for (let i = 0; i <= AI_LIMIT; i++) statuses.push(await R.req('POST', `/api/boards/${b.id}/ai/actions`, { task: 'ideas', prompt: `Round ${i}` }));
      assert(statuses.slice(0, AI_LIMIT).every((r) => r.status === 200), statuses.map((r) => r.status).join(','));
      assert(statuses[AI_LIMIT].status === 429 && statuses[AI_LIMIT].headers.get('retry-after'), `call ${AI_LIMIT + 1}: ${statuses[AI_LIMIT].status}`);
    });
  } finally {
    closeAllDocs();
    if (proc) await stopProc(proc);
    server = null;
    await model.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Video, audio and any other file on a board (KAI-128), on its own server: media is stored by what
// its bytes are and served with byte ranges (seeking); attachments are never served at /uploads/,
// only downloaded from their board — under the workspace's downloads policy, audited, as an
// attachment — and operator removal answers 410 on both paths.
// ---------------------------------------------------------------------------
async function mediaChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-media-'));
  const outerDbUrl = db.url;
  const Op = new User('MediaOperator');
  const O = new User('MediaOwner');
  const M = new User('MediaMember');
  const S = new User('MediaStranger');
  // Real caps, small enough to cross: 60 MB for video/audio (a 50 MB clip fits), 1 MB for other
  // files, an 80 MB quota (one clip fits, two don't).
  // LOG_LEVEL info: operator downloads are checked in the audit trail's log line (platform/audit).
  const env = { OPERATOR_EMAILS: Op.email, MAX_MEDIA_UPLOAD_MB: '60', MAX_ATTACHMENT_UPLOAD_MB: '1', UPLOAD_QUOTA_MB: '80', LOG_LEVEL: 'info' };
  const base = () => `http://127.0.0.1:${server.port}`;
  const get = (url, headers = {}) => fetch(`${base()}${url}`, { headers, redirect: 'manual' });
  /** An ISO media (MP4) file of `bytes` bytes: an "ftyp" box, then a recognisable byte pattern. */
  const mp4 = (bytes) => {
    const b = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i += 4096) b.writeUInt32BE(i, i);
    b.writeUInt32BE(24, 0);
    b.write('ftypisom', 4, 'latin1');
    return b;
  };
  const place = async (user, boardId, el) => {
    const c = connectDoc(user, boardId);
    await c.ready();
    els(c).set(el.id, { x: 0, y: 0, w: 320, h: 84, rotation: 0, z: 1, ...el });
    await settled(c);
    c.destroy();
  };
  const HTML = Buffer.from('<!doctype html><script>document.title = document.cookie</script>');
  try {
    if (ADMIN_URL) db.url = await createDatabase();
    if (!(await check('media: server boots', async () => waitUp((server = await spawnServer(dataDir, env)))))) return;
    for (const u of [Op, O, M, S]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const ws = (await O.req('POST', '/api/workspaces', { name: 'Media team' })).json.workspace.id;
    assert((await O.req('POST', `/api/workspaces/${ws}/members`, { email: M.email, role: 'member' })).status === 201, 'add member');
    const board = (await O.req('POST', '/api/boards', { title: 'Media', workspaceId: ws })).json.board.id;

    let video = null;
    const clip = mp4(50 * 1024 * 1024);
    await check('media: a 50 MB MP4 is stored by its bytes and seeks — byte ranges (start, middle, suffix) return exactly those bytes; past the end is 416', async () => {
      const up = await O.req('POST', '/api/uploads', clip, { raw: true, headers: { 'content-type': 'video/mp4' } });
      assert(up.status === 201 && /^\/uploads\/[A-Za-z0-9_-]+\.mp4$/.test(up.json?.url), `upload -> ${up.status} ${up.text.slice(0, 200)}`);
      video = up.json.url;
      const full = await get(video);
      assert(full.status === 200 && full.headers.get('accept-ranges') === 'bytes' && full.headers.get('content-type') === 'video/mp4', `full -> ${full.status} ${[...full.headers]}`);
      assert(Number(full.headers.get('content-length')) === clip.length && full.headers.get('x-content-type-options') === 'nosniff', 'full length / nosniff');
      await full.body.cancel();
      for (const [range, start, end] of [
        ['bytes=0-1023', 0, 1023],
        ['bytes=31457280-31461375', 31457280, 31461375],
        ['bytes=-5000', clip.length - 5000, clip.length - 1],
        [`bytes=${clip.length - 10}-`, clip.length - 10, clip.length - 1],
      ]) {
        const r = await get(video, { range });
        const body = Buffer.from(await r.arrayBuffer());
        assert(r.status === 206 && r.headers.get('content-range') === `bytes ${start}-${end}/${clip.length}`, `${range} -> ${r.status} ${r.headers.get('content-range')}`);
        assert(body.equals(clip.subarray(start, end + 1)), `${range}: wrong bytes`);
      }
      const past = await get(video, { range: `bytes=${clip.length}-` });
      assert(past.status === 416 && past.headers.get('content-range') === `bytes */${clip.length}`, `past the end -> ${past.status}`);
    });

    await check('media: refused with a clear message — a page labelled as a video (415), a video over its cap, a file over the attachment cap (413); quotas count media', async () => {
      const fake = await O.req('POST', '/api/uploads', HTML, { raw: true, headers: { 'content-type': 'video/mp4' } });
      assert(fake.status === 415 && /video or audio format/.test(fake.json?.error), `fake video -> ${fake.status} ${fake.text}`);
      const big = await O.req('POST', '/api/uploads', mp4(61 * 1024 * 1024), { raw: true, headers: { 'content-type': 'video/mp4' } });
      assert(big.status === 413 && /max 60MB for video and audio/.test(big.json?.error), `big video -> ${big.status} ${big.text}`);
      const bigFile = await O.req('POST', '/api/uploads?as=attachment', Buffer.alloc(2 * 1024 * 1024, 7), { raw: true, headers: { 'content-type': 'application/octet-stream' } });
      assert(bigFile.status === 413 && /max 1MB for files/.test(bigFile.json?.error), `big file -> ${bigFile.status} ${bigFile.text}`);
      // The 50 MB clip counts toward the 80 MB quota: a second one doesn't fit.
      const again = await O.req('POST', '/api/uploads', clip, { raw: true, headers: { 'content-type': 'video/mp4' } });
      assert(again.status === 413 && /quota/i.test(again.json?.error), `second clip -> ${again.status} ${again.text}`);
    });

    let card = null;
    await check('media: a file card is never served at /uploads/, downloads from its board as an attachment under its own name, and only from a board it is on', async () => {
      const up = await O.req('POST', '/api/uploads?as=attachment', HTML, { raw: true, headers: { 'content-type': 'text/html' } });
      assert(up.status === 201 && /\.bin$/.test(up.json?.url), `attach -> ${up.status} ${up.text}`);
      card = up.json.url;
      assert((await get(card)).status === 404, 'an attachment is served at /uploads/');
      await place(O, board, { id: 'card', type: 'file', src: card, name: 'Plan “final”.html', size: HTML.length, mime: 'text/html' });
      const r = await O.req('GET', `/api/boards/${board}/files/card`);
      assert(r.status === 200 && r.text === HTML.toString(), `download -> ${r.status}`);
      assert(r.headers.get('content-type') === 'application/octet-stream' && r.headers.get('x-content-type-options') === 'nosniff', `type ${r.headers.get('content-type')}`);
      const cd = r.headers.get('content-disposition') ?? '';
      assert(cd.startsWith('attachment;') && cd.includes(`filename*=UTF-8''Plan%20%E2%80%9Cfinal%E2%80%9D.html`), `disposition: ${cd}`);
      const other = (await O.req('POST', '/api/boards', { title: 'Elsewhere', workspaceId: ws })).json.board.id;
      assert((await O.req('GET', `/api/boards/${other}/files/card`)).status === 404, 'downloaded through a board it is not on');
      assert((await O.req('GET', `/api/boards/${board}/files/nope`)).status === 404, 'unknown item');
      assert([403, 404].includes((await S.req('GET', `/api/boards/${board}/files/card`)).status), 'a stranger downloaded it');
    });

    await check('media: downloads follow the workspace downloads policy and land in its audit log, like exports', async () => {
      assert((await M.req('GET', `/api/boards/${board}/files/card`)).status === 200, 'member download');
      assert((await O.req('PATCH', `/api/workspaces/${ws}`, { policies: { downloads: 'admins' } })).status === 200, 'policy');
      const refused = await M.req('GET', `/api/boards/${board}/files/card`);
      assert(refused.status === 403, `member downloaded under an admins-only policy -> ${refused.status}`);
      assert((await O.req('GET', `/api/boards/${board}/files/card`)).status === 200, 'owner refused');
      const evs = (await O.req('GET', `/api/workspaces/${ws}/audit?limit=50&action=board.file_downloaded`)).json.events;
      const by = evs.map((e) => e.actor?.id).sort();
      assert(evs.length === 3 && isDeepStrictEqual(by, [M.id, O.id, O.id].sort()), `audit: ${JSON.stringify(evs)}`);
      assert(evs.every((e) => e.metadata.file === 'Plan “final”.html' && e.target.id === board), `audit detail: ${JSON.stringify(evs[0])}`);
      assert((await O.req('PATCH', `/api/workspaces/${ws}`, { policies: { downloads: 'anyone' } })).status === 200, 'reset');
    });

    await check('media: an operator downloads a reported file card from the queue to review it (KAI-205) — always as an attachment, audited, and nobody else can use that route', async () => {
      const name = card.slice('/uploads/'.length);
      const route = `/api/moderation/uploads/${name}/file`;
      const r = await Op.req('GET', route);
      assert(r.status === 200 && r.text === HTML.toString(), `operator download -> ${r.status} ${r.text.slice(0, 100)}`);
      assert(r.headers.get('content-type') === 'application/octet-stream' && r.headers.get('x-content-type-options') === 'nosniff', `type ${r.headers.get('content-type')}`);
      assert((r.headers.get('content-disposition') ?? '').startsWith('attachment;'), `disposition: ${r.headers.get('content-disposition')}`);
      assert(/sandbox/.test(r.headers.get('content-security-policy') ?? ''), `csp: ${r.headers.get('content-security-policy')}`);
      for (const u of [O, M, S]) assert((await u.req('GET', route)).status === 404, `${u.label} used the operator download`);
      assert((await fetch(`${base()}${route}`)).status === 401, 'anonymous used the operator download');
      await waitFor(() => server.log.join('').includes('moderation.upload.download'), 5000, 'the download in the audit trail');
      const line = server.log.join('').split(/\r?\n/).find((l) => l.includes('moderation.upload.download'));
      assert(line.includes(Op.id) && line.includes(name), `audit line: ${line}`);
    });

    await check('media: a file an operator removed answers 410 both at /uploads/ and from its board', async () => {
      await place(O, board, { id: 'clip', type: 'media', kind: 'video', src: video, name: 'clip.mp4', size: clip.length, duration: 0, naturalW: 0, naturalH: 0 });
      for (const [url, target] of [
        [video, 'clip'],
        [card, 'card'],
      ]) {
        const r = await Op.req('POST', '/api/moderation/actions', { action: 'upload.remove', targetId: url, reason: 'illegal', statement: 'Checked by verify.', boardId: board });
        assert(r.status === 200, `remove ${url}: ${r.text}`);
        assert((await get(url)).status === 410, `${url} at /uploads/`);
        assert((await O.req('GET', `/api/boards/${board}/files/${target}`)).status === 410, `${target} from the board`);
      }
      // Operators can still review the kept copy before restoring or purging it.
      const kept = await Op.req('GET', `/api/moderation/uploads/${card.slice('/uploads/'.length)}/file`);
      assert(kept.status === 200 && kept.text === HTML.toString(), `kept copy -> ${kept.status}`);
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

// ---------------------------------------------------------------------------
// Facilitator controls (KAI-129): the server enforces a facilitator's lock and "what may be added"
// against raw clients (no app in the way), and ends the session when the facilitator is gone.
// ---------------------------------------------------------------------------
async function facilitationChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-facil-'));
  let proc = null;
  const clients = [];
  try {
    const env = { FREERO_FACILITATOR_GRACE_MS: '1500' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('facilitation server boots (a facilitator gone 1.5 s ends their session)', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const port = proc.port;
    const O = new User('FacOwner', port);
    const F = new User('Facilitator', port);
    const P = new User('Participant', port);
    for (const u of [O, F, P]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const board = (await O.req('POST', '/api/boards', { title: 'Workshop' })).json.board;
    for (const u of [F, P]) assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: u.email, role: 'editor' })).status === 201, `invite ${u.label}`);
    const join = async (u) => {
      const c = connectDoc(u, board.id, undefined, port);
      clients.push(c);
      await c.ready();
      return c;
    };
    const o = await join(O);
    const f = await join(F);
    const p = await join(P);
    const session = (patch) => ({ by: F.id, byName: F.name, startedAt: Date.now(), locked: false, allowedTypes: null, follow: false, cursorsHidden: false, ...patch });
    const fac = (c) => c.doc.getMap('facilitation');
    /** Every element key `c` was ever told about (to prove something never arrived, even briefly). */
    const everSeen = (c) => {
      const seen = new Set();
      els(c).observe((e) => e.changes.keys.forEach((_, k) => seen.add(k)));
      return seen;
    };
    const oSaw = everSeen(o);

    await check('a locked board: a participant’s raw writes reach nobody and they cannot end the session, the facilitator keeps editing, requests are refused too', async () => {
      fac(f).set('session', session({ locked: true }));
      await waitFor(() => p.role === 'commenter' && p.limits?.locked === true, 5000, 'the participant to be told the board is locked');
      assert(f.role === 'editor' && !f.limits, `the facilitator was limited: ${f.role} ${JSON.stringify(f.limits)}`);
      assert(o.role === 'owner' && !o.limits, 'the board owner was limited');
      els(p).set('forged', { id: 'forged', type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
      fac(p).delete('session');
      els(f).set('byLead', { id: 'byLead', type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
      await settled(p, [o]);
      await waitFor(() => els(o).has('byLead'), 5000, "the facilitator's edit to reach the owner");
      assert(!oSaw.has('forged'), "a locked participant's element reached the owner");
      assert(fac(o).get('session')?.locked === true, 'a locked participant ended the session');
      const r = await P.req('POST', `/api/boards/${board.id}/insert-structure`, { structure: { kind: 'mermaid', source: 'flowchart LR\n  a --> b' } });
      assert(r.status === 400, `insert-structure while locked -> ${r.status}`);
    });

    await check('limited to stickies: a forged shape is undone in the same update (nobody ever receives it, the participant converges), stickies go through, no sticky turns into a shape, the limits can’t be widened', async () => {
      fac(f).set('session', session({ allowedTypes: ['sticky'] }));
      await waitFor(() => p.role === 'editor' && p.limits?.addTypes?.join() === 'sticky', 5000, 'the participant to be told what they may add');
      els(p).set('shape1', { id: 'shape1', type: 'shape', x: 0, y: 0, w: 10, h: 10 });
      els(p).set('note1', { id: 'note1', type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
      await waitFor(() => els(o).has('note1') && !els(p).has('shape1'), 5000, "the sticky to arrive and the shape to be undone on the participant's side");
      assert(!oSaw.has('shape1'), 'the owner received the forged shape');
      els(p).set('note1', { id: 'note1', type: 'shape', x: 0, y: 0, w: 10, h: 10 });
      fac(p).set('session', session({ allowedTypes: null }));
      await waitFor(() => els(p).get('note1')?.type === 'sticky' && fac(p).get('session')?.allowedTypes?.join() === 'sticky', 5000, 'the participant to converge');
      assert(els(o).get('note1')?.type === 'sticky' && fac(o).get('session')?.allowedTypes?.join() === 'sticky', 'a forbidden change reached the owner');
      // Their doc did not diverge: later edits still apply.
      els(p).set('note2', { id: 'note2', type: 'sticky', x: 0, y: 0, w: 10, h: 10 });
      await waitFor(() => els(o).has('note2'), 5000, "the participant's next sticky");
    });

    await check('planning poker (KAI-131): a raw socket learns only that a participant picked a card, never which, until the facilitator reveals the item', async () => {
      const pl = await layerClient(P, board.id, port);
      const ol = await layerClient(O, board.id, port);
      const fl = await layerClient(F, board.id, port);
      clients.push(pl, ol, fl);
      const key = `v:r1:item1:${P.id}`;
      const me = { roundId: 'r1', itemId: 'item1', userId: P.id, userName: P.name, userColor: '#000' };
      pl.layers.private.getMap('estimation').set(key, { ...me, value: 'XL-SECRET' });
      pl.doc.getMap('estimation').set(key, { ...me, sealed: true });
      await settled(pl, [ol]);
      await waitFor(() => ol.doc.getMap('estimation').get(key)?.sealed === true, 5000, 'the sealed marker');
      assert(!sharedText(ol).includes('XL-SECRET') && !JSON.stringify(ol.layers.private.toJSON()).includes('XL-SECRET'), "the owner's socket received the pick");
      fl.layerOp({ type: 'reveal', collection: 'estimation', prefix: 'v:r1:item1:' });
      await waitFor(() => ol.doc.getMap('estimation').get(key)?.value === 'XL-SECRET', 5000, 'the revealed pick');
      for (const c of [pl, ol, fl]) c.destroy();
    });

    await check('vote budget (KAI-210): a raw socket can neither vote over the budget (shared or sealed), nor as a made-up voter, nor raise the budget — nobody receives it and the voter converges', async () => {
      const pl = await layerClient(P, board.id, port);
      const ol = await layerClient(O, board.id, port);
      clients.push(pl, ol);
      const vm = (c) => c.doc.getMap('voting');
      const seen = new Set();
      vm(ol).observe((e) => e.changes.keys.forEach((_, k) => seen.add(`${k}=${JSON.stringify(vm(ol).get(k) ?? null)}`)));
      const vote = (patch) => ({ id: 'kv1', active: true, title: 'Vote', votesPerUser: 2, elementIds: null, anonymous: false, startedBy: O.id, startedAt: Date.now(), endedAt: null, ...patch });
      vm(ol).set('session', vote());
      await waitFor(() => vm(pl).get('session')?.id === 'kv1', 5000, 'the vote to reach the participant');
      const own = `kv1:${P.id}`;
      vm(pl).set(own, { sessionId: 'kv1', userId: P.id, elementIds: ['a', 'a', 'a', 'a', 'a'] });
      vm(pl).set(`kv1:ghost`, { sessionId: 'kv1', userId: 'ghost', elementIds: ['a', 'a'] });
      vm(pl).set('session', vote({ votesPerUser: 20 }));
      await settled(pl, [ol]);
      await waitFor(() => !vm(pl).has(own) && !vm(pl).has('kv1:ghost') && vm(pl).get('session')?.votesPerUser === 2, 5000, 'the participant to converge');
      assert(![...seen].some((k) => k.startsWith(own) || k.startsWith('kv1:ghost') || k.includes('"votesPerUser":20')), `the owner received a forbidden vote: ${[...seen].join(' ')}`);
      vm(pl).set(own, { sessionId: 'kv1', userId: P.id, elementIds: ['a', 'b'] });
      await waitFor(() => vm(ol).get(own)?.elementIds?.length === 2, 5000, "the participant's vote within budget");
      // Hidden results: the sealed ballot in the private layer keeps to the same budget.
      vm(ol).set('session', vote({ id: 'kv2', anonymous: true }));
      await waitFor(() => vm(pl).get('session')?.id === 'kv2', 5000, 'the hidden vote to reach the participant');
      pl.layers.private.getMap('voting').set(`kv2:${P.id}`, { sessionId: 'kv2', userId: P.id, elementIds: ['a', 'b', 'c'] });
      await settled(pl);
      await waitFor(() => !pl.layers.private.getMap('voting').has(`kv2:${P.id}`), 5000, 'the over-budget sealed ballot to be undone');
      pl.layers.private.getMap('voting').set(`kv2:${P.id}`, { sessionId: 'kv2', userId: P.id, elementIds: ['c'] });
      await settled(pl);
      ol.layerOp({ type: 'reveal', collection: 'voting', prefix: 'kv2:' });
      await waitFor(() => vm(ol).get(`kv2:${P.id}`)?.elementIds?.join() === 'c', 5000, 'the sealed ballot within budget to be revealed');
      vm(ol).delete('session');
      for (const c of [pl, ol]) c.destroy();
    });

    await check('the session ends when the facilitator has been gone for the grace period, lifting every limit', async () => {
      fac(f).set('session', session({ locked: true }));
      await waitFor(() => p.role === 'commenter', 5000, 'the lock');
      f.destroy();
      await waitFor(() => !fac(o).has('session'), 8000, 'the server to end the session');
      await waitFor(() => p.role === 'editor' && !p.limits, 5000, 'the participant to edit again');
      els(p).set('after', { id: 'after', type: 'shape', x: 0, y: 0, w: 10, h: 10 });
      await waitFor(() => els(o).has('after'), 5000, "the participant's edit after the session");
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
// The S3 storage backend (KAI-203), on its own server, only when an S3-compatible endpoint is
// configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY — e.g. MinIO or
// SeaweedFS in Docker; the bucket is created when missing). Every other group runs on the local
// disk as before (the S3_* variables are taken out of their servers' environment). Checks what
// only S3 does: the `uploads/` and `private/` prefixes (a removed file's kept copy never sits where
// S3_PUBLIC_URL reaches), restore and retention moving and deleting the objects, the redirect to
// S3_PUBLIC_URL and the Cache-Control stored on the objects (UPLOAD_CACHE_SECONDS).
// ---------------------------------------------------------------------------
async function s3Checks() {
  if (!S3_ENV) {
    console.log('SKIP  s3: no S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY set');
    return;
  }
  const require = createRequire(import.meta.url);
  const { S3Client, CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const bucket = S3_ENV.S3_BUCKET;
  const client = new S3Client({
    region: S3_ENV.S3_REGION || 'us-east-1',
    endpoint: S3_ENV.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ENV.S3_ACCESS_KEY_ID, secretAccessKey: S3_ENV.S3_SECRET_ACCESS_KEY },
  });
  const keys = async (prefix) => {
    const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    return (out.Contents ?? []).map((o) => o.Key);
  };
  const head = async (key) => {
    try {
      return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      return null;
    }
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-s3-'));
  const outerDbUrl = db.url;
  const Op = new User('S3Operator');
  const O = new User('S3Owner');
  const publicUrl = S3_ENV.S3_PUBLIC_URL || `${S3_ENV.S3_ENDPOINT.replace(/\/+$/, '')}/${bucket}`;
  const env = { ...S3_ENV, S3_PUBLIC_URL: publicUrl, OPERATOR_EMAILS: Op.email, UPLOAD_CACHE_SECONDS: '123' };
  const get = (url) => fetch(`http://127.0.0.1:${server.port}${url}`, { redirect: 'manual' });
  const act = (body) => Op.req('POST', '/api/moderation/actions', { reason: 'illegal', statement: 'Checked by verify.', ...body });
  try {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (e) {
      if (!/BucketAlready/.test(e?.name ?? '')) throw e;
    }
    if (ADMIN_URL) db.url = await createDatabase();
    if (!(await check('s3: server boots against the S3 endpoint', async () => waitUp((server = await spawnServer(dataDir, env)))))) return;
    for (const u of [Op, O]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    let name = null;
    await check('s3: an upload is stored under uploads/ with max-age=UPLOAD_CACHE_SECONDS, and its URL redirects to S3_PUBLIC_URL with the same max-age', async () => {
      const up = await O.req('POST', '/api/uploads', PNG_1PX, { raw: true, headers: { 'content-type': 'image/png' } });
      assert(up.status === 201, `upload -> ${up.status} ${up.text}`);
      name = up.json.url.slice('/uploads/'.length);
      const obj = await head(`uploads/${name}`);
      assert(obj, `no object uploads/${name}`);
      assert(/max-age=123\b/.test(obj.CacheControl ?? ''), `stored Cache-Control: ${obj.CacheControl}`);
      const r = await get(`/uploads/${name}`);
      assert(r.status === 302 && r.headers.get('location') === `${publicUrl}/uploads/${name}`, `redirect -> ${r.status} ${r.headers.get('location')}`);
      assert(/max-age=123\b/.test(r.headers.get('cache-control') ?? ''), `redirect Cache-Control: ${r.headers.get('cache-control')}`);
    });

    await check('s3: removing a file moves its kept copy under private/ (never under the public uploads/ prefix) and the URL answers 410; restoring brings it back under uploads/', async () => {
      assert(name, 'no upload');
      assert((await act({ action: 'upload.remove', targetId: name })).status === 200, 'remove');
      assert(!(await head(`uploads/${name}`)), 'the removed file is still under uploads/');
      const kept = (await keys('private/')).filter((k) => k.endsWith(`.${name}`));
      assert(kept.length === 1, `kept copies: ${JSON.stringify(kept)}`);
      assert(!(await keys('uploads/')).some((k) => k.includes(`.${name}`)), 'a kept copy sits under uploads/');
      const gone = await get(`/uploads/${name}`);
      assert(gone.status === 410 && !gone.headers.get('location'), `after removal -> ${gone.status} ${gone.headers.get('location')}`);
      assert((await act({ action: 'upload.restore', targetId: name, reason: 'other' })).status === 200, 'restore');
      const back = await head(`uploads/${name}`);
      assert(back && /max-age=123\b/.test(back.CacheControl ?? ''), `restored object: ${back?.CacheControl}`);
      assert(!(await keys('private/')).some((k) => k.endsWith(`.${name}`)), 'the kept copy outlived the restore');
      assert((await get(`/uploads/${name}`)).status === 302, 'the restored file does not redirect');
    });

    await check('s3: retention (MODERATION_KEEP_REMOVED_DAYS=0) deletes the kept copy under private/, the URL stays 410', async () => {
      assert((await act({ action: 'upload.remove', targetId: name })).status === 200, 'remove again');
      assert((await keys('private/')).some((k) => k.endsWith(`.${name}`)), 'no kept copy');
      await stopProc(server);
      server = await waitUp(await spawnServer(dataDir, { ...env, MODERATION_KEEP_REMOVED_DAYS: '0', MODERATION_RETENTION_INTERVAL_SECONDS: '1' }));
      await waitFor(async () => !(await keys('private/')).some((k) => k.endsWith(`.${name}`)), 10_000, 'the kept copy to be deleted');
      assert((await get(`/uploads/${name}`)).status === 410, 'the URL came back');
    });
  } finally {
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

// ---------------------------------------------------------------------------
// The public API (KAI-104), agent safety (KAI-170) and the downloads policy on reads (KAI-197):
// real tokens and a real OAuth app against a real server, with a live Yjs client on the board.
// ---------------------------------------------------------------------------
async function publicApiChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-api-'));
  // With REDIS_URL every server of the run shares per-IP counters that earlier suites used up.
  const env = { RATE_LIMIT_INVITE: '500/1h', RATE_LIMIT_PASSWORD: '500/15m' };
  let proc = null;
  const live = [];
  try {
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('api server boots', async () => (proc = await waitUp(await spawnServer(dataDir, env)))))) return;
    const stamp = Date.now();
    const verified = async (label) => {
      const u = new User(label, proc.port);
      u.email = `${label.toLowerCase()}-${stamp}@api.verify.freero.app`;
      await u.signup();
      await u.verifyEmail(dataDir);
      return u;
    };
    const token = async (u, scopes, name = 'verify') => {
      const r = await u.req('POST', '/api/auth/tokens', { name, scopes, expiresInDays: 30 });
      assert(r.status === 201 && r.json.secret.startsWith('frp_'), `token: ${r.status} ${r.text}`);
      return r.json;
    };
    /** A call with only a bearer token: no cookie, like any script or agent. */
    const call = (secret, method, url, body, headers = {}) =>
      new User('bearer', proc.port).req(method, `/api/v1${url}`, body, { headers: { authorization: `Bearer ${secret}`, ...headers }, cookie: false });

    const O = await verified('Owner');
    const V = await verified('Viewer');
    const M = await verified('Member');
    const board = (await O.req('POST', '/api/boards', { title: 'API board' })).json.board.id;
    assert((await O.req('POST', `/api/boards/${board}/members`, { email: V.email, role: 'viewer' })).status === 201, 'invite viewer');
    const write = await token(O, ['boards:read', 'boards:write', 'comments:write', 'members:read']);

    await check('api: a token with boards:write adds a sticky that a browser already on the board sees at once, without reloading', async () => {
      const client = connectDoc(O, board, null, proc.port);
      live.push(client);
      await client.ready();
      const r = await call(write.secret, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'From a script', color: 'blue' });
      assert(r.status === 201 && r.json.items[0].text === 'From a script' && r.json.notice, `create: ${r.status} ${r.text}`);
      const id = r.json.items[0].id;
      const els = client.doc.getMap('elements');
      await waitFor(() => els.get(id)?.type === 'sticky', 5000, 'the sticky to reach the open board');
      assert(els.get(id).createdBy === O.id, 'attributed to the token’s owner');
    });

    await check('api: a token without the scope, a revoked token, a viewer’s token and a stranger’s token can’t write (401/403), and nothing changes', async () => {
      const readOnly = await token(O, ['boards:read'], 'read only');
      const r1 = await call(readOnly.secret, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'x' });
      assert(r1.status === 403 && r1.json.code === 'insufficient_scope' && /insufficient_scope/.test(r1.headers.get('www-authenticate') ?? ''), `scope: ${r1.status} ${r1.text}`);
      const viewerToken = await token(V, ['boards:read', 'boards:write']);
      const r2 = await call(viewerToken.secret, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'x' });
      assert(r2.status === 403, `viewer wrote: ${r2.status} ${r2.text}`);
      const stranger = await token(M, ['boards:read', 'boards:write']);
      const r3 = await call(stranger.secret, 'GET', `/boards/${board}`);
      assert(r3.status === 403 || r3.status === 404, `stranger read: ${r3.status}`);
      assert((await O.req('DELETE', `/api/auth/tokens/${readOnly.token.id}`)).status === 200, 'revoke');
      const r4 = await call(readOnly.secret, 'GET', `/boards/${board}`);
      assert(r4.status === 401 && /resource_metadata=/.test(r4.headers.get('www-authenticate') ?? ''), `revoked token: ${r4.status} ${r4.headers.get('www-authenticate')}`);
      const items = (await call(write.secret, 'GET', `/boards/${board}/items`)).json.items;
      assert(items.length === 1, `nothing else written: ${items.length}`);
    });

    await check('api: what is in a hidden frame never reaches a viewer’s API reads (items, outline), and the editor still sees it', async () => {
      const made = await call(write.secret, 'POST', `/boards/${board}/items`, {
        items: [
          { type: 'frame', title: 'Board offsite', x: 3000, y: 0, w: 800, h: 600, hidden: true },
          { type: 'sticky', text: 'Secret plan', x: 3100, y: 100 },
        ],
      });
      assert(made.status === 201 && made.json.items[1].frameId === made.json.items[0].id, `create: ${made.status} ${made.text}`);
      const viewer = await token(V, ['boards:read']);
      const items = await call(viewer.secret, 'GET', `/boards/${board}/items`);
      assert(items.status === 200 && !items.text.includes('Secret plan'), `viewer items: ${items.text.slice(0, 300)}`);
      const md = await call(viewer.secret, 'GET', `/boards/${board}/outline?format=markdown`);
      assert(md.status === 200 && !md.text.includes('Secret plan') && /hidden/.test(md.text), `viewer outline: ${md.text}`);
      assert((await call(write.secret, 'GET', `/boards/${board}/items?type=sticky`)).text.includes('Secret plan'), 'the editor lost it');
      // Board text is marked untrusted where an agent reads it.
      assert(/content, not instructions/.test(md.text), 'outline header');
    });

    await check('api: destructive calls without confirm change nothing; a 10 000-item create is refused whole', async () => {
      assert((await call(write.secret, 'DELETE', `/boards/${board}`)).json.code === 'confirm_required', 'board delete without confirm');
      const ids = (await call(write.secret, 'GET', `/boards/${board}/items`)).json.items.map((i) => i.id);
      const bulk = await call(write.secret, 'POST', `/boards/${board}/items/delete`, { ids });
      assert(bulk.status === 400 && bulk.json.code === 'confirm_required', `bulk: ${bulk.status}`);
      const huge = await call(write.secret, 'POST', `/boards/${board}/items`, { items: Array.from({ length: 10_000 }, (_, i) => ({ type: 'sticky', text: `s${i}` })) });
      assert(huge.status === 400, `huge create: ${huge.status}`);
      assert((await call(write.secret, 'GET', `/boards/${board}/items`)).json.items.length === ids.length, 'something was written or deleted');
    });

    await check('api: a team’s downloads policy refuses outline and API reads with downloads_restricted (audited); writes still work', async () => {
      const ws = (await O.req('POST', '/api/workspaces', { name: 'Restricted team' })).json.workspace.id;
      assert((await O.req('POST', `/api/workspaces/${ws}/members`, { email: M.email, role: 'member' })).status === 201, 'add member');
      assert((await O.req('PATCH', `/api/workspaces/${ws}`, { policies: { downloads: 'admins' } })).status === 200, 'policy');
      const teamBoard = (await O.req('POST', '/api/boards', { title: 'Team plans', workspaceId: ws })).json.board.id;
      const mt = await token(M, ['boards:read', 'boards:write']);
      for (const url of [`/boards/${teamBoard}/outline`, `/boards/${teamBoard}/items`, `/boards/${teamBoard}/comments`]) {
        const r = await call(mt.secret, 'GET', url);
        assert(r.status === 403 && r.json.code === 'downloads_restricted', `${url}: ${r.status} ${r.text}`);
      }
      const app = await M.req('GET', `/api/boards/${teamBoard}/outline`);
      assert(app.status === 403 && app.json.code === 'downloads_restricted', `app outline: ${app.status}`);
      const ins = await call(mt.secret, 'POST', `/boards/${teamBoard}/structure`, { structure: { kind: 'stickies', items: ['one', 'two'] } });
      assert(ins.status === 201, `structure insert: ${ins.status} ${ins.text}`);
      assert((await call(write.secret, 'GET', `/boards/${teamBoard}/outline`)).status === 200, 'the admin can read');
      const events = (await O.req('GET', `/api/workspaces/${ws}/audit?action=board.download_refused&limit=50`)).json.events;
      const vias = new Set(events.filter((e) => e.actor?.id === M.id).map((e) => e.metadata.via));
      assert(vias.has('api') && vias.has('outline'), `refusals audited: ${JSON.stringify([...vias])}`);
      await O.req('PATCH', `/api/workspaces/${ws}`, { policies: { downloads: 'anyone' } });

      // Admins: API access off refuses the next call there; deactivating the person does too.
      assert((await O.req('PATCH', `/api/workspaces/${ws}/admin/api`, { enabled: false })).status === 200, 'api off');
      const off = await call(mt.secret, 'GET', `/boards/${teamBoard}`);
      assert(off.status === 403 && off.json.code === 'api_disabled', `api off: ${off.status} ${off.text}`);
      assert((await call(mt.secret, 'GET', '/boards')).json.boards.every((b) => b.workspaceId !== ws), 'a disabled workspace’s boards were listed');
      assert((await O.req('PATCH', `/api/workspaces/${ws}/admin/api`, { enabled: true })).status === 200, 'api on');
      assert((await call(mt.secret, 'GET', `/boards/${teamBoard}`)).status === 200, 'back on');
      assert((await O.req('POST', `/api/workspaces/${ws}/admin/members/${M.id}/deactivate`)).status === 200, 'deactivate');
      assert((await call(mt.secret, 'GET', `/boards/${teamBoard}`)).status === 403, 'a deactivated member’s token still opened the team board');
      const used = (await O.req('GET', `/api/workspaces/${ws}/admin/api`)).json.credentials;
      assert(used.some((c) => c.id === mt.token.id && c.user.id === M.id), `admin sees the token: ${JSON.stringify(used)}`);
      // Every call is in the log with the credential and the person it acted for.
      const calls = (await O.req('GET', `/api/workspaces/${ws}/audit?action=api.call&limit=200`)).json.events;
      const c = calls.find((e) => e.actor?.id === M.id && e.metadata.endpoint === 'POST /api/v1/boards/:boardId/structure');
      assert(c && c.metadata.credentialId === mt.token.id && c.metadata.status === 201, `api.call event: ${JSON.stringify(calls.slice(0, 3))}`);
    });

    await check('api: an app registers itself, the person consents, and it calls the API with a PKCE-bound token from another origin; revoking it stops it at once', async () => {
      const otherOrigin = { origin: 'https://agent.example', 'sec-fetch-site': 'cross-site' };
      const meta = await new User('anon', proc.port).req('GET', '/.well-known/oauth-protected-resource/api/v1', undefined, { headers: otherOrigin });
      assert(meta.status === 200 && meta.headers.get('access-control-allow-origin') === '*' && meta.json.authorization_servers.length === 1, `resource metadata: ${meta.text}`);
      const reg = await new User('anon', proc.port).req('POST', '/api/oauth/register', { client_name: 'Verify agent', redirect_uris: ['http://127.0.0.1:9/cb'] }, { headers: otherOrigin });
      assert(reg.status === 201, `register: ${reg.status} ${reg.text}`);
      const verifier = randomBytes(32).toString('base64url');
      const { createHash } = await import('node:crypto');
      const q = {
        response_type: 'code',
        client_id: reg.json.client_id,
        redirect_uri: 'http://127.0.0.1:50123/cb',
        scope: 'boards:read',
        state: 's1',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      };
      const shown = await O.req('GET', `/api/oauth/authorize?${new URLSearchParams(q)}`);
      assert(shown.status === 200 && shown.json.consent.client.registration === 'dynamic', `consent: ${shown.text}`);
      // The consent itself can't be forged from another site (it rides the session cookie).
      assert((await O.req('POST', '/api/oauth/authorize', { ...q, decision: 'allow' }, { headers: otherOrigin })).status === 403, 'cross-site consent accepted');
      const ok = await O.req('POST', '/api/oauth/authorize', { ...q, decision: 'allow' });
      const code = new URL(ok.json.redirect).searchParams.get('code');
      assert(code && new URL(ok.json.redirect).searchParams.get('state') === 's1', `redirect: ${ok.text}`);
      const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.json.client_id, code, code_verifier: verifier, redirect_uri: q.redirect_uri }).toString();
      const t = await new User('anon', proc.port).req('POST', '/api/oauth/token', form, { raw: true, headers: { ...otherOrigin, 'content-type': 'application/x-www-form-urlencoded' } });
      assert(t.status === 200 && t.json.access_token.startsWith('fro_'), `token: ${t.status} ${t.text}`);
      const read = await call(t.json.access_token, 'GET', `/boards/${board}`, undefined, otherOrigin);
      assert(read.status === 200 && read.headers.get('access-control-allow-origin') === '*', `app read: ${read.status}`);
      assert((await call(t.json.access_token, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'x' })).status === 403, 'read-only app wrote');
      assert((await O.req('DELETE', `/api/auth/apps/${reg.json.client_id}`)).status === 200, 'revoke app');
      assert((await call(t.json.access_token, 'GET', `/boards/${board}`)).status === 401, 'revoked app still reads');
    });

    await check('api: cookie routes still refuse cross-site writes, and a session cookie never authenticates the API', async () => {
      const cross = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
      assert((await O.req('POST', '/api/boards', { title: 'csrf' }, { headers: cross })).status === 403, 'cross-site cookie write accepted');
      assert((await O.req('POST', '/api/auth/tokens', { name: 'csrf', scopes: ['boards:read'], expiresInDays: 1 }, { headers: cross })).status === 403, 'cross-site token mint');
      assert((await O.req('GET', '/api/v1/me')).status === 401, 'the API accepted a session cookie');
    });

    await check('api: signing out everywhere (a password reset) ends the account’s tokens', async () => {
      const t = await token(V, ['boards:read'], 'before reset');
      assert((await call(t.secret, 'GET', '/me')).status === 200, 'works first');
      const forgot = await V.req('POST', '/api/auth/password/forgot', { email: V.email });
      assert(forgot.status === 200, `forgot: ${forgot.status} ${forgot.text}`);
      const reset = await mailedToken(dataDir, V.email, '/reset-password');
      assert((await V.req('POST', '/api/auth/password/reset', { token: reset, password: 'password-456' })).status === 200, 'reset');
      assert((await call(t.secret, 'GET', '/me')).status === 401, 'a token outlived the reset');
    });
  } finally {
    for (const c of live) c.destroy();
    if (proc) await stopProc(proc);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Suite foundation (KAI-147, KAI-148, KAI-149): object addresses resolved for each reader, the
// references index derived through the outbox from saved board content, and backlinks that name
// only what the caller may open. Real server, real sockets; the index is built by the server's
// own consumer (the checks wait for it, never sleep).
// ---------------------------------------------------------------------------
async function suiteChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-suite-'));
  let proc = null;
  const clients = [];
  try {
    const env = {};
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    const ok = await check('suite server boots', async () => {
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const A = new User('SuiteOwner', proc.port);
    const B = new User('SuiteReader', proc.port);
    const C = new User('SuiteStranger', proc.port);
    for (const u of [A, B, C]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const target = (await A.req('POST', '/api/boards', { title: 'Roadmap Q4' })).json.board;
    const source = (await A.req('POST', '/api/boards', { title: 'Retro notes' })).json.board;
    const uri = (id, el) => `freero://board/${id}${el ? `#${el}` : ''}`;
    const join = async (u, boardId) => {
      const c = connectDoc(u, boardId, undefined, proc.port);
      clients.push(c);
      await c.ready();
      return c;
    };
    const t = await join(A, target.id);
    const s = await join(A, source.id);
    els(t).set('goal', { id: 'goal', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: '<p>Ship the importer</p>' });
    els(s).set('link', { id: 'link', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'see roadmap', link: `/board/${target.id}?el=goal` });
    els(s).set('chip', { id: 'chip', type: 'objectlink', x: 0, y: 200, w: 300, h: 64, uri: uri(target.id) });
    const backlinks = (u, of = uri(target.id)) => u.req('GET', `/api/objects/backlinks?uri=${encodeURIComponent(of)}`);
    const sources = async (u, of) => {
      const r = await backlinks(u, of);
      return r.status === 200 ? r.json.backlinks.map((l) => `${l.source.uri} ${l.kinds.join('+')}`).sort() : [`status ${r.status}`];
    };

    await check('an item link and a smart link saved on one board become backlinks of the other, through the outbox', async () => {
      const want = [`${uri(source.id, 'chip')} embed`, `${uri(source.id, 'link')} link`];
      await waitFor(async () => JSON.stringify(await sources(A)) === JSON.stringify(want), 10_000, 'the references index to list both');
      const r = await backlinks(A);
      assert(r.json.backlinks.every((l) => l.board.title === 'Retro notes'), `source titles: ${r.text}`);
    });

    await check('resolve: one call answers many addresses — titles for the owner, nothing but "unavailable" for a stranger, and a renamed item shows its new name', async () => {
      const uris = [uri(target.id), uri(target.id, 'goal'), uri(source.id), uri('doesNotExist1'), 'https://example.com/x'];
      const mine = await A.req('POST', '/api/objects/resolve', { uris });
      assert(mine.status === 200, `resolve: ${mine.status} ${mine.text}`);
      const st = mine.json.objects.map((o) => o.status).join(',');
      assert(st === 'ok,ok,ok,unavailable,invalid', `owner statuses: ${st}`);
      assert(mine.json.objects[1].object.title === 'Ship the importer' && mine.json.objects[1].object.board.title === 'Roadmap Q4', `item: ${JSON.stringify(mine.json.objects[1])}`);
      const theirs = await C.req('POST', '/api/objects/resolve', { uris });
      assert(theirs.json.objects.slice(0, 4).every((o) => o.status === 'unavailable' && Object.keys(o).length === 2), `stranger: ${theirs.text}`);
      assert(!/Roadmap|Retro|importer/.test(theirs.text), `a title leaked to a stranger: ${theirs.text}`);
      els(t).set('goal', { ...els(t).get('goal'), text: '<p>Ship the new importer</p>' });
      await waitFor(
        async () => (await A.req('POST', '/api/objects/resolve', { uris: [uri(target.id, 'goal')] })).json.objects[0].object?.title === 'Ship the new importer',
        5000,
        'the renamed item to resolve with its new title',
      );
    });

    await check('backlinks name only boards the caller can open: a viewer of the target sees none of the owner’s private boards until invited to one', async () => {
      assert((await A.req('POST', `/api/boards/${target.id}/members`, { email: B.email, role: 'viewer' })).status === 201, 'invite B to the target');
      const before = await sources(B);
      assert(before.length === 0, `B saw private sources: ${before}`);
      assert((await backlinks(C)).status === 404, 'a stranger got backlinks of a board they can’t open');
      assert((await A.req('POST', `/api/boards/${source.id}/members`, { email: B.email, role: 'viewer' })).status === 201, 'invite B to the source');
      const after = await sources(B);
      assert(after.length === 2, `B after the invite: ${after}`);
    });

    await check('an address written in a comment and in an item’s text is a backlink too; deleting the linking item removes its backlink', async () => {
      s.doc.transact(() => {
        els(s).set('note', { id: 'note', type: 'sticky', x: 0, y: 400, w: 100, h: 100, text: `<p>context: ${uri(target.id, 'goal')}.</p>` });
        s.doc.getMap('comments').set('t:th1', { kind: 'thread', id: 'th1', x: 0, y: 0, elementId: 'note', createdAt: Date.now(), createdBy: A.id });
        s.doc.getMap('comments').set('m:th1:m1', { kind: 'message', threadId: 'th1', id: 'm1', authorId: A.id, authorName: A.name, text: `also ${uri(target.id)}`, createdAt: Date.now() });
      });
      const want = [`${uri(source.id, 'chip')} embed`, `${uri(source.id, 'link')} link`, `${uri(source.id, 'note')} comment`, `${uri(source.id, 'note')} mention`];
      await waitFor(async () => JSON.stringify(await sources(A)) === JSON.stringify(want), 10_000, 'the mention and the comment to be indexed');
      els(s).delete('link');
      await waitFor(async () => !(await sources(A)).some((x) => x.startsWith(uri(source.id, 'link'))), 10_000, 'the deleted item link to leave the index');
      const goal = await sources(A, uri(target.id, 'goal'));
      assert(JSON.stringify(goal) === JSON.stringify([`${uri(source.id, 'note')} mention`]), `the item's own backlinks: ${goal}`);
    });

    await check('trashing the linking board hides its backlinks at once, restoring it brings them back', async () => {
      assert((await A.req('DELETE', `/api/boards/${source.id}`)).status === 200, 'trash the source');
      assert((await sources(A)).length === 0, 'a trashed board still listed as a source');
      const restored = await A.req('POST', `/api/boards/${source.id}/restore`);
      assert(restored.status === 200, `restore: ${restored.status} ${restored.text}`);
      assert((await sources(A)).length === 3, `after restore: ${await sources(A)}`);
    });

    await check('a link saved right before the server is killed is indexed once it is back (the event outlives the process)', async () => {
      const s2 = await join(A, source.id);
      els(s2).set('late', { id: 'late', type: 'sticky', x: 0, y: 600, w: 100, h: 100, text: `last words ${uri(target.id)}` });
      await settled(s2);
      for (const c of clients.splice(0)) c.destroy();
      // Saved (with its outbox event) when the room unloads; killed at once, before the consumer's
      // wake-up delay is over, so the event is handled by the next process.
      await waitUnloaded(proc);
      await stopProc(proc);
      proc = await waitUp(await spawnServer(dataDir, env));
      A.port = proc.port;
      await waitFor(async () => (await sources(A)).includes(`${uri(source.id, 'late')} mention`), 15_000, 'the late link to be indexed after the restart');
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
// Suggestions (KAI-169): changes an agent proposes instead of making them, in the editors layer,
// reviewed by people. Raw clients on two instances (one Postgres, one Redis) when DATABASE_URL and
// REDIS_URL are set, on one instance otherwise.
// ---------------------------------------------------------------------------
async function suggestionsChecks() {
  const REDIS_URL = process.env.REDIS_URL?.trim();
  const multi = !!(ADMIN_URL && REDIS_URL);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-suggest-'));
  let procs = [];
  let clients = [];
  let url = null;
  const env = () => ({
    RATE_LIMIT_INVITE: '500/1h',
    RATE_LIMIT_SIGNUP: '200/1h',
    RATE_LIMIT_PASSWORD: '500/15m',
    ...(url ? { DATABASE_URL: url } : {}),
    ...(multi ? { REDIS_URL } : {}),
  });
  const start = async () => {
    procs = [];
    for (let i = 0; i < (multi ? 2 : 1); i++) procs.push(await spawnServer(path.join(dataDir, `i${i}`), env()));
    await Promise.all(procs.map((p) => waitUp(p)));
  };
  const one = () => procs[0].port;
  const two = () => procs[procs.length - 1].port;
  try {
    if (ADMIN_URL) url = await createDatabase();
    if (!(await check(`suggestions: ${multi ? 'two instances start on one database and one Redis' : 'the server boots'}`, start))) return;
    const people = [];
    const person = async (label) => {
      const u = new User(label, one());
      await u.signup();
      await u.verifyEmail(path.join(dataDir, 'i0'));
      people.push(u);
      return u;
    };
    const O = await person('SgOwner');
    const E = await person('SgEditor');
    const V = await person('SgViewer');
    const C = await person('SgCommenter');
    const token = async (u, scopes, name) => {
      const r = await u.req('POST', '/api/auth/tokens', { name, scopes, expiresInDays: 30 });
      assert(r.status === 201, `token: ${r.status} ${r.text}`);
      return r.json.secret;
    };
    const call = (secret, method, path_, body) =>
      new User('bearer', one()).req(method, `/api/v1${path_}`, body, { headers: { authorization: `Bearer ${secret}` }, cookie: false });
    const ws = (await O.req('POST', '/api/workspaces', { name: 'Agent review team' })).json.workspace.id;
    const board = (await O.req('POST', '/api/boards', { title: 'Retro with an agent', workspaceId: ws })).json.board.id;
    for (const [u, role] of [[E, 'editor'], [V, 'viewer'], [C, 'commenter']])
      assert((await O.req('POST', `/api/boards/${board}/members`, { email: u.email, role })).status === 201, `invite ${u.label}`);
    const S = await token(O, ['boards:suggest'], 'Retro agent');
    const W = await token(O, ['boards:read', 'boards:write'], 'Review script');
    const X = (await call(W, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'Original wording', x: 0, y: 0 })).json.items[0].id;
    const sug = (cl) => cl.layers.editors.getMap('suggestions');
    const audited = async (action, pred) =>
      ((await O.req('GET', `/api/workspaces/${ws}/audit?action=${action}&limit=50`)).json?.events ?? []).some(pred);
    let o, e, v, c;
    let first = null;

    await check('suggestions: a token with only boards:suggest proposes ten stickies; editors on every instance get them, the board does not change, viewers and commenters never receive them, and that token can neither write nor accept', async () => {
      o = await layerClient(O, board, one());
      e = await layerClient(E, board, two());
      v = await layerClient(V, board, two());
      c = await layerClient(C, board, one());
      clients.push(o, e, v, c);
      const oSaw = new Set();
      els(o).observe((ev) => ev.changes.keys.forEach((_, k) => oSaw.add(k)));
      const r = await call(S, 'POST', `/boards/${board}/suggestions`, {
        description: 'Ten ideas from the retro',
        create: Array.from({ length: 10 }, (_, i) => ({ type: 'sticky', text: `Agent idea ${i}` })),
      });
      assert(r.status === 201 && r.json.group?.suggestions.length === 10 && r.json.notice, `propose: ${r.status} ${r.text.slice(0, 300)}`);
      first = r.json.group;
      await waitFor(() => sug(e).size === 10 && sug(o).size === 10, 5000, 'both editors (on both instances) to receive the ten suggestions');
      await settled(o, [v, c, e]);
      assert(!JSON.stringify(v.layers.editors.toJSON()).includes('Agent idea') && !JSON.stringify(c.layers.editors.toJSON()).includes('Agent idea'), 'a viewer or commenter received a suggestion');
      assert(!sharedText(v).includes('Agent idea') && !sharedText(o).includes('Agent idea'), 'a suggestion reached the board');
      assert(first.suggestions.every((s) => !oSaw.has(s.itemId)), 'a suggested item was written to the board');
      // The outline lists them only when asked, and only for people who can edit.
      const plain = await O.req('GET', `/api/boards/${board}/outline?format=markdown`);
      const asked = await O.req('GET', `/api/boards/${board}/outline?format=markdown&include=suggestions`);
      const viewer = await V.req('GET', `/api/boards/${board}/outline?format=markdown&include=suggestions`);
      assert(!plain.text.includes('Agent idea') && asked.text.includes('Agent idea 7') && asked.text.includes('Retro agent for'), `owner outline: ${asked.text.slice(-600)}`);
      assert(viewer.status === 200 && !viewer.text.includes('Agent idea'), `viewer outline: ${viewer.text.slice(-300)}`);
      // Suggest-only: never a write, never a decision; a viewer's token can't propose either.
      const write = await call(S, 'POST', `/boards/${board}/items`, { type: 'sticky', text: 'direct' });
      const structure = await call(S, 'POST', `/boards/${board}/structure`, { structure: { kind: 'stickies', items: ['direct'] } });
      const decide = await call(S, 'POST', `/boards/${board}/suggestions/accept`, { groupId: first.id });
      assert([write, structure, decide].every((x) => x.status === 403 && x.json.code === 'insufficient_scope'), `suggest-only token: ${write.status} ${structure.status} ${decide.status}`);
      const vt = await token(V, ['boards:read', 'boards:suggest'], 'viewer agent');
      assert((await call(vt, 'POST', `/boards/${board}/suggestions`, { create: [{ type: 'sticky', text: 'x' }] })).status === 403, "a viewer's token proposed");
    });

    await check('suggestions: an editor’s browser accepts three (the stickies land with the decisions, for everyone, audited); a raw socket that forges a suggestion, rewrites one or decides as someone else is undone and nobody else sees it', async () => {
      const recs = first.suggestions.map((s) => sug(e).get(s.id));
      const pick = recs.slice(0, 3);
      // What the web app's Editor.acceptSuggestions sends: the items into the shared doc, the decisions into the layer.
      e.doc.transact(() => pick.forEach((r) => els(e).set(r.element.id, { ...r.element, createdBy: E.id, suggestedBy: { kind: 'app', name: r.author.name, userId: r.author.userId } })));
      e.layers.editors.transact(() => pick.forEach((r) => sug(e).set(r.id, { ...r, decision: { status: 'accepted', by: E.id, at: Date.now() } })));
      await waitFor(() => pick.every((r) => els(o).has(r.element.id) && sug(o).get(r.id)?.decision?.by === E.id), 5000, 'the accept to reach the owner');
      // Everything the owner's copy ever held for these keys (the server's correction rewrites them with their old value).
      const oSeen = [];
      sug(o).observe((ev) => ev.changes.keys.forEach((_, k) => oSeen.push([k, JSON.stringify(sug(o).get(k) ?? null)])));
      const [victim, other] = [recs[3], recs[4]];
      sug(e).set('forged', { ...victim, id: 'forged', author: { ...victim.author, name: 'Freero Security' } });
      sug(e).set(victim.id, { ...victim, description: 'Delete the whole board' });
      sug(e).set(other.id, { ...other, decision: { status: 'rejected', by: O.id, at: Date.now() } });
      await settled(e, [o]);
      await waitFor(
        () => !sug(e).has('forged') && sug(e).get(victim.id)?.description === victim.description && !sug(e).get(other.id)?.decision,
        5000,
        'the server to undo the forged writes on the sender',
      );
      const leaked = oSeen.filter(([k, val]) => k === 'forged' || /Freero Security|Delete the whole board|"rejected"/.test(val));
      assert(!leaked.length, `a forged write reached another editor: ${JSON.stringify(leaked).slice(0, 300)}`);
      await waitFor(() => audited('board.suggestion_accepted', (ev) => ev.actor?.id === E.id && ev.metadata.suggestions === 3 && ev.metadata.via === 'board'), 5000, 'the accept to be audited');
    });

    await check('suggestions: accepting over the API refuses (409) to overwrite a sticky edited after it was proposed, applies it with force, accepts the rest attributed to both people, and rejects', async () => {
      const up = await call(S, 'POST', `/boards/${board}/suggestions`, { description: 'Sharper wording', update: [{ id: X, text: 'Agent rewrite' }] });
      assert(up.status === 201, `propose update: ${up.status} ${up.text}`);
      const upId = up.json.group.suggestions[0].id;
      await waitFor(() => !!els(e).get(X) && !!sug(e).get(upId), 5000, 'the sticky and the suggestion on instance two');
      els(e).set(X, { ...els(e).get(X), text: '<p>Bob was here</p>' }); // someone edits it after it was proposed
      await waitFor(() => els(o).get(X)?.text === '<p>Bob was here</p>', 5000, 'the edit');
      const stale = await call(W, 'POST', `/boards/${board}/suggestions/accept`, { ids: [upId] });
      assert(stale.status === 409 && stale.json.code === 'suggestion_stale' && stale.json.stale[0]?.state === 'changed', `stale: ${stale.status} ${stale.text}`);
      await settled(o, [e]);
      assert(els(e).get(X).text === '<p>Bob was here</p>', 'a stale suggestion overwrote the edit');
      assert((await call(W, 'POST', `/boards/${board}/suggestions/accept`, { ids: [upId], force: true })).status === 200, 'force');
      await waitFor(() => /Agent rewrite/.test(els(e).get(X)?.text ?? ''), 5000, 'the forced rewrite on instance two');

      const acc = await call(W, 'POST', `/boards/${board}/suggestions/accept`, { groupId: first.id });
      assert(acc.status === 200 && acc.json.accepted.length === 7 && acc.json.created.length === 7, `accept the rest: ${acc.status} ${acc.text}`);
      await waitFor(() => acc.json.created.every((id) => els(e).has(id)), 5000, 'the accepted stickies on instance two');
      const made = els(e).get(acc.json.created[0]);
      assert(made.createdBy === O.id && made.suggestedBy?.name === 'Retro agent', `attribution: ${JSON.stringify(made)}`);

      const del = await call(S, 'POST', `/boards/${board}/suggestions`, { description: 'Remove the old note', delete: [X] });
      const delId = del.json.group.suggestions[0].id;
      assert((await call(W, 'POST', `/boards/${board}/suggestions/reject`, { groupId: del.json.group.id })).status === 200, 'reject');
      await waitFor(() => sug(e).get(delId)?.decision?.status === 'rejected', 5000, 'the rejection on instance two');
      assert(els(o).has(X), 'a rejected deletion deleted');
      await waitFor(() => audited('board.suggestion_rejected', (ev) => ev.metadata.via === 'api'), 5000, 'the rejection to be audited');
    });

    await check('suggestions: a facilitator’s lock keeps a participant from accepting (socket and API)', async () => {
      const p = await call(S, 'POST', `/boards/${board}/suggestions`, { create: [{ type: 'sticky', text: 'While locked' }] });
      const id = p.json.group.suggestions[0].id;
      await waitFor(() => !!sug(e).get(id), 5000, 'the suggestion');
      o.doc.getMap('facilitation').set('session', { by: O.id, byName: O.name, startedAt: Date.now(), locked: true, allowedTypes: null, follow: false, cursorsHidden: false });
      await waitFor(() => e.role === 'commenter', 5000, 'the lock to reach the editor');
      sug(e).set(id, { ...sug(e).get(id), decision: { status: 'accepted', by: E.id, at: Date.now() } });
      await settled(e, [o]);
      assert(!sug(o).get(id).decision, "a locked participant's accept reached the owner");
      const et = await token(E, ['boards:read', 'boards:write'], 'editor script');
      const r = await call(et, 'POST', `/boards/${board}/suggestions/accept`, { ids: [id] });
      assert(r.status === 400 && /locked/.test(r.json.error), `locked API accept: ${r.status} ${r.text}`);
      o.doc.getMap('facilitation').delete('session');
      await waitFor(() => e.role === 'editor', 5000, 'the lock to end');
    });

    await check('suggestions: restoring a version leaves pending suggestions alone, and they survive a restart', async () => {
      const named = await O.req('POST', `/api/boards/${board}/versions`, { name: 'Before the agent' });
      assert(named.status === 201, `name a version: ${named.status} ${named.text}`);
      const p = await call(S, 'POST', `/boards/${board}/suggestions`, { description: 'After the version', create: [{ type: 'sticky', text: 'Survivor' }] });
      const id = p.json.group.suggestions[0].id;
      assert((await O.req('POST', `/api/boards/${board}/versions/${named.json.version.id}/restore`)).status === 200, 'restore');
      const listed = async () => (await call(W, 'GET', `/boards/${board}/suggestions`)).json;
      assert(JSON.stringify((await call(W, 'GET', `/boards/${board}/suggestions`)).json).includes(id), 'a restore dropped a pending suggestion');
      for (const cl of clients) cl.destroy();
      clients = [];
      for (const pr of procs) await stopProc(pr);
      await start();
      for (const u of people) u.port = one();
      const after = await listed();
      const pending = after.groups.flatMap((g) => g.suggestions.map((s) => s.id));
      assert(pending.includes(id) && after.groups.some((g) => g.description === 'After the version'), `after a restart: ${JSON.stringify(after).slice(0, 300)}`);
    });
  } finally {
    for (const cl of clients) cl.destroy();
    for (const pr of procs) await stopProc(pr);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// The remote MCP server (KAI-107) and agent participants (KAI-168), driven by the official MCP
// client SDK: dynamic client registration + OAuth 2.1 with PKCE against Freero's real
// authorization server, tools against real boards with a live Yjs client watching, the activity
// feed and the audit log, kill switches. With DATABASE_URL + REDIS_URL also across two instances.
// ---------------------------------------------------------------------------
async function mcpChecks() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js');
  const REDIS_URL = process.env.REDIS_URL?.trim();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-mcp-'));
  const env = { ACTIVITY_IDLE_SECONDS: '1', RATE_LIMIT_INVITE: '500/1h', RATE_LIMIT_PASSWORD: '500/15m', ...(REDIS_URL && ADMIN_URL ? { REDIS_URL } : {}) };
  const procs = [];
  const live = [];
  const clients = [];
  try {
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('mcp server boots', async () => procs.push(await waitUp(await spawnServer(dataDir, env)))))) return;
    const [proc] = procs;
    const mcpUrl = (p = proc) => new URL(`http://127.0.0.1:${p.port}/mcp`);
    const stamp = Date.now();
    const verified = async (label) => {
      const u = new User(label, proc.port);
      u.email = `${label.toLowerCase()}-${stamp}@mcp.verify.freero.app`;
      await u.signup();
      await u.verifyEmail(dataDir);
      return u;
    };
    const token = async (u, scopes, name) => {
      const r = await u.req('POST', '/api/auth/tokens', { name, scopes, expiresInDays: 30 });
      assert(r.status === 201, `token: ${r.status} ${r.text}`);
      return r.json;
    };
    /** An MCP client with a bearer token (a personal token: scripted clients). */
    const withToken = async (secret, p = proc) => {
      const c = new Client({ name: 'verify-script', version: '1.0.0' });
      await c.connect(new StreamableHTTPClientTransport(mcpUrl(p), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
      clients.push(c);
      return c;
    };
    const text = (r) => (r.content ?? []).map((c) => c.text ?? '').join('\n');
    /** How many items the board has, as its owner reads it. */
    const itemCount = async (boardId) => {
      const reader = await withToken((await token(O, ['boards:read'], `count ${Date.now()}`)).secret);
      const r = await reader.callTool({ name: 'get_board_outline', arguments: { boardId, format: 'json' } });
      return JSON.parse(text(r)).untrusted_board_content.meta.itemCount;
    };
    const O = await verified('Owner');
    const C = await verified('Commenter');
    const S = await verified('Stranger');
    const team = (await O.req('POST', '/api/workspaces', { name: 'MCP team' })).json.workspace.id;
    const board = (await O.req('POST', '/api/boards', { title: 'MCP board', workspaceId: team })).json.board.id;
    const strangers = (await S.req('POST', '/api/boards', { title: 'Not yours' })).json.board.id;
    assert((await O.req('POST', `/api/boards/${board}/members`, { email: C.email, role: 'commenter' })).status === 201, 'invite commenter');

    await check('mcp: without a token the server answers 401 naming its protected-resource metadata (also at the bare well-known path), which names Freero as the authorization server', async () => {
      const r = await fetch(mcpUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      const challenge = r.headers.get('www-authenticate') ?? '';
      assert(r.status === 401 && challenge.includes(`resource_metadata="http://127.0.0.1:${proc.port}/.well-known/oauth-protected-resource/mcp"`), `401: ${r.status} ${challenge}`);
      for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
        const meta = await (await fetch(`http://127.0.0.1:${proc.port}${p}`)).json();
        assert(meta.resource === `http://127.0.0.1:${proc.port}/mcp` && meta.authorization_servers[0] === `http://127.0.0.1:${proc.port}`, `${p}: ${JSON.stringify(meta)}`);
        assert(meta.scopes_supported.includes('boards:suggest') && !meta.scopes_supported.includes('members:write'), `${p} scopes: ${meta.scopes_supported}`);
      }
      // The REST API keeps its own metadata.
      const rest = await (await fetch(`http://127.0.0.1:${proc.port}/.well-known/oauth-protected-resource/api/v1`)).json();
      assert(rest.resource.endsWith('/api/v1'), `rest metadata: ${JSON.stringify(rest)}`);
    });

    // The MCP SDK's OAuth client: registers itself, sends the person to the consent screen, PKCE.
    class Provider {
      constructor() {
        this.redirect = 'http://127.0.0.1:53682/callback';
        this.authUrl = null;
      }
      get redirectUrl() {
        return this.redirect;
      }
      get clientMetadata() {
        return { client_name: 'Verify Assistant', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
      }
      clientInformation() {
        return this.client;
      }
      saveClientInformation(c) {
        this.client = c;
      }
      tokens() {
        return this.saved;
      }
      saveTokens(t) {
        this.saved = t;
      }
      redirectToAuthorization(url) {
        this.authUrl = url;
      }
      saveCodeVerifier(v) {
        this.verifier = v;
      }
      codeVerifier() {
        return this.verifier;
      }
    }
    const provider = new Provider();
    let agent = null;

    await check('mcp: a client with no credentials registers itself, the person consents (writing is opt-in), PKCE gets it a token, and it lists only boards that person can open', async () => {
      const first = new StreamableHTTPClientTransport(mcpUrl(), { authProvider: provider });
      let refused = null;
      await new Client({ name: 'verify-assistant', version: '1.0.0' }).connect(first).catch((e) => (refused = e));
      assert(refused instanceof UnauthorizedError && provider.authUrl && provider.client?.client_id?.startsWith('frc_'), `expected a consent redirect: ${refused}`);
      const params = Object.fromEntries(provider.authUrl.searchParams);
      assert(params.code_challenge_method === 'S256' && params.resource === mcpUrl().href, `authorization request: ${provider.authUrl}`);
      const shown = await O.req('GET', `/api/oauth/authorize${provider.authUrl.search}`);
      const optional = shown.json?.consent?.scopes
        ?.filter((s) => s.optional)
        .map((s) => s.id)
        .sort();
      assert(shown.status === 200 && JSON.stringify(optional) === JSON.stringify(['boards:write', 'comments:write']), `consent: ${shown.text}`);
      const decided = await O.req('POST', '/api/oauth/authorize', { ...params, decision: 'allow', grant: ['boards:write', 'comments:write'] });
      const code = decided.json?.redirect && new URL(decided.json.redirect).searchParams.get('code');
      assert(code, `decision: ${decided.text}`);
      await first.finishAuth(code);
      assert(provider.saved?.access_token?.startsWith('fro_') && provider.saved.scope.split(' ').includes('boards:write'), `tokens: ${JSON.stringify(provider.saved?.scope)}`);
      agent = new Client({ name: 'verify-assistant', version: '1.0.0' });
      await agent.connect(new StreamableHTTPClientTransport(mcpUrl(), { authProvider: provider }));
      clients.push(agent);
      const tools = (await agent.listTools()).tools.map((t) => t.name);
      for (const t of ['search_boards', 'list_workspaces', 'get_board_outline', 'create_board', 'add_stickies', 'add_clusters', 'add_diagram', 'add_comment', 'update_items', 'delete_items', 'export_board'])
        assert(tools.includes(t), `missing tool ${t}: ${tools}`);
      assert(tools.includes('propose_changes'), 'propose_changes is not offered although the suggestions layer exists (KAI-169)');
      const found = JSON.parse(text(await agent.callTool({ name: 'search_boards', arguments: {} })));
      const ids = found.untrusted_board_content.boards.map((b) => b.id);
      assert(ids.includes(board) && !ids.includes(strangers), `boards: ${JSON.stringify(ids)}`);
    });

    await check('mcp: a 10-node / 12-edge Mermaid flowchart lands without overlaps, connectors attached, live in an open browser — attributed "<app> for <person>", the app shown in presence while it writes', async () => {
      assert(agent, 'no agent');
      const browser = connectDoc(O, board, null, proc.port);
      live.push(browser);
      await browser.ready();
      const mermaid = [
        'flowchart LR',
        'A[Idea] --> B[Draft]',
        'B --> C[Review]',
        'C -->|ok| D[Ship]',
        'C -->|changes| B',
        'D --> E[Measure]',
        'E --> F[Learn]',
        'F --> A',
        'A --> G[Research]',
        'G --> H[Interview]',
        'H --> I[Synthesis]',
        'I --> J[Decide]',
        'J --> B',
      ].join('\n');
      const res = await agent.callTool({ name: 'add_diagram', arguments: { boardId: board, mermaid } });
      assert(!res.isError, `add_diagram: ${text(res)}`);
      const created = res.structuredContent.created;
      const els = browser.doc.getMap('elements');
      await waitFor(() => created.every((id) => els.has(id)), 5000, 'the diagram to reach the open board');
      const mine = created.map((id) => els.get(id));
      const shapes = mine.filter((e) => e.type === 'shape');
      const lines = mine.filter((e) => e.type === 'connector');
      assert(shapes.length === 10 && lines.length === 12, `shapes ${shapes.length}, connectors ${lines.length}`);
      for (let i = 0; i < shapes.length; i++)
        for (let j = i + 1; j < shapes.length; j++) {
          const a = shapes[i];
          const b = shapes[j];
          assert(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `overlap: ${a.id} ${b.id}`);
        }
      assert(lines.every((l) => l.start?.elementId && l.end?.elementId), `a connector is not attached at both ends: ${JSON.stringify(lines[0].start)}`);
      assert(mine.every((e) => e.createdBy === O.id && e.createdVia?.name === 'Verify Assistant'), `attribution: ${JSON.stringify(mine[0].createdVia)}`);
      const agentState = () => [...browser.provider.awareness.getStates().values()].find((s) => s?.agent?.app === 'Verify Assistant');
      await waitFor(() => agentState(), 5000, 'the app to appear in presence');
      assert(agentState().user.name === `Verify Assistant for ${O.name}` && agentState().selection.some((id) => created.includes(id)), `presence: ${JSON.stringify(agentState())}`);
      await waitFor(() => !agentState(), 12_000, 'the app to leave presence once it stopped writing');
    });

    await check('mcp: the default read + suggest connection and a commenter’s write token can’t add to the board; delete_items without confirm deletes nothing', async () => {
      const count = await itemCount(board);
      const suggest = await withToken((await token(O, ['boards:read', 'boards:suggest'], 'Suggester')).secret);
      const r1 = await suggest.callTool({ name: 'add_stickies', arguments: { boardId: board, stickies: ['nope'] } });
      assert(r1.isError && text(r1).includes('insufficient_scope'), `read+suggest wrote: ${text(r1)}`);
      const commenter = await withToken((await token(C, ['boards:read', 'boards:write', 'comments:write'], 'Commenter app')).secret);
      const r2 = await commenter.callTool({ name: 'add_stickies', arguments: { boardId: board, stickies: ['nope'] } });
      assert(r2.isError, `a commenter’s app wrote: ${text(r2)}`);
      const r3 = await commenter.callTool({ name: 'add_comment', arguments: { boardId: board, text: 'A commenter may comment' } });
      assert(!r3.isError, `commenter comment: ${text(r3)}`);
      const outline = JSON.parse(text(await agent.callTool({ name: 'get_board_outline', arguments: { boardId: board, format: 'json' } })));
      const someId = outline.untrusted_board_content.items[0].id;
      const r4 = await agent.callTool({ name: 'delete_items', arguments: { boardId: board, itemIds: [someId] } });
      assert(r4.isError && text(r4).includes('confirm_required'), `delete without confirm: ${text(r4)}`);
      assert((await itemCount(board)) === count, 'the board changed');
    });

    await check('mcp: a read + suggest connection proposes with propose_changes (the board does not change); an editor accepts it in the app; it reads "<app> for <person>" on the badge, in the outline and in the activity feed (KAI-169)', async () => {
      const count = await itemCount(board);
      const suggester = await withToken((await token(O, ['boards:read', 'boards:suggest'], 'Planning agent')).secret);
      const r = await suggester.callTool({
        name: 'propose_changes',
        arguments: { boardId: board, structure: { kind: 'stickies', items: ['Proposed by MCP one', 'Proposed by MCP two'] }, description: 'Two follow-ups' },
      });
      assert(!r.isError && r.structuredContent.proposed.length === 2, `propose_changes: ${text(r)}`);
      assert((await itemCount(board)) === count, 'propose_changes wrote to the board');
      // The editor's browser: suggestions arrive in the editors layer, from "<app> for <person>".
      const ed = await layerClient(O, board, proc.port);
      live.push(ed);
      const sug = ed.layers.editors.getMap('suggestions');
      await waitFor(() => [...sug.values()].filter((s) => !s.decision && s.description === 'Two follow-ups').length === 2, 5000, 'the proposal to reach the editor');
      const recs = [...sug.values()].filter((s) => s.description === 'Two follow-ups');
      assert(recs.every((s) => s.author.kind === 'app' && s.author.name === 'Planning agent' && s.author.userName === O.name), `author: ${JSON.stringify(recs[0].author)}`);
      const md = await O.req('GET', `/api/boards/${board}/outline?format=markdown&include=suggestions`);
      assert(md.text.includes(`by Planning agent for ${O.name}: "Two follow-ups"`), `outline: ${md.text.slice(-400)}`);
      // Accepting in the app (what Editor.acceptSuggestions writes): the items, and the decisions.
      const watcher = connectDoc(O, board, null, proc.port);
      live.push(watcher);
      await watcher.ready();
      ed.doc.transact(() => recs.forEach((s) => ed.doc.getMap('elements').set(s.element.id, { ...s.element, createdBy: O.id, suggestedBy: { kind: 'app', name: 'Planning agent', userId: O.id } })));
      ed.layers.editors.transact(() => recs.forEach((s) => sug.set(s.id, { ...s, decision: { status: 'accepted', by: O.id, at: Date.now() } })));
      await waitFor(() => recs.every((s) => watcher.doc.getMap('elements').get(s.element.id)?.suggestedBy?.name === 'Planning agent'), 5000, 'the accepted items on the board');
      const after = await O.req('GET', `/api/boards/${board}/outline?format=markdown`);
      assert(after.text.includes('Proposed by MCP one') && after.text.includes('Proposed by MCP two'), 'the accepted items are not on the board');
      await waitFor(
        async () => (await O.req('GET', `/api/boards/${board}/activity`)).json.entries.some((e) => e.actorName === `Planning agent for ${O.name}` && /suggested 2 changes/.test(e.text)),
        5000,
        'the proposal in the activity feed',
      );
    });

    await check('mcp: what the app did shows in the activity feed as "<app> for <person>", and every tool call is in the team’s audit log with the app', async () => {
      await waitFor(
        async () => (await O.req('GET', `/api/boards/${board}/activity`)).json.entries.some((e) => e.actorName === `Verify Assistant for ${O.name}` && /added/.test(e.text)),
        10_000,
        'the app’s burst in the activity feed',
      );
      const events = (await O.req('GET', `/api/workspaces/${team}/audit?action=api.call&limit=200`)).json.events;
      const call = events.find((e) => e.metadata.endpoint === 'MCP add_diagram');
      assert(
        call && call.actor?.id === O.id && call.metadata.credential === 'app' && call.metadata.credentialName === 'Verify Assistant' && call.metadata.status === 200,
        `audit: ${JSON.stringify(events.slice(0, 3))}`,
      );
      assert(events.some((e) => e.metadata.endpoint === 'MCP delete_items' && e.metadata.status === 400), 'the refused delete is not in the log');
    });

    await check('mcp: a team’s downloads policy refuses export_board and outline reads; turning API access off stops the next tool call there', async () => {
      assert((await O.req('POST', `/api/workspaces/${team}/members`, { email: C.email, role: 'member' })).status === 201, 'member');
      assert((await O.req('PATCH', `/api/workspaces/${team}`, { policies: { downloads: 'admins' } })).status === 200, 'policy');
      const member = await withToken((await token(C, ['boards:read'], 'Reader')).secret);
      for (const [name, args] of [
        ['export_board', { boardId: board }],
        ['get_board_outline', { boardId: board }],
      ]) {
        const r = await member.callTool({ name, arguments: args });
        assert(r.isError && text(r).includes('downloads_restricted'), `${name}: ${text(r)}`);
      }
      await O.req('PATCH', `/api/workspaces/${team}`, { policies: { downloads: 'anyone' } });
      assert((await O.req('PATCH', `/api/workspaces/${team}/admin/api`, { enabled: false })).status === 200, 'api off');
      const off = await agent.callTool({ name: 'get_board_outline', arguments: { boardId: board } });
      assert(off.isError && text(off).includes('api_disabled'), `api off: ${text(off)}`);
      assert((await O.req('PATCH', `/api/workspaces/${team}/admin/api`, { enabled: true })).status === 200, 'api on');
    });

    if (ADMIN_URL && REDIS_URL)
      await check('mcp: stateless across instances — one client’s requests alternate between two instances; its writes and presence reach a browser on the first', async () => {
        procs.push(await waitUp(await spawnServer(fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-mcp2-')), env)));
        const browser = connectDoc(O, board, null, procs[0].port);
        live.push(browser);
        await browser.ready();
        // One client, its requests alternating between the two instances (round-robin).
        let n = 0;
        const roundRobin = (url, init) => fetch(String(url).replace(`:${procs[0].port}/`, `:${procs[n++ % 2].port}/`), init);
        const c = new Client({ name: 'verify-rr', version: '1.0.0' });
        await c.connect(new StreamableHTTPClientTransport(mcpUrl(procs[0]), { authProvider: provider, fetch: roundRobin }));
        clients.push(c);
        for (let i = 0; i < 2; i++) {
          const res = await c.callTool({ name: 'add_stickies', arguments: { boardId: board, stickies: [`rr ${i}`] } });
          assert(!res.isError, `round robin ${i}: ${text(res)}`);
          await waitFor(() => res.structuredContent.created.every((id) => browser.doc.getMap('elements').has(id)), 5000, `sticky ${i} on instance 1`);
        }
        assert(n >= 4, `requests did not alternate: ${n}`);
        await waitFor(() => [...browser.provider.awareness.getStates().values()].some((s) => s?.agent?.app === 'Verify Assistant'), 5000, 'the app’s presence across instances');
      });

    await check('mcp: revoking the token, or the app, refuses the very next MCP request', async () => {
      const script = await token(O, ['boards:read'], 'Short-lived');
      const sc = await withToken(script.secret);
      assert(!(await sc.callTool({ name: 'list_workspaces', arguments: {} })).isError, 'works first');
      assert((await O.req('DELETE', `/api/auth/tokens/${script.token.id}`)).status === 200, 'revoke token');
      let gone = null;
      await sc.callTool({ name: 'list_workspaces', arguments: {} }).catch((e) => (gone = e));
      assert(gone, 'a revoked token still answered');
      assert((await O.req('DELETE', `/api/auth/apps/${provider.client.client_id}`)).status === 200, 'revoke app');
      const r = await fetch(mcpUrl(), {
        method: 'POST',
        headers: { authorization: `Bearer ${provider.saved.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
      });
      assert(r.status === 401 && /resource_metadata=/.test(r.headers.get('www-authenticate') ?? ''), `revoked app: ${r.status}`);
    });
  } finally {
    for (const c of clients) await c.close().catch(() => undefined);
    for (const c of live) c.destroy();
    for (const p of procs) await stopProc(p);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// Issue-tracker sync (KAI-153/154/155/156/157) against local mock trackers (scripts/lib/mock-*.mjs):
// Jira Cloud (API token and OAuth 3LO), Jira Data Center (PAT, polling), Linear and GitHub. Real
// server, real Yjs clients, real webhooks signed like the trackers sign them — no real tracker.
async function trackerChecks() {
  const { startMockJira, plainOf } = await import('./lib/mock-jira.mjs');
  const { startMockLinear } = await import('./lib/mock-linear.mjs');
  const { startMockGithub } = await import('./lib/mock-github.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-trackers-'));
  const cloud = await startMockJira({ deployment: 'cloud' });
  const dc = await startMockJira({ deployment: 'datacenter', token: 'dc-personal-access-token' });
  // Access tokens shorter than Freero's refresh margin: every call refreshes first.
  const atlassian = await startMockJira({ deployment: 'cloud', tokenTtlSeconds: 30 });
  const lin = await startMockLinear();
  const gh = await startMockGithub();
  const mocks = [cloud, dc, atlassian, lin, gh];
  let proc = null;
  const live = [];
  const mcpClients = [];
  try {
    const env = {
      ACTIVITY_IDLE_SECONDS: '1',
      TRACKER_PRIVATE_ENDPOINTS: 'true', // the mocks listen on 127.0.0.1
      TRACKER_POLL_SECONDS: '5',
      TRACKER_JIRA_CLIENT_ID: atlassian.clientId,
      TRACKER_JIRA_CLIENT_SECRET: atlassian.clientSecret,
      TRACKER_JIRA_AUTH_URL: atlassian.url,
      TRACKER_JIRA_API_URL: atlassian.url,
      RATE_LIMIT_TRACKER_SEND: '500/10m',
    };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('trackers: server boots', async () => (proc = server = await waitUp(await spawnServer(dataDir, env)))))) return;
    const O = new User('TrackerOwner', proc.port);
    const M = new User('TrackerMember', proc.port);
    const V = new User('TrackerViewer', proc.port);
    const S = new User('TrackerStranger', proc.port);
    for (const u of [O, M, V, S]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    cloud.addUser(M.email, 'Member in Jira');
    const team = (await O.req('POST', '/api/workspaces', { name: 'Tracker team' })).json.workspace;
    assert((await O.req('POST', `/api/workspaces/${team.id}/members`, { email: M.email, role: 'member' })).status === 201, 'member');
    const board = (await O.req('POST', '/api/boards', { title: 'Checkout retro', workspaceId: team.id })).json.board;
    assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: V.email, role: 'viewer' })).status === 201, 'viewer');
    const c = connectDoc(O, board.id);
    live.push(c);
    await c.ready();
    const E = els(c);
    const records = () => c.doc.getMap('trackers');
    const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, '').trim();
    const comments = () => [...c.doc.getMap('comments').values()].filter((r) => r?.kind === 'message').map((r) => r.text);
    const base = { rotation: 0, z: 1, createdBy: O.id, createdAt: Date.now(), updatedAt: Date.now() };

    let cloudConn = null;
    let secret = '';
    await check('trackers: a connection is tested before it is kept, its token never comes back, and only the team’s admins manage it', async () => {
      const body = { provider: 'jira', name: 'Jira Cloud', workspaceId: team.id, site: cloud.url, deployment: 'cloud', email: cloud.email, token: cloud.token, defaults: { project: 'WEB' } };
      const byMember = await M.req('POST', '/api/trackers/connections', body);
      assert(byMember.status === 403 || byMember.status === 404, `a member made a team connection: ${byMember.status}`);
      const wrong = await O.req('POST', '/api/trackers/connections', { ...body, token: 'not-the-token' });
      assert(wrong.status === 400 && /refused the credentials/.test(wrong.json?.error ?? ''), `wrong token: ${wrong.status} ${wrong.text}`);
      assert((await O.req('GET', `/api/trackers/connections?workspace=${team.id}`)).json.connections.length === 0, 'a refused token was kept');
      const made = await O.req('POST', '/api/trackers/connections', body);
      assert(made.status === 201 && made.json.webhookSecret && made.json.connection.account === cloud.email, `create: ${made.status} ${made.text}`);
      assert(!made.text.includes(cloud.token), 'the token came back');
      cloudConn = made.json.connection;
      secret = made.json.webhookSecret;
      const listed = await O.req('GET', `/api/trackers/connections?workspace=${team.id}`);
      assert(!listed.text.includes(cloud.token) && !listed.text.includes(secret), 'the list carries a credential');
      assert((await M.req('GET', `/api/trackers/connections?workspace=${team.id}`)).status !== 200, 'a member listed the team’s connections');
      const forMember = (await M.req('GET', `/api/boards/${board.id}/trackers`)).json.connections;
      assert(forMember.length === 1 && forMember[0].id === cloudConn.id && !JSON.stringify(forMember).includes(cloud.token), `member's board trackers: ${JSON.stringify(forMember)}`);
    });
    if (!cloudConn) return;
    const webhookUrl = `http://127.0.0.1:${proc.port}/api/trackers/webhooks/${cloudConn.id}`;

    // A named cluster: five stickies in a frame, two tagged.
    c.doc.getMap('tags').set('t-ux', { id: 't-ux', name: 'ux', color: '#5B3FF0' });
    E.set('cluster', { ...base, id: 'cluster', type: 'frame', x: 0, y: 0, w: 1200, h: 300, z: 0, title: 'Checkout pain' });
    const notes = ['Card form resets on error', 'No Apple Pay', 'Shipping cost shown too late', 'Coupon field hidden', 'Too many steps'];
    notes.forEach((t, i) => E.set(`n${i}`, { ...base, id: `n${i}`, type: 'sticky', x: 20 + i * 220, y: 40, w: 200, h: 200, frameId: 'cluster', color: 'yellow', text: `<p>${t}</p>`, tags: i < 2 ? ['t-ux'] : [] }));
    const stickyIds = notes.map((_, i) => `n${i}`);

    let cluster = null;
    await check('trackers: five clustered stickies preview and become ONE Jira issue listing all five with links back; every sticky shows its key, all in one change', async () => {
      const preview = await O.req('POST', `/api/boards/${board.id}/trackers/preview`, { connectionId: cloudConn.id, project: 'WEB', itemIds: stickyIds });
      assert(preview.status === 200 && preview.json.issues.length === 1, `preview: ${preview.status} ${preview.text}`);
      const p = preview.json.issues[0].values;
      assert(p.title === 'Checkout pain' && notes.every((n) => p.description.includes(n)) && (p.description.match(/\?item=/g) ?? []).length === 5, `preview values: ${JSON.stringify(p)}`);
      assert(JSON.stringify(p.labels) === '["ux"]', `labels: ${JSON.stringify(p.labels)}`);
      // Nobody may ever see part of a cluster linked: each update leaves 0 or 5 badged stickies.
      const partial = [];
      const watch = () => {
        const n = stickyIds.filter((id) => E.get(id)?.trackerLink).length;
        if (n > 0 && n < 5) partial.push(n);
      };
      c.doc.on('update', watch);
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: cloudConn.id, project: 'WEB', itemIds: stickyIds });
      assert(sent.status === 201 && sent.json.issues.length === 1 && sent.json.issues[0].key === 'WEB-1', `send: ${sent.status} ${sent.text}`);
      cluster = sent.json.issues[0];
      const issue = cloud.issue('WEB-1');
      assert(issue.fields.summary === 'Checkout pain' && notes.every((n) => issue.text.includes(n)), `issue: ${issue.fields.summary} / ${issue.text}`);
      assert(issue.fields.description?.type === 'doc', 'Cloud got no ADF description');
      assert(JSON.stringify(issue.fields.labels) === '["ux"]', `jira labels: ${issue.fields.labels}`);
      assert(issue.remotelinks.length === 5 && stickyIds.every((id) => issue.remotelinks.some((l) => l.globalId === `freero-item=${id}` && l.object.url.includes(`?item=${id}`))), `remote links: ${JSON.stringify(issue.remotelinks)}`);
      await waitFor(() => stickyIds.every((id) => E.get(id)?.trackerLink === cluster.linkId) && records().get(cluster.linkId)?.key === 'WEB-1', 8000, 'the badges on the board');
      c.doc.off('update', watch);
      assert(partial.length === 0, `a half-linked cluster was visible: ${partial}`);
      assert(records().get(cluster.linkId).sources.length === 5, 'record sources');
    });

    await check('trackers: the issue is a Freero object whose backlinks are the five stickies — for people who can see the board, nobody else', async () => {
      const uri = `freero://issue/${cluster.linkId}`;
      await waitFor(async () => (await O.req('GET', `/api/objects/backlinks?uri=${encodeURIComponent(uri)}`)).json?.backlinks?.length === 5, 10_000, 'the backlinks index');
      const links = (await O.req('GET', `/api/objects/backlinks?uri=${encodeURIComponent(uri)}`)).json.backlinks;
      assert(links.every((l) => l.kinds.includes('tracker')) && stickyIds.every((id) => links.some((l) => l.source.uri.endsWith(`#${id}`))), JSON.stringify(links));
      const mine = await O.req('POST', '/api/objects/resolve', { uris: [uri] });
      assert(mine.json.objects[0].status === 'ok' && mine.json.objects[0].object.title === 'WEB-1', mine.text);
      const theirs = await S.req('POST', '/api/objects/resolve', { uris: [uri] });
      assert(theirs.json.objects[0].status === 'unavailable' && !theirs.text.includes('WEB-1'), theirs.text);
      assert((await S.req('GET', `/api/objects/backlinks?uri=${encodeURIComponent(uri)}`)).status === 404, 'a stranger read the backlinks');
    });

    await check('trackers: a viewer has no tracker actions and the server refuses them', async () => {
      assert((await V.req('GET', `/api/boards/${board.id}/trackers`)).json.connections.length === 0, 'a viewer was offered connections');
      const r = await V.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: cloudConn.id, project: 'WEB', itemIds: ['n0'] });
      assert(r.status === 403, `viewer send: ${r.status}`);
    });

    // A kanban with a task card in its "To do" column.
    const COL = 280;
    E.set('kb', {
      ...base,
      id: 'kb',
      type: 'kanban',
      x: 0,
      y: 1000,
      w: 12 + 3 * (COL + 12),
      h: 600,
      z: 0,
      title: '<p>Sprint</p>',
      colW: COL,
      columns: [
        { id: 'c1', title: '<p>To do</p>', status: 'todo', color: '#8A89A3' },
        { id: 'c2', title: '<p>Doing</p>', status: 'doing', color: '#F5A524' },
        { id: 'c3', title: '<p>Done</p>', status: 'done', color: '#1FA463' },
      ],
    });
    E.set('card', { ...base, id: 'card', type: 'card', x: 22, y: 1106, w: 260, h: 120, frameId: 'kb', title: '<p>Pay with one click</p>', description: '<p>Saved cards</p>', color: '#5B3FF0', status: 'todo', tags: [], assigneeId: null, dueDate: null });
    let cardIssue = null;
    await check('trackers: a status change in Jira reaches the board through a signed webhook — the card moves to the column with that status; a forged delivery changes nothing', async () => {
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: cloudConn.id, project: 'WEB', itemIds: ['card'] });
      assert(sent.status === 201, `send card: ${sent.status} ${sent.text}`);
      cardIssue = sent.json.issues[0];
      cloud.edit(cardIssue.key, { status: 'doing' });
      assert((await cloud.webhook(webhookUrl, 'forged-secret', cardIssue.key)) === 401, 'a forged webhook was accepted');
      const tampered = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature': 'sha256=' + '0'.repeat(64) }, body: '{"issue":{"id":"1"}}' });
      assert(tampered.status === 401, `unsigned body: ${tampered.status}`);
      await settled(c);
      assert(E.get('card').status === 'todo', 'a forged webhook changed the card');
      assert((await cloud.webhook(webhookUrl, secret, cardIssue.key)) === 202, 'signed webhook refused');
      await waitFor(() => E.get('card').status === 'doing', 8000, 'the card to take the new status');
      const card = E.get('card');
      const left = 0 + 12 + 1 * (COL + 12);
      assert(card.x + card.w / 2 >= left && card.x + card.w / 2 < left + COL, `card not in the Doing column: x=${card.x}`);
      await waitFor(() => records().get(cardIssue.linkId)?.status === 'In Progress', 5000, 'the badge to show the new status');
      await waitFor(async () => ((await O.req('GET', `/api/boards/${board.id}/activity`)).json?.entries ?? []).some((e) => e.actorName.startsWith('Jira for')), 8000, 'the activity feed to show Jira’s change');
    });

    await check('trackers: a tag added on the board updates the issue’s labels', async () => {
      c.doc.getMap('tags').set('t-pay', { id: 't-pay', name: 'checkout flow', color: '#2E9BF0' });
      E.set('n3', { ...E.get('n3'), tags: ['t-pay'] });
      await waitFor(() => JSON.stringify([...cloud.issue('WEB-1').fields.labels].sort()) === '["checkout-flow","ux"]', 10_000, `WEB-1 labels (now ${cloud.issue('WEB-1').fields.labels})`);
    });

    await check('trackers: the same field changed on both sides keeps Jira’s value with a visible note; different fields changed on each side both survive', async () => {
      cloud.edit(cardIssue.key, { summary: 'One-click checkout (Jira)', status: 'done' }); // no webhook: same sync window
      E.set('card', { ...E.get('card'), title: '<p>One-click pay (board)</p>', dueDate: '2026-12-01' });
      await waitFor(() => plain(E.get('card').title) === 'One-click checkout (Jira)' && E.get('card').status === 'done', 10_000, `the merge on the board (title ${plain(E.get('card').title)}, status ${E.get('card').status})`);
      await waitFor(() => cloud.issue(cardIssue.key).fields.duedate === '2026-12-01', 5000, 'the due date in Jira');
      assert(cloud.issue(cardIssue.key).fields.summary === 'One-click checkout (Jira)', 'Jira lost its title');
      await waitFor(() => comments().some((t) => t.includes('One-click pay (board)') && /Title/.test(t)), 5000, 'the conflict note');
    });

    await check('trackers: moving a card to a status the Jira workflow forbids leaves a note instead of forcing it; story points round-trip with the estimate', async () => {
      E.set('card2', { ...base, id: 'card2', type: 'card', x: 1400, y: 0, w: 260, h: 120, title: '<p>Refund flow</p>', description: '', color: '#5B3FF0', status: 'todo', tags: [], assigneeId: M.id, dueDate: null, estimate: '5' });
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: cloudConn.id, project: 'WEB', itemIds: ['card2'] });
      assert(sent.status === 201, `send: ${sent.text}`);
      const key = sent.json.issues[0].key;
      const issue = cloud.issue(key);
      assert(issue.fields.customfield_10016 === 5, `story points: ${issue.fields.customfield_10016}`);
      assert(issue.fields.assignee?.emailAddress === M.email, `assignee: ${JSON.stringify(issue.fields.assignee)}`);
      cloud.forbidTransition(key, 'done');
      E.set('card2', { ...E.get('card2'), status: 'done' });
      await waitFor(() => comments().some((t) => t.includes(key) && /no transition/.test(t)), 10_000, 'the “no transition” note');
      assert(cloud.issue(key).statusCategory === 'new', 'the status was forced');
      cloud.edit(key, { estimate: 8 });
      assert((await cloud.webhook(webhookUrl, secret, key)) === 202, 'webhook');
      await waitFor(() => E.get('card2').estimate === '8', 8000, 'the estimate from Jira');
    });

    await check('trackers: deleting a sticky takes it out of the issue’s links back; the issue stays', async () => {
      E.delete('n4');
      await waitFor(() => cloud.issue('WEB-1').remotelinks.length === 4, 10_000, `WEB-1 remote links (${cloud.issue('WEB-1').remotelinks.length})`);
      await waitFor(() => records().get(cluster.linkId)?.sources.length === 4, 5000, 'the badge’s sources');
      assert(!cloud.issue('WEB-1').remotelinks.some((l) => l.globalId === 'freero-item=n4'), 'the deleted sticky’s link stayed');
    });

    await check('trackers: a tracker that rate limits Freero is retried after the wait it asked for', async () => {
      cloud.rateLimitNext(2, 1);
      E.set('n2', { ...E.get('n2'), text: '<p>Shipping cost shown at the very end</p>' });
      await waitFor(() => cloud.issue('WEB-1').text.includes('Shipping cost shown at the very end'), 15_000, 'the description after the rate limit');
      assert(cloud.rateLimitRemaining() === 0, 'the rate-limited answers were never asked for');
    });

    await check('trackers: Jira Data Center without webhooks syncs by polling (REST v2, wiki markup, personal access token)', async () => {
      const made = await O.req('POST', '/api/trackers/connections', { provider: 'jira', name: 'Jira DC (mine)', site: dc.url, deployment: 'datacenter', token: dc.token, inbound: 'polling' });
      assert(made.status === 201 && made.json.connection.scope === 'personal', `personal DC connection: ${made.status} ${made.text}`);
      const dcConn = made.json.connection;
      assert(!(await M.req('GET', `/api/boards/${board.id}/trackers`)).json.connections.some((x) => x.id === dcConn.id), 'someone else may use a personal connection');
      E.set('dc1', { ...base, id: 'dc1', type: 'sticky', x: 1400, y: 400, w: 200, h: 200, color: 'blue', text: '<p>Audit log export</p>', tags: [] });
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: dcConn.id, project: 'OPS', itemIds: ['dc1'] });
      assert(sent.status === 201, `DC send: ${sent.status} ${sent.text}`);
      const issue = dc.issue(sent.json.issues[0].key);
      assert(typeof issue.fields.description === 'string' && /\[Open on the Freero board\|http/.test(issue.fields.description), `wiki markup: ${JSON.stringify(issue.fields.description)}`);
      assert(dc.requests.every((r) => !r.path.startsWith('/rest/api/3')), 'DC was called on REST v3');
      dc.edit(issue.key, { summary: 'Audit log export (CSV)' });
      await waitFor(() => plain(E.get('dc1').text) === 'Audit log export (CSV)', 25_000, 'the polled change on the sticky');
    });

    await check('trackers: importing a JQL query places one linked card per issue without overlap; importing it again adds nothing', async () => {
      for (let i = 1; i <= 50; i++) cloud.create('OPS', { summary: `Ops task ${i}`, labels: ['ops'], description: { type: 'doc', version: 1, content: [] } });
      const r = await O.req('POST', `/api/boards/${board.id}/trackers/import`, { connectionId: cloudConn.id, query: 'project = OPS', limit: 50 });
      assert(r.status === 201 && r.json.created.length === 50 && r.json.skipped === 0, `import: ${r.status} ${r.text.slice(0, 300)}`);
      await waitFor(() => r.json.created.every((id) => E.get(id)), 8000, 'the imported cards');
      const cards = r.json.created.map((id) => E.get(id));
      assert(cards.every((x) => x.type === 'card' && records().get(x.trackerLink)?.sources.includes(x.id)), 'an imported card is not linked');
      const others = [...E.values()].filter((x) => !r.json.created.includes(x.id) && x.type !== 'kanban');
      const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) assert(!overlap(cards[i], cards[j]), `cards ${i} and ${j} overlap`);
        for (const o of others) assert(!overlap(cards[i], o), `card ${i} overlaps ${o.id}`);
      }
      const again = await O.req('POST', `/api/boards/${board.id}/trackers/import`, { connectionId: cloudConn.id, query: 'project = OPS', limit: 50 });
      assert(again.status === 201 && again.json.created.length === 0 && again.json.skipped === 50, `re-import: ${again.text}`);
      await waitFor(() => cloud.issue('OPS-1').remotelinks.length === 1, 10_000, 'the imported issue’s link back to its card');
      const bad = await O.req('POST', `/api/boards/${board.id}/trackers/import`, { connectionId: cloudConn.id, query: 'assignee was nobody' });
      assert(bad.status === 400 && /JQL/.test(bad.json.error), `bad JQL: ${bad.status} ${bad.text}`);
    });

    await check('trackers: MCP sync_to_tracker sends items as one issue for the agent’s person', async () => {
      const tok = await O.req('POST', '/api/auth/tokens', { name: 'Planner agent', scopes: ['boards:read', 'boards:write'], expiresInDays: 1 });
      assert(tok.status === 201, tok.text);
      const mcp = new Client({ name: 'verify-trackers', version: '1.0.0' });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${proc.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tok.json.secret}` } } }));
      mcpClients.push(mcp);
      E.set('m1', { ...base, id: 'm1', type: 'sticky', x: 1800, y: 0, w: 200, h: 200, color: 'green', text: '<p>Dark mode</p>', tags: [] });
      E.set('m2', { ...base, id: 'm2', type: 'sticky', x: 2020, y: 0, w: 200, h: 200, color: 'green', text: '<p>High contrast</p>', tags: [] });
      const res = await mcp.callTool({ name: 'sync_to_tracker', arguments: { boardId: board.id, itemIds: ['m1', 'm2'], connection: 'Jira Cloud', project: 'WEB' } });
      const text = (res.content ?? []).map((x) => x.text ?? '').join('\n');
      assert(!res.isError && /Created 1 issue: WEB-\d+ \(2 items\)/.test(text), `mcp: ${text}`);
      const key = /WEB-\d+/.exec(text)[0];
      assert(['Dark mode', 'High contrast'].every((t) => cloud.issue(key).text.includes(t)), 'the issue lacks the stickies');
      const viewer = await V.req('POST', '/api/auth/tokens', { name: 'Viewer agent', scopes: ['boards:read', 'boards:write'], expiresInDays: 1 });
      const vc = new Client({ name: 'verify-trackers-viewer', version: '1.0.0' });
      await vc.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${proc.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${viewer.json.secret}` } } }));
      mcpClients.push(vc);
      const refused = await vc.callTool({ name: 'sync_to_tracker', arguments: { boardId: board.id, itemIds: ['n0'] } });
      assert(refused.isError, 'a viewer’s agent sent items to the tracker');
    });

    await check('trackers: Jira Cloud through OAuth (3LO) — only the browser that started the consent finishes it; access tokens are refreshed', async () => {
      const begin = async () => {
        const s = await fetch(`http://127.0.0.1:${proc.port}/api/trackers/oauth/jira/start?workspace=${team.id}&name=Jira+via+Atlassian`, { headers: { cookie: O.cookie }, redirect: 'manual' });
        assert(s.status === 302 && s.headers.get('location').startsWith(`${atlassian.url}/authorize`), `start: ${s.status} ${s.headers.get('location')}`);
        const browser = /freero_tracker_oauth=([^;]+)/.exec(s.headers.getSetCookie().join(';'))?.[1];
        const consent = await fetch(s.headers.get('location'), { redirect: 'manual' });
        return { browser, callback: new URL(consent.headers.get('location')) };
      };
      const stolen = await begin();
      const elsewhere = await fetch(`http://127.0.0.1:${proc.port}${stolen.callback.pathname}${stolen.callback.search}`, { headers: { cookie: O.cookie }, redirect: 'manual' });
      assert(elsewhere.status === 400, `a callback without the starting browser's cookie: ${elsewhere.status}`);
      const ok = await begin();
      const done = await fetch(`http://127.0.0.1:${proc.port}${ok.callback.pathname}${ok.callback.search}`, { headers: { cookie: `${O.cookie}; freero_tracker_oauth=${ok.browser}` }, redirect: 'manual' });
      assert(done.status === 302 && /tracker_connected=1/.test(done.headers.get('location')), `callback: ${done.status} ${done.headers.get('location')}`);
      const conn = (await O.req('GET', `/api/trackers/connections?workspace=${team.id}`)).json.connections.find((x) => x.auth === 'oauth');
      assert(conn && conn.site === atlassian.url, 'no OAuth connection');
      E.set('o1', { ...base, id: 'o1', type: 'sticky', x: 2400, y: 0, w: 200, h: 200, color: 'pink', text: '<p>Gift cards</p>', tags: [] });
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: conn.id, project: 'WEB', itemIds: ['o1'] });
      assert(sent.status === 201, `OAuth send: ${sent.status} ${sent.text}`);
      assert(atlassian.requests.some((r) => r.path.startsWith('/ex/jira/cloud-1/rest/api/3/issue')), 'the API gateway was not used');
      assert(atlassian.requests.filter((r) => r.path === '/oauth/token' && r.body.includes('refresh_token')).length >= 1, 'the expiring access token was never refreshed');
    });

    await check('trackers: Linear — a cluster becomes one issue with an attachment per sticky, and a signed webhook moves the card', async () => {
      const made = await O.req('POST', '/api/trackers/connections', { provider: 'linear', name: 'Linear', workspaceId: team.id, site: lin.url, token: lin.apiKey, defaults: { project: 'ENG' } });
      assert(made.status === 201, `linear connection: ${made.status} ${made.text}`);
      const lc = made.json.connection;
      E.set('l1', { ...base, id: 'l1', type: 'sticky', x: 0, y: 2000, w: 200, h: 200, color: 'yellow', text: '<p>Onboarding checklist</p>', tags: ['t-ux'] });
      E.set('l2', { ...base, id: 'l2', type: 'sticky', x: 220, y: 2000, w: 200, h: 200, color: 'yellow', text: '<p>Welcome email</p>', tags: [] });
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: lc.id, project: 'ENG', itemIds: ['l1', 'l2'] });
      assert(sent.status === 201 && /^ENG-\d+$/.test(sent.json.issues[0].key), `linear send: ${sent.status} ${sent.text}`);
      const issue = lin.issueByKey(sent.json.issues[0].key);
      assert(issue.attachments.length === 2 && issue.labels.includes('ux'), `linear issue: ${JSON.stringify(issue)}`);
      E.set('l3', { ...base, id: 'l3', type: 'card', x: 500, y: 2000, w: 260, h: 120, title: '<p>Invite teammates</p>', description: '', color: '#5B3FF0', status: 'todo', tags: [], assigneeId: null, dueDate: null });
      const card = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: lc.id, project: 'ENG', itemIds: ['l3'] });
      const key = card.json.issues[0].key;
      lin.edit(key, { stateType: 'completed' });
      assert((await lin.webhook(`http://127.0.0.1:${proc.port}/api/trackers/webhooks/${lc.id}`, made.json.webhookSecret, key, { age: 5 * 60_000 })) === 401, 'an old (replayed) Linear delivery was accepted');
      assert((await lin.webhook(`http://127.0.0.1:${proc.port}/api/trackers/webhooks/${lc.id}`, made.json.webhookSecret, key)) === 202, 'Linear webhook refused');
      await waitFor(() => E.get('l3').status === 'done', 8000, 'the Linear state on the card');
    });

    await check('trackers: GitHub — Freero writes only its own section of the issue body; what people write outside it survives a sync', async () => {
      const made = await O.req('POST', '/api/trackers/connections', { provider: 'github', name: 'GitHub', workspaceId: team.id, site: gh.url, token: gh.token, defaults: { project: 'acme/web' } });
      assert(made.status === 201, `github connection: ${made.status} ${made.text}`);
      const gc = made.json.connection;
      E.set('g1', { ...base, id: 'g1', type: 'sticky', x: 0, y: 2400, w: 200, h: 200, color: 'yellow', text: '<p>Flaky login test</p>', tags: [] });
      const sent = await O.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: gc.id, project: 'acme/web', itemIds: ['g1'] });
      assert(sent.status === 201 && sent.json.issues[0].key === 'acme/web#1', `github send: ${sent.status} ${sent.text}`);
      gh.edit('acme/web', 1, { body: `Seen on CI three times this week.\n\n${gh.issue('acme/web', 1).body}` });
      E.set('g1', { ...E.get('g1'), text: '<p>Flaky login test on Safari</p>' });
      await waitFor(() => gh.issue('acme/web', 1).body.includes('Flaky login test on Safari'), 10_000, 'the board’s change in the issue');
      const body = gh.issue('acme/web', 1).body;
      assert(body.startsWith('Seen on CI three times this week.'), `the text outside Freero's section was lost: ${body}`);
      assert(/\?item=g1/.test(body), 'no link back to the board item');
    });

    await check('trackers: every sync is in the workspace’s audit log, and no credential appears there or in the server log', async () => {
      const events = (await O.req('GET', `/api/workspaces/${team.id}/audit?limit=500`)).json.events;
      const actions = new Set(events.map((e) => e.action));
      for (const a of ['tracker.connection_created', 'tracker.issue_created', 'tracker.synced', 'tracker.issues_imported']) assert(actions.has(a), `audit lacks ${a}`);
      const all = JSON.stringify(events) + proc.log.join('');
      for (const s of [cloud.token, dc.token, secret, lin.apiKey, gh.token]) assert(!all.includes(s), 'a credential is in the audit log or the server log');
      const failures = proc.log
        .join('')
        .split('\n')
        .filter((l) => l.includes('"level":"error"') && l.includes('trackers'));
      assert(!failures.length, `unexpected sync errors: ${failures.join(' | ').slice(0, 2000)}`);
    });

    await check('trackers: removing the connection stops sync and leaves the board items as they were', async () => {
      const textBefore = stickyIds.slice(0, 4).map((id) => E.get(id).text);
      assert((await M.req('DELETE', `/api/trackers/connections/${cloudConn.id}`)).status === 404, 'a member removed the team’s connection');
      assert((await O.req('DELETE', `/api/trackers/connections/${cloudConn.id}`)).status === 200, 'remove');
      await waitFor(() => records().get(cluster.linkId)?.state === 'disconnected', 8000, 'the badge to say disconnected');
      cloud.edit('WEB-1', { summary: 'Renamed after the disconnect' });
      assert((await cloud.webhook(webhookUrl, secret, 'WEB-1')) === 404, 'a removed connection still took webhooks');
      await settled(c);
      assert(stickyIds.slice(0, 4).every((id, i) => E.get(id).text === textBefore[i] && E.get(id).trackerLink === cluster.linkId), 'board items changed');
    });
  } finally {
    for (const m of mcpClients) await m.close().catch(() => undefined);
    for (const l of live) l.destroy();
    if (proc) await stopProc(proc);
    for (const m of mocks) await m.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Workshop features on a real server with raw clients: live activities (KAI-132), task-card
// notifications (KAI-135), share-link password and expiry (KAI-145), call links (KAI-134).
// ---------------------------------------------------------------------------
async function collabChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-collab-'));
  let proc = null;
  const clients = [];
  try {
    const ok = await check('collab server boots (Jitsi configured, digest job every second, no email delay)', async () => {
      const env = { JITSI_BASE_URL: 'https://meet.example.org/', NOTIFY_EMAIL_INTERVAL_SECONDS: '1', NOTIFY_EMAIL_DELAY_SECONDS: '0' };
      if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
      proc = await waitUp(await spawnServer(dataDir, env));
    });
    if (!ok) return;
    const port = proc.port;
    const O = new User('CollabOwner', port);
    const E = new User('CollabEditor', port);
    const V = new User('CollabViewer', port);
    const L = new User('CollabLink', port);
    for (const u of [O, E, V, L]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const board = (await O.req('POST', '/api/boards', { title: 'All hands' })).json.board;
    assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: E.email, role: 'editor' })).status === 201, 'invite editor');
    assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: V.email, role: 'viewer' })).status === 201, 'invite viewer');
    const join = async (u, id = board.id) => {
      const c = connectDoc(u, id, undefined, port);
      clients.push(c);
      await c.ready();
      return c;
    };
    const e = await join(E);
    const v = await join(V);
    const results = (c) => c.doc.getMap('engageResults');
    const poll = {
      id: 'poll1', type: 'activity', x: 0, y: 0, w: 520, h: 340, rotation: 0, z: 1, createdBy: E.id, createdAt: Date.now(), updatedAt: Date.now(),
      kind: 'poll', question: 'Offsite?', options: [{ id: 'a', text: 'Lisbon' }, { id: 'b', text: 'Oslo' }], maxChoices: 1,
      anonymous: true, results: 'live', guests: false, color: '#5B3FF0',
    };

    await check('live poll: a viewer answers over REST, every client gets only the counts — no answerer id or name ever reaches a socket — and a changed answer replaces the old one', async () => {
      els(e).set(poll.id, poll);
      await waitFor(() => els(v).has(poll.id), 5000, 'the poll to reach the viewer');
      const a1 = await V.req('PUT', `/api/boards/${board.id}/activities/${poll.id}/answer`, { answer: { choices: ['a'] } });
      assert(a1.status === 200 && a1.json.mine?.choices?.[0] === 'a', a1.text);
      await waitFor(() => results(e).get(poll.id)?.poll?.[0]?.count === 1, 5000, 'the result to reach the editor');
      const a2 = await V.req('PUT', `/api/boards/${board.id}/activities/${poll.id}/answer`, { answer: { choices: ['b'] } });
      assert(a2.status === 200, a2.text);
      await waitFor(() => results(e).get(poll.id)?.poll?.[1]?.count === 1, 5000, 'the changed answer to reach the editor');
      const r = results(e).get(poll.id);
      assert(r.respondents === 1 && r.poll[0].count === 0, JSON.stringify(r));
      for (const c of [e, v]) assert(!sharedText(c).includes(V.id) && !sharedText(c).includes(V.name), `${c.user.label} received who answered`);
      const two = await V.req('PUT', `/api/boards/${board.id}/activities/${poll.id}/answer`, { answer: { choices: ['a', 'b'] } });
      assert(two.status === 400, `two choices on a single-choice poll -> ${two.status}`);
    });

    await check('an editor socket cannot forge or erase published results: its write is undone and it converges', async () => {
      results(e).set(poll.id, { activityId: poll.id, respondents: 99, sealed: false, updatedAt: 1, poll: [{ optionId: 'a', count: 99 }] });
      results(e).set('forged', { activityId: 'forged', respondents: 5, sealed: false, updatedAt: 1 });
      await settled(e, [v]);
      await waitFor(() => results(e).get(poll.id)?.respondents === 1 && !results(e).has('forged'), 5000, 'the editor to converge back');
      assert(results(v).get(poll.id)?.respondents === 1 && !results(v).has('forged'), 'a forged result reached the viewer');
    });

    await check('sealed results stay off every client until an editor reveals them; a viewer can’t reveal', async () => {
      els(e).set('poll2', { ...poll, id: 'poll2', results: 'reveal' });
      await waitFor(() => els(v).has('poll2'), 5000, 'the sealed poll');
      assert((await V.req('PUT', `/api/boards/${board.id}/activities/poll2/answer`, { answer: { choices: ['b'] } })).status === 200, 'answer sealed');
      await waitFor(() => results(v).get('poll2')?.respondents === 1, 5000, 'the count');
      assert(results(v).get('poll2').sealed === true && !results(v).get('poll2').poll, JSON.stringify(results(v).get('poll2')));
      assert((await V.req('POST', `/api/boards/${board.id}/activities/poll2/reveal`, { revealed: true })).status === 403, 'a viewer revealed');
      assert((await E.req('POST', `/api/boards/${board.id}/activities/poll2/reveal`, { revealed: true })).status === 200, 'reveal');
      await waitFor(() => results(v).get('poll2')?.poll?.[1]?.count === 1, 5000, 'the revealed result');
    });

    await check('an activity inside a hidden frame publishes its results to owners/editors only; shown again, its results follow it to everyone (KAI-230)', async () => {
      const eL = await layerClient(E, board.id, port);
      const vL = await layerClient(V, board.id, port);
      clients.push(eL, vL);
      const vBytes = [];
      for (const d of [vL.doc, vL.layers.private, vL.layers.editors]) d.on('update', (u) => vBytes.push(Buffer.from(u)));
      const hidden = { ...poll, id: 'pollHidden', question: 'Which team goes?', options: [{ id: 'a', text: 'Team A' }, { id: 'b', text: 'Team B' }] };
      eL.layers.editors.getMap('elements').set(hidden.id, hidden);
      await settled(eL);
      assert((await E.req('PUT', `/api/boards/${board.id}/activities/${hidden.id}/answer`, { answer: { choices: ['b'] } })).status === 200, 'the editor answers');
      await waitFor(() => eL.layers.editors.getMap('engageResults').get(hidden.id)?.poll?.[1]?.count === 1, 5000, "the hidden activity's results to reach the editor's editors layer");
      await settled(eL, [vL]);
      assert(!vBytes.some((b) => b.includes(Buffer.from(hidden.id))), "the viewer's socket received the hidden activity's results");
      assert(!eL.doc.getMap('engageResults').has(hidden.id), "the hidden activity's results are in the shared doc");
      // The frame is shown: the activity moves to the shared doc (as the web app moves it), the server moves its results along.
      eL.doc.getMap('elements').set(hidden.id, hidden);
      eL.layers.editors.getMap('elements').delete(hidden.id);
      await waitFor(() => vL.doc.getMap('engageResults').get(hidden.id)?.poll?.[1]?.count === 1, 5000, "the viewer to get the shown activity's results");
      await waitFor(() => !eL.layers.editors.getMap('engageResults').has(hidden.id), 5000, 'the results to leave the editors layer');
      eL.doc.getMap('elements').delete(hidden.id);
    });

    await check('an activity closed to visitors refuses a guest; the same guest answers once it allows them', async () => {
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'viewer' })).status === 200, 'link on');
      const G = new User('CollabGuest', port);
      const joined = await G.req('POST', `/api/guest/boards/${board.id}/join`, { name: 'Kim' });
      assert(joined.status === 201, joined.text);
      const refused = await G.req('PUT', `/api/boards/${board.id}/activities/${poll.id}/answer`, { answer: { choices: ['a'] } });
      assert(refused.status === 409, `guest on a members-only activity -> ${refused.status}`);
      els(e).set(poll.id, { ...els(e).get(poll.id), guests: true });
      await settled(e);
      const ok = await G.req('PUT', `/api/boards/${board.id}/activities/${poll.id}/answer`, { answer: { choices: ['a'] } });
      assert(ok.status === 200, ok.text);
      await waitFor(() => results(e).get(poll.id)?.respondents === 2, 5000, 'the guest’s answer to count');
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'none' })).status === 200, 'link off');
    });

    const handled = () => gauge(proc, 'freero_notifications_card_changes_settled_total');
    const inbox = async (u) => (await u.req('GET', '/api/notifications')).json.notifications;
    await check('a card assigned over a socket notifies its assignee once — never the assigner — after the picker settles', async () => {
      const before = await handled();
      const card = { id: 'task1', type: 'card', x: 0, y: 600, w: 300, h: 90, rotation: 0, z: 2, createdBy: E.id, createdAt: Date.now(), updatedAt: Date.now(), title: 'Book the venue', description: '', color: '#5B3FF0', status: 'todo', assigneeId: null, dueDate: null, tags: [] };
      els(e).set(card.id, card);
      els(e).set(card.id, { ...card, assigneeId: O.id });
      els(e).set(card.id, { ...card, assigneeId: V.id });
      await waitFor(async () => (await handled()) > before, 10_000, 'the card change to settle');
      const got = (await inbox(V)).filter((n) => n.type === 'card.assigned');
      assert(got.length === 1 && got[0].actor?.id === E.id && got[0].link === `/board/${board.id}?item=task1`, JSON.stringify(got));
      assert(!(await inbox(O)).some((n) => n.type === 'card.assigned'), 'a passing assignee was notified');
      assert(!(await inbox(E)).some((n) => n.type?.startsWith('card.')), 'the assigner was notified');
    });

    await check('a card due tomorrow reminds its assignee once, in their email digest too', async () => {
      const before = await handled();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      els(e).set('task1', { ...els(e).get('task1'), dueDate: tomorrow });
      await waitFor(async () => (await handled()) > before, 10_000, 'the due date to settle');
      await waitFor(async () => (await inbox(V)).some((n) => n.type === 'card.due_soon'), 10_000, 'the reminder');
      const runs = await gauge(proc, 'freero_notifications_digest_runs_total');
      await waitFor(async () => (await gauge(proc, 'freero_notifications_digest_runs_total')) >= runs + 2, 10_000, 'two more digest runs');
      assert((await inbox(V)).filter((n) => n.type === 'card.due_soon').length === 1, 'reminded twice');
      await waitFor(() => outbox(dataDir).some((m) => m.to === V.email && /is due/.test(m.text)), 10_000, 'the reminder in the digest email');
    });

    await check('a card assigned inside a private draft notifies nobody until the draft is revealed — then its assignee, as from its author', async () => {
      const p = await layerClient(E, board.id, port);
      clients.push(p);
      const card = (id, assigneeId) => ({ id, type: 'card', x: 400, y: 600, w: 300, h: 90, rotation: 0, z: 3, createdBy: E.id, createdAt: Date.now(), updatedAt: Date.now(), title: 'Secret plan', description: '', color: '#5B3FF0', status: 'todo', assigneeId, dueDate: null, tags: [] });
      const before = await handled();
      p.layers.private.getMap('elements').set('draft1', card('draft1', V.id));
      await settled(p);
      // A barrier: a shared card changed AFTER the draft settles after it; a draft reported like it would have settled first.
      els(e).set('later1', card('later1', O.id));
      await waitFor(async () => (await handled()) > before, 10_000, 'the later card to settle');
      assert(!(await inbox(V)).some((n) => n.link?.endsWith('item=draft1')), 'a private draft notified its assignee');
      const revealedFrom = await handled();
      p.layerOp({ type: 'reveal', collection: 'elements', mine: true });
      await waitFor(async () => (await handled()) > revealedFrom, 10_000, 'the revealed card to settle');
      const got = (await inbox(V)).filter((n) => n.link?.endsWith('item=draft1'));
      assert(got.length === 1 && got[0].type === 'card.assigned' && got[0].actor?.id === E.id, JSON.stringify(got));
    });

    await check('a password-protected link: link-only visitors are refused (REST and socket) until they give it, wrong guesses run out, a new password disconnects them, members never need it', async () => {
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkAccess: 'commenter', linkPassword: 'pass one' })).status === 200, 'protect');
      const locked = await L.req('GET', `/api/boards/${board.id}`);
      assert(locked.status === 403 && locked.json?.code === 'link_password_required', locked.text);
      assert((await wsCloseCode(board.id, L.cookie, port)) === 4403, 'a locked visitor’s socket was admitted');
      assert((await L.req('POST', `/api/boards/${board.id}/link-unlock`, { password: 'nope' })).status === 403, 'wrong password accepted');
      assert((await L.req('POST', `/api/boards/${board.id}/link-unlock`, { password: 'pass one' })).status === 200, 'unlock');
      const l = await join(L);
      assert(l.role === 'commenter', `link visitor role ${l.role}`);
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkPassword: 'pass two' })).status === 200, 'new password');
      await waitFor(() => l.closeCodes.includes(4403), 5000, 'the link visitor to be disconnected');
      assert((await V.req('GET', `/api/boards/${board.id}`)).status === 200, 'a member needed the password');
      let limited = 0;
      for (let i = 0; i < 12; i++) if ((await L.req('POST', `/api/boards/${board.id}/link-unlock`, { password: `guess ${i}` })).status === 429) limited++;
      assert(limited > 0, 'password guesses were never rate limited');
    });

    await check('an expired link disconnects its link-only visitors (expiry job) while members stay', async () => {
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkPassword: null })).status === 200, 'password off');
      const l = await join(L);
      assert(l.role === 'commenter', `link visitor role ${l.role}`);
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { linkExpiresAt: Date.now() + 1500 })).status === 200, 'expiry');
      await waitFor(() => l.closeCodes.includes(4403), 20_000, 'the link visitor to be disconnected at expiry');
      assert((await L.req('GET', `/api/boards/${board.id}`)).status === 403, 'an expired link still opened the board');
      assert(v.closeCodes.length === 0, 'a member was disconnected');
      const past = await O.req('PATCH', `/api/boards/${board.id}`, { linkExpiresAt: Date.now() - 1000 });
      assert(past.status === 400, `an expiry in the past -> ${past.status}`);
    });

    await check('call link: only https meeting links; the Jitsi room is the same for everyone on a board, differs per board and never contains the board id; viewers read it, only editors set it', async () => {
      for (const bad of ['javascript:alert(1)', 'http://meet.example.com/x', 'https://user:pw@meet.example.com/x', 'data:text/html,hi'])
        assert((await E.req('PUT', `/api/boards/${board.id}/call`, { url: bad })).status === 400, `accepted ${bad}`);
      assert((await V.req('PUT', `/api/boards/${board.id}/call`, { url: 'https://meet.example.com/abc' })).status === 403, 'a viewer set the call');
      const set = await E.req('PUT', `/api/boards/${board.id}/call`, { jitsi: true });
      assert(set.status === 200 && set.json.call?.kind === 'jitsi', set.text);
      const seen = (await V.req('GET', `/api/boards/${board.id}/call`)).json.call;
      assert(seen.url === set.json.call.url && seen.url.startsWith('https://meet.example.org/') && !seen.url.includes(board.id), seen.url);
      const other = (await O.req('POST', '/api/boards', { title: 'Other' })).json.board;
      const otherCall = (await O.req('PUT', `/api/boards/${other.id}/call`, { jitsi: true })).json.call;
      assert(otherCall.url !== seen.url, 'two boards share a Jitsi room');
      const link = await E.req('PUT', `/api/boards/${board.id}/call`, { url: 'https://meet.example.com/abc-defg' });
      assert(link.status === 200 && link.json.call.url === 'https://meet.example.com/abc-defg', link.text);
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
// Search (KAI-151, KAI-141): the index derived through the outbox from what every reader of a
// board sees, every query re-checked against the reader's live access; the public API's search,
// resolve and backlinks (KAI-227). With DATABASE_URL also the 10 000-board latency check.
// ---------------------------------------------------------------------------
async function searchChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-search-'));
  let proc = null;
  const clients = [];
  try {
    const env = { RATE_LIMIT_SEARCH: '2000/1m' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('search server boots', async () => (proc = await waitUp(await spawnServer(dataDir, env)))))) return;
    const users = Object.fromEntries(['Owner', 'Reader', 'Visitor', 'Stranger'].map((l) => [l, new User(`Search${l}`, proc.port)]));
    for (const u of Object.values(users)) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const { Owner: O, Reader: R, Visitor: L, Stranger: X } = users;
    const join = async (u, boardId, layers = false) => {
      const c = layers ? await layerClient(u, boardId, proc.port) : connectDoc(u, boardId, undefined, proc.port);
      clients.push(c);
      await c.ready();
      return c;
    };
    const search = async (u, q, extra = '') => {
      const r = await u.req('GET', `/api/search?q=${encodeURIComponent(q)}${extra}`);
      assert(r.status === 200, `search ${q}: ${r.status} ${r.text}`);
      return r.json.hits;
    };
    const board = (await O.req('POST', '/api/boards', { title: 'Launch plan' })).json.board;

    await check('a word typed on a sticky through a real socket is found within a derive cycle, opening the board at that sticky; private drafts, hidden frames and comments pinned inside them never match — not even for the owner', async () => {
      const c = await join(O, board.id, true);
      c.doc.transact(() => {
        els(c).set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: '<p>Run the pricing experiment in May</p>', color: 'yellow' });
        els(c).set('hf', { id: 'hf', type: 'frame', x: 400, y: 0, w: 400, h: 400, title: 'Board only', hidden: true });
        els(c).set('in', { id: 'in', type: 'sticky', x: 450, y: 50, w: 100, h: 100, text: 'pricing curtain', frameId: 'hf', color: 'yellow' });
        c.doc.getMap('comments').set('t:t1', { kind: 'thread', id: 't1', x: 0, y: 0, elementId: 's1', createdAt: Date.now(), createdBy: O.id });
        c.doc.getMap('comments').set('m:t1:m1', { kind: 'message', threadId: 't1', id: 'm1', authorId: O.id, authorName: O.name, text: 'Budget approved', createdAt: Date.now() });
        c.doc.getMap('comments').set('t:t2', { kind: 'thread', id: 't2', x: 0, y: 0, elementId: 'in', createdAt: Date.now(), createdBy: O.id });
        c.doc.getMap('comments').set('m:t2:m1', { kind: 'message', threadId: 't2', id: 'm1', authorId: O.id, authorName: O.name, text: 'whispered numbers', createdAt: Date.now() });
      });
      c.layers.private.getMap('elements').set('draft', { id: 'draft', type: 'sticky', x: 0, y: 300, w: 100, h: 100, text: 'pricing draft nobody saw', color: 'yellow' });
      await settled(c);
      await waitFor(async () => (await search(O, 'pricing experiment')).some((h) => h.itemId === 's1'), 15_000, 'the sticky to be found');
      const hits = await search(O, 'pric');
      assert(JSON.stringify(hits.map((h) => `${h.kind}:${h.itemId ?? ''}`)) === JSON.stringify(['item:s1']), `hits: ${JSON.stringify(hits)}`);
      assert(hits[0].path === `/board/${board.id}?el=s1` && hits[0].snippet.includes('pricing'), JSON.stringify(hits[0]));
      const comment = await search(O, 'budget');
      assert(comment.length === 1 && comment[0].path === `/board/${board.id}?thread=t1`, `comment: ${JSON.stringify(comment)}`);
      for (const word of ['curtain', 'draft', 'whispered']) assert((await search(O, word)).length === 0, `"${word}" matched`);
    });

    await check('someone removed from a board stops finding it on the very next query; a board reached only by its link is found once they opened it, never before', async () => {
      assert((await search(R, 'pricing')).length === 0, 'a stranger to the board found it');
      assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: R.email, role: 'viewer' })).status === 201, 'invite');
      assert((await search(R, 'pricing')).length === 1, 'the new viewer finds nothing');
      assert((await O.req('DELETE', `/api/boards/${board.id}/members/${R.id}`)).status === 200, 'remove');
      assert((await search(R, 'pricing')).length === 0, 'found after being removed');

      const linked = (await O.req('POST', '/api/boards', { title: 'Retro' })).json.board;
      assert((await O.req('PATCH', `/api/boards/${linked.id}`, { linkAccess: 'viewer' })).status === 200, 'link');
      const c = await join(O, linked.id);
      els(c).set('r1', { id: 'r1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'quarterly retrospective', color: 'blue' });
      await settled(c);
      await waitFor(async () => (await search(O, 'retrospective')).length === 1, 15_000, 'the retro to be indexed');
      assert((await search(L, 'retrospective')).length === 0, 'a link-only board was found before it was opened');
      assert((await L.req('GET', `/api/boards/${linked.id}`)).status === 200, 'open by link');
      assert((await search(L, 'retrospective')).length === 1, 'not found after opening it');
    });

    await check('renaming a board makes it findable by its new name (a board event through the outbox), and no longer by the old one', async () => {
      assert((await O.req('PATCH', `/api/boards/${board.id}`, { title: 'Pricing launch' })).status === 200, 'rename');
      await waitFor(async () => (await search(O, 'pricing launch')).some((h) => h.kind === 'board'), 15_000, 'the new title to be indexed');
      assert(!(await search(O, 'plan')).some((h) => h.kind === 'board'), 'the old title still matched');
    });

    await check('the public API searches, resolves and lists backlinks with the person’s access and the notice; a stranger’s token learns nothing', async () => {
      const token = async (u) => (await u.req('POST', '/api/auth/tokens', { name: 'search', scopes: ['boards:read'], expiresInDays: 1 })).json.secret;
      const call = (secret, method, url, body) => new User('bearer', proc.port).req(method, `/api/v1${url}`, body, { headers: { authorization: `Bearer ${secret}` }, cookie: false });
      const mine = await token(O);
      const theirs = await token(X);
      const s = await call(mine, 'GET', '/search?q=pricing');
      assert(s.status === 200 && s.json.notice && s.json.hits.some((h) => h.itemId === 's1'), `api search: ${s.status} ${s.text}`);
      assert((await call(theirs, 'GET', '/search?q=pricing')).json.hits.length === 0, 'a stranger’s token found the board');
      const uri = `freero://board/${board.id}#s1`;
      const mineResolved = (await call(mine, 'POST', '/objects/resolve', { uris: [uri] })).json.objects[0];
      assert(mineResolved.status === 'ok' && /pricing/.test(mineResolved.object.title), JSON.stringify(mineResolved));
      const theirsResolved = await call(theirs, 'POST', '/objects/resolve', { uris: [uri] });
      assert(JSON.stringify(theirsResolved.json.objects) === JSON.stringify([{ uri, status: 'unavailable' }]), theirsResolved.text);
      const source = (await O.req('POST', '/api/boards', { title: 'Linking board' })).json.board;
      const c = await join(O, source.id);
      els(c).set('l', { id: 'l', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: `see ${uri}`, color: 'yellow' });
      await settled(c);
      await waitFor(async () => (await call(mine, 'GET', `/objects/backlinks?uri=${encodeURIComponent(uri)}`)).json?.backlinks?.length === 1, 15_000, 'the backlink to show through the API');
      assert((await call(theirs, 'GET', `/objects/backlinks?uri=${encodeURIComponent(uri)}`)).status === 404, 'a stranger got backlinks');
    });

    if (ADMIN_URL)
      await check('search over 10 000 boards answers in under 300 ms (p95) on Postgres', async () => {
        const personal = (await O.req('GET', '/api/workspaces')).json.workspaces.find((w) => w.kind === 'personal').id;
        await adminQuery(
          `INSERT INTO boards (id, title, description, owner_id, link_access, created_at, updated_at, workspace_id)
             SELECT 'perf' || g, 'Perf board ' || g, '', '${O.id}', 'none', now(), now(), '${personal}' FROM generate_series(1, 10000) g;
           INSERT INTO search_entries (board_id, entry_key, kind, element_id, element_type, body, version)
             SELECT 'perf' || g, 'e' || i, 'item', 'e' || i, 'sticky',
                    'note ' || md5((g * 31 + i)::text) || ' ' || (CASE WHEN (g + i) % 97 = 0 THEN 'pricing experiment' ELSE 'weekly sync' END) || ' ' || md5(i::text), 1
             FROM generate_series(1, 10000) g, generate_series(1, 20) i;
           ANALYZE search_entries;`,
          env.DATABASE_URL,
        );
        const times = [];
        for (const q of Array.from({ length: 40 }, (_, i) => ['pricing', 'weekly sync', 'pric exp', `note ${i}`][i % 4])) {
          const t = performance.now();
          await search(O, q);
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        const p95 = times[Math.floor(times.length * 0.95) - 1];
        assert(p95 < 300, `p95 ${p95.toFixed(0)} ms (median ${times[20].toFixed(0)} ms)`);
        console.log(`    search p95 over 10 000 boards / 200 000 entries: ${p95.toFixed(0)} ms`);
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
// Webhooks (KAI-105) on the event stream (KAI-150), against a local receiver (port 4502 when
// free): signed deliveries from real socket edits, settled drags, nothing from drafts, hidden
// frames or private projects, Slack messages, retries and the automatic switch-off.
// ---------------------------------------------------------------------------
async function webhooksChecks() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-verify-webhooks-'));
  let proc = null;
  let receiver = null;
  const clients = [];
  try {
    const { startWebhookReceiver, signedWith } = await import('./lib/webhook-receiver.mjs');
    receiver = await startWebhookReceiver({ port: 4502 }).catch(() => startWebhookReceiver());
    // The receiver is on this machine: the operator's switch for private endpoints is on here.
    const env = { WEBHOOK_PRIVATE_ENDPOINTS: 'true', WEBHOOK_RETRY_BASE_MS: '300', WEBHOOK_DISABLE_AFTER_FAILURES: '3', EVENTS_SETTLE_SECONDS: '1', PUBLIC_URL: 'http://freero.verify' };
    if (ADMIN_URL) env.DATABASE_URL = await createDatabase();
    if (!(await check('webhooks server boots', async () => (proc = await waitUp(await spawnServer(dataDir, env)))))) return;
    const O = new User('HookOwner', proc.port);
    const M = new User('HookMember', proc.port);
    for (const u of [O, M]) {
      await u.signup();
      await u.verifyEmail(dataDir);
    }
    const team = (await O.req('POST', '/api/workspaces', { name: 'Hook team' })).json.workspace;
    assert((await O.req('POST', `/api/workspaces/${team.id}/members`, { email: M.email, role: 'member' })).status === 201, 'member');
    const board = (await O.req('POST', '/api/boards', { title: 'Team roadmap', workspaceId: team.id })).json.board;
    const project = (await O.req('POST', `/api/workspaces/${team.id}/projects`, { name: 'Leadership', access: 'private' })).json.project;
    const secretBoard = (await O.req('POST', '/api/boards', { title: 'Comp review', workspaceId: team.id, projectId: project.id })).json.board;
    const base = `/api/workspaces/${team.id}/admin/webhooks`;
    const got = (p, type) => receiver.received.filter((d) => d.path === p && (!type || d.headers['freero-event'] === type));
    const bodies = (p, type) => got(p, type).map((d) => JSON.parse(d.body));
    const join = async (u, boardId, layers = false) => {
      const c = layers ? await layerClient(u, boardId, proc.port) : connectDoc(u, boardId, undefined, proc.port);
      clients.push(c);
      await c.ready();
      return c;
    };
    let secret = '';
    let hookId = '';

    await check('only owners and admins add webhooks; the signing secret is answered once and the URL is shown shortened; adding is audited without either', async () => {
      assert((await M.req('POST', base, { url: receiver.url('/json'), events: ['item.created'] })).status === 403, 'a member added a webhook');
      const r = await O.req('POST', base, { url: `${receiver.url('/json')}/tok3n-part`, events: ['item.created', 'item.updated', 'comment.created', 'member.added'], description: 'CI' });
      assert(r.status === 201 && r.json.secret.startsWith('whsec_'), r.text);
      secret = r.json.secret;
      hookId = r.json.endpoint.id;
      assert(r.json.endpoint.url.endsWith('/json/…') && !r.json.endpoint.url.includes('tok3n'), `shown: ${r.json.endpoint.url}`);
      const list = await O.req('GET', base);
      assert(!list.text.includes(secret) && !list.text.includes('tok3n'), 'the list carries the secret or the full URL');
      const audit = (await O.req('GET', `/api/workspaces/${team.id}/audit?limit=200`)).json.events;
      assert(audit.some((e) => e.action === 'webhook.created'), 'not audited');
      assert(!JSON.stringify(audit).includes(secret) && !JSON.stringify(audit).includes('tok3n'), 'the audit log carries the secret or URL');
      assert((await O.req('POST', base, { url: receiver.url('/slack'), events: ['item.created'], format: 'slack' })).status === 201, 'slack endpoint');
    });

    await check('a sticky made through a real socket fires exactly one item.created, signed with the endpoint’s secret; dragging it for 2 s fires at most one item.updated', async () => {
      const c = await join(O, board.id);
      els(c).set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: '<p>Ship the importer</p>', color: 'yellow', createdBy: O.id });
      await waitFor(() => got('/json/tok3n-part', 'item.created').length === 1, 15_000, 'the item.created delivery');
      const [d] = got('/json/tok3n-part', 'item.created');
      assert(signedWith(secret, d) && !signedWith('whsec_other', d), 'signature does not verify');
      const e = JSON.parse(d.body);
      assert(e.data.item.id === 's1' && e.data.item.text === 'Ship the importer' && e.board.title === 'Team roadmap' && e.actor.name === O.name, d.body);
      const end = Date.now() + 2000;
      for (let x = 10; Date.now() < end; x += 10) {
        els(c).set('s1', { ...els(c).get('s1'), x });
        await new Promise((r) => setTimeout(r, 100)); // a person's drag: one move every 100 ms for 2 s
      }
      await waitFor(() => got('/json/tok3n-part', 'item.updated').length >= 1, 15_000, 'the item.updated delivery');
      // A later, separate change is the barrier: once its event arrived, the drag's are all in.
      els(c).set('s2', { id: 's2', type: 'sticky', x: 0, y: 400, w: 100, h: 100, text: 'barrier', color: 'blue', createdBy: O.id });
      await waitFor(() => bodies('/json/tok3n-part', 'item.created').some((b) => b.data.item.id === 's2'), 15_000, 'the barrier event');
      assert(got('/json/tok3n-part', 'item.updated').length === 1, `the drag fired ${got('/json/tok3n-part', 'item.updated').length} updates`);
      assert(got('/json/tok3n-part', 'item.created').length === 2, 'a delivery was repeated');
    });

    await check('nothing from a private draft, a hidden frame or a board in a private project is delivered; the draft arrives once it is revealed; sharing and comments arrive', async () => {
      const c = await join(O, board.id, true);
      c.layers.private.getMap('elements').set('d1', { id: 'd1', type: 'sticky', x: 0, y: 600, w: 100, h: 100, text: 'DRAFT-TEXT', color: 'yellow', createdBy: O.id });
      c.doc.transact(() => {
        els(c).set('hf', { id: 'hf', type: 'frame', x: 600, y: 0, w: 400, h: 400, title: 'Later', hidden: true, createdBy: O.id });
        els(c).set('hx', { id: 'hx', type: 'sticky', x: 650, y: 50, w: 100, h: 100, text: 'HIDDEN-TEXT', frameId: 'hf', color: 'yellow', createdBy: O.id });
      });
      const s = await join(O, secretBoard.id);
      els(s).set('p1', { id: 'p1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'PRIVATE-PROJECT-TEXT', color: 'yellow', createdBy: O.id });
      await settled(c);
      await settled(s);
      assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: 'nobody@verify.freero.app', role: 'viewer' })).status === 201, 'invite by address');
      const outsider = new User('HookOutsider', proc.port);
      await outsider.signup();
      await outsider.verifyEmail(dataDir);
      assert((await O.req('POST', `/api/boards/${board.id}/members`, { email: outsider.email, role: 'commenter' })).status === 201, 'share');
      c.doc.transact(() => {
        c.doc.getMap('comments').set('t:t9', { kind: 'thread', id: 't9', x: 0, y: 0, elementId: 's1', createdAt: Date.now(), createdBy: O.id });
        c.doc.getMap('comments').set('m:t9:m1', { kind: 'message', threadId: 't9', id: 'm1', authorId: O.id, authorName: O.name, text: 'Looks good', createdAt: Date.now() });
      });
      await waitFor(() => got('/json/tok3n-part', 'comment.created').length === 1 && got('/json/tok3n-part', 'member.added').length === 1, 15_000, 'the comment and sharing events');
      const all = receiver.received.map((d) => d.body).join('\n');
      for (const leak of ['DRAFT-TEXT', 'HIDDEN-TEXT', 'PRIVATE-PROJECT-TEXT', 'Comp review', secretBoard.id]) assert(!all.includes(leak), `${leak} was delivered`);
      assert(bodies('/json/tok3n-part', 'member.added')[0].data.userId === outsider.id, 'member.added names someone else');
      c.layerOp({ type: 'reveal', collection: 'elements', mine: true });
      await waitFor(() => bodies('/json/tok3n-part', 'item.created').some((b) => b.data.item.text === 'DRAFT-TEXT'), 15_000, 'the revealed draft to be delivered');
    });

    await check('a Slack endpoint gets a readable message linking to the item', async () => {
      const [m] = bodies('/slack');
      assert(m && /added a sticky note to <http:\/\/freero\.verify\/board\/[^|]+\?el=s1\|Team roadmap>/.test(m.blocks[0].text.text) && m.text.includes('Ship the importer'), JSON.stringify(m));
    });

    await check('a receiver answering 500 is retried with growing gaps; after 3 failures in a row the webhook turns off, its creator is emailed, the log and the audit log say so; turned back on, the waiting delivery arrives', async () => {
      receiver.answer('/json/tok3n-part', 500);
      const before = got('/json/tok3n-part').length;
      const c = await join(O, board.id);
      els(c).set('s3', { id: 's3', type: 'sticky', x: 0, y: 800, w: 100, h: 100, text: 'retry me', color: 'blue', createdBy: O.id });
      await waitFor(async () => (await O.req('GET', base)).json.endpoints.find((e) => e.id === hookId)?.enabled === false, 30_000, 'the webhook to turn off');
      const tries = got('/json/tok3n-part').slice(before);
      assert(tries.length === 3, `${tries.length} attempts`);
      assert(tries[2].at - tries[1].at > tries[1].at - tries[0].at, `no backoff: ${tries.map((t) => t.at - tries[0].at).join(', ')} ms`);
      await waitFor(() => outbox(dataDir).some((m) => m.to === O.email && /webhook was turned off/i.test(m.subject)), 10_000, 'the mail to the webhook’s creator');
      const log = (await O.req('GET', `${base}/${hookId}/deliveries`)).json.deliveries;
      assert(log[0].status === 'pending' && log[0].attempts === 3 && log[0].responseStatus === 500, JSON.stringify(log[0]));
      const audit = (await O.req('GET', `/api/workspaces/${team.id}/audit?limit=200`)).json.events;
      assert(audit.some((e) => e.action === 'webhook.disabled'), 'not audited');
      receiver.answer('/json/tok3n-part', 200);
      assert((await O.req('PATCH', `${base}/${hookId}`, { enabled: true })).json.endpoint.enabled === true, 'turn on');
      await waitFor(() => got('/json/tok3n-part').length === before + 4, 15_000, 'the waiting delivery after turning it back on');
    });

    await check('rotating the secret signs the next delivery (a test) with the new one only', async () => {
      const r = await O.req('POST', `${base}/${hookId}/rotate`);
      assert(r.status === 200 && r.json.secret !== secret, r.text);
      assert((await O.req('POST', `${base}/${hookId}/test`)).status === 202, 'test');
      await waitFor(() => got('/json/tok3n-part', 'ping').length === 1, 10_000, 'the test delivery');
      const [ping] = got('/json/tok3n-part', 'ping');
      assert(signedWith(r.json.secret, ping) && !signedWith(secret, ping), 'the test is not signed with the new secret');
    });
  } finally {
    for (const c of clients) c.destroy();
    if (proc) await stopProc(proc);
    if (receiver) await receiver.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* best effort */
    }
  }
}

// `--only <group>[,<group>…]` runs some groups, e.g. to loop one while hunting a flake.
const SUITES = {
  main: run,
  signin: signInMethodChecks,
  recovery: twoFactorRecoveryChecks,
  secrets: secretRotationChecks,
  sweep: uploadSweepChecks,
  media: mediaChecks,
  purge: accountPurgeChecks,
  notify: notificationChecks,
  teams: teamsChecks,
  platform: platformChecks,
  sso: ssoChecks,
  scim: scimChecks,
  privacy: privacyChecks,
  moderation: moderationChecks,
  multi: multiInstanceChecks,
  admin: enterpriseAdminChecks,
  ai: aiChecks,
  api: publicApiChecks,
  facilitation: facilitationChecks,
  suggestions: suggestionsChecks,
  s3: s3Checks,
  mcp: mcpChecks,
  suite: suiteChecks,
  tracker: trackerChecks,
  collab: collabChecks,
  search: searchChecks,
  webhooks: webhooksChecks,
};
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? (process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean) : Object.keys(SUITES);
for (const name of only) if (!SUITES[name]) throw new Error(`--only: unknown group "${name}" (${Object.keys(SUITES).join(', ')})`);
const started = Date.now();
for (const name of only) await SUITES[name]().catch((e) => record(`${name} checks harness`, false, e?.stack ?? String(e)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
console.log('verify: PASS');
process.exit(0);
