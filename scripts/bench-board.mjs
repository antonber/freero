#!/usr/bin/env node
// Large-board benchmark (#130): a board of 10,000 mixed items (stickies, shapes with text,
// connectors, text, frames, images, a kanban, a diagram — scripts/bench/board-seed.ts, fixed seed)
// opened in the real web app in headless Chromium, against the real server. Not a test: timings
// depend on the machine, so it reports numbers and checks only that each scenario did what it
// says. Run it before and after a change to drawing, culling or the store and compare.
//
//   npm run bench:board [-- --items 10000] [--port 4322] [--width 1440 --height 900]
//                          [--theme light|dark] [--only <part of a scenario name>]
//                          [--no-build | --dist <built web app>] [--profile] [--trace <dir>] [--out <file.json>] [--label <column name>]
//                          [--compare <earlier.json>] [--census] [--css <rules>] [--shots <dir>] [--headed]
//
// What runs: the web app is built (production React, not minified, so profiles name functions)
// into a temp folder and served by a real server (NODE_ENV=test, a throwaway data dir, a free port
// unless --port). A user signs up, makes a board, uploads a few generated pictures and writes the
// board through a real y-websocket client, which then stays connected as the collaborator.
// Chromium runs with vsync and the frame-rate cap off, so a frame takes what it costs (16.7 ms at
// 60 Hz is the budget to compare with). Each scenario is driven the way input arrives — wheel
// events once per frame for pan and zoom (the canvas's own handler), the keyboard for select all,
// the mouse for the marquee and the drag — and reports frame times (median, p95, worst) from
// requestAnimationFrame. --profile adds the hottest functions of each scenario (CPU profile, self
// time), --trace writes a Chrome trace per scenario and sums its main-thread work by kind.
//
// Results print as a table and are saved as JSON (default bench-results/board-<time>.json,
// gitignored): with --compare, a column per run.
import { spawn, spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { buildBenchBoard } from './bench/board-seed.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const ITEMS = Number(opt('items', '10000'));
const WIDTH = Number(opt('width', '1440'));
const HEIGHT = Number(opt('height', '900'));
const THEME = opt('theme', 'light');
const ONLY = opt('only');
const TRACE_DIR = opt('trace');
const PROFILE = flag('profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// A comparison of saved runs needs no browser.
if (flag('compare') && args.length === 2) {
  printTable([JSON.parse(fs.readFileSync(opt('compare'), 'utf8'))]);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Build and serve

const work = path.join(os.tmpdir(), `freero-bench-${Buffer.from(ROOT).toString('base64url').slice(-10)}`);
// --dist <dir>: measure that build of the web app instead (another commit's, built elsewhere).
const dist = opt('dist') ? path.resolve(opt('dist')) : path.join(work, 'web');
if (!opt('dist') && (!flag('no-build') || !fs.existsSync(path.join(dist, 'index.html')))) {
  console.error('building the web app…');
  const r = spawnSync('npx', ['vite', 'build', '--minify', 'false', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(ROOT, 'apps/web'), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`no built web app in ${dist}`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const port = Number(opt('port', 0)) || (await freePort());
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-bench-data-'));
const serverLog = [];
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), FREERO_DATA_DIR: dataDir, FREERO_WEB_DIST: dist, NODE_ENV: 'test', RATE_LIMIT_SIGNUP: '100/1h', RATE_LIMIT_LOGIN: '100/5m' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));
let browser = null;
let collaborator = null;
const cleanup = () => {
  try {
    collaborator?.destroy();
  } catch {
    /* gone */
  }
  if (server.exitCode === null) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
      else server.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

const base = `http://127.0.0.1:${port}`;
for (let t = Date.now(); ; ) {
  if (server.exitCode !== null) throw new Error(`server exited:\n${serverLog.join('')}`);
  try {
    if ((await fetch(`${base}/api/auth/me`)).status === 401) break;
  } catch {
    /* not up yet */
  }
  if (Date.now() - t > 90_000) throw new Error(`server did not start:\n${serverLog.join('')}`);
  await sleep(200);
}

// ---------------------------------------------------------------------------------------------
// The board

let cookie = '';
async function req(method, url, body, raw) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(raw ? { 'content-type': raw } : body ? { 'content-type': 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const m = /^freero_session=([^;]*)/.exec(c);
    if (m) cookie = `freero_session=${m[1]}`;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return JSON.parse(text);
}
const email = `bench-${Date.now()}@bench.freero.app`;
const me = (await req('POST', '/api/auth/signup', { name: 'Bench', email, password: 'password-123' })).user;
const board = (await req('POST', '/api/boards', { title: 'Large board benchmark' })).board;

const IMAGE = { w: 400, h: 300 };
const images = [];
for (let i = 0; i < 6; i++) images.push((await req('POST', '/api/uploads', png(IMAGE.w, IMAGE.h, i), 'image/png')).url);

const seeded = buildBenchBoard({ total: ITEMS, images, imageSize: IMAGE, userId: me.id });

class CookieWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, { headers: { cookie } });
  }
}
const doc = new Y.Doc();
const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws/boards`, board.id, doc, { WebSocketPolyfill: CookieWebSocket, disableBc: true });
collaborator = provider;
provider.awareness.setLocalStateField('user', { id: me.id, name: 'Collaborator', color: '#E8590C' });
for (let t = Date.now(); !provider.synced; await sleep(50)) if (Date.now() - t > 20_000) throw new Error('the collaborator did not sync');
const elements = doc.getMap('elements');
doc.transact(() => {
  for (const el of seeded.elements) elements.set(el.id, el);
});
// Written once the server holds it: a fresh socket sees the whole board.
await sleep(1500);
// The server digests the seeded board for a while (storing, indexing): navigating meanwhile timed
// its busy event loop, not the app's load. Wait until it answers promptly, then read the app's
// files once, so a cold read of a fresh build (and a virus scan of it) isn't timed either (#183).
for (let t = Date.now(), quick = 0; quick < 5 && Date.now() - t < 30_000; await sleep(100)) {
  const t0 = performance.now();
  await fetch(`${base}/api/auth/me`);
  quick = performance.now() - t0 < 20 ? quick + 1 : 0;
}
for (const f of fs.readdirSync(path.join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f))) await (await fetch(`${base}/assets/${f}`)).arrayBuffer();

// ---------------------------------------------------------------------------------------------
// The browser

browser = await chromium.launch({ headless: !flag('headed'), args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: THEME === 'dark' ? 'dark' : 'light' });
await context.addCookies([{ name: 'freero_session', value: cookie.split('=')[1], url: base }]);
if (THEME === 'dark') await context.addInitScript(() => localStorage.setItem('freero:theme', 'dark'));
await context.addInitScript(benchRuntime);
// --css "<rules>": a stylesheet added to the app (what-if experiments: is it the shadows?).
if (opt('css')) await context.addInitScript((css) => addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: css }))), opt('css'));
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

const remote = { moved: 0 };
await context.addInitScript((id) => (window.__benchRemoteId = id), seeded.remoteIds[0]);
await page.exposeFunction('__benchRemoteEdit', async () => {
  const id = seeded.remoteIds[0];
  const el = elements.get(id);
  remote.moved++;
  doc.transact(() => elements.set(id, { ...el, x: el.x + (remote.moved % 2 ? 40 : -40), text: `<p>edited ${remote.moved}</p>`, updatedAt: Date.now() }));
  return id;
});
await page.exposeFunction('__benchRemoteDrag', async (steps) => {
  for (let i = 0; i < steps; i++) {
    doc.transact(() => {
      for (const id of seeded.remoteIds) {
        const el = elements.get(id);
        elements.set(id, { ...el, x: el.x + (i < steps / 2 ? 6 : -6), updatedAt: Date.now() });
      }
    });
    await sleep(16);
  }
});

const results = {
  date: new Date().toISOString(),
  commit: opt('label') ?? git('rev-parse --short HEAD'),
  dirty: !opt('label') && git('status --porcelain') !== '',
  machine: { cpu: os.cpus()[0]?.model?.trim(), cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), os: `${os.platform()} ${os.release()}`, node: process.version, chromium: browser.version(), viewport: `${WIDTH}×${HEIGHT}`, theme: THEME },
  board: { items: seeded.elements.length, ...seeded.counts },
  scenarios: {},
};

const want = (name) => !ONLY || name.includes(ONLY);
async function scenario(name, fn) {
  if (!want(name) && name !== 'initial load') return;
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  const traceFile = TRACE_DIR && path.resolve(TRACE_DIR, `${name.replace(/[^a-z0-9]+/gi, '-')}.json`);
  if (traceFile) {
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    await browser.startTracing(page, { path: traceFile, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking', 'blink', 'v8.execute'] });
  }
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { note: `failed: ${e.message.split('\n')[0]}` };
  }
  if (traceFile) {
    await browser.stopTracing();
    r.trace = summarizeTrace(traceFile);
  }
  if (PROFILE) r.hot = summarizeProfile((await cdp.send('Profiler.stop')).profile);
  results.scenarios[name] = r;
  console.error(`  ${name}: ${fmt(r)}`);
}

const frames = (spec) => page.evaluate((s) => window.__bench.frames(s), spec);
const camera = () => page.evaluate(() => window.__bench.camera());

// Initial load: navigation → every item drawn (the count of drawn items has stopped changing).
console.error(`board of ${seeded.elements.length} items: ${Object.entries(seeded.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
await scenario('initial load', async () => {
  await page.goto(`${base}/board/${board.id}`, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => window.__bench.loaded()).catch(async (e) => {
    await page.screenshot({ path: path.join(work, 'load-failed.png') });
    throw new Error(`${e.message} (screenshot: ${path.join(work, 'load-failed.png')}; at ${page.url()})`);
  });
  return { ms: r.ms, firstItemMs: r.first, detail: `first items drawn at ${r.first} ms; ${r.count} items drawn (${r.painted} on low-detail canvases), ${r.nodes} DOM nodes`, drawn: r.count, nodes: r.nodes, longTasksMs: r.longTasks };
});
await scenario('memory after load', () => memory());
// --census: what the drawn board is made of, by item type — the DOM nodes, and those that cost
// Chrome most to layer and paint (SVG roots, shadows, clips, filters, transforms).
if (flag('census')) console.error(JSON.stringify(await page.evaluate(() => window.__bench.census()), null, 1));

// --shots <dir>: what the board looks like at fit (low detail) and at 100% (full), to look at.
const shot = async (name) => opt('shots') && (fs.mkdirSync(path.resolve(opt('shots')), { recursive: true }), await page.screenshot({ path: path.resolve(opt('shots'), `${name}-${THEME}.png`) }));
await shot('fit');
const fit = await camera();
await scenario('pan at zoom to fit', async () => {
  const r = await frames({ kind: 'pan', n: 150, dx: 6, dy: 2 });
  return { ...r, detail: `zoom ${fit.zoom.toFixed(3)}` };
});
await scenario('zoom in from fit to 100%', async () => {
  // The dense spot (a frame of stickies) to the middle of the screen, then zoom about it.
  await page.evaluate((p) => window.__bench.centerOn(p), seeded.denseSpot);
  const r = await frames({ kind: 'zoom', to: 1, at: seeded.denseSpot, step: 1.06 });
  const cam = await camera();
  return { ...r, ...(Math.abs(cam.zoom - 1) > 0.01 ? { note: `ended at zoom ${cam.zoom}` } : {}) };
});
await shot('100');
await scenario('pan at 100%', async () => {
  const r = await frames({ kind: 'pan', n: 180, dx: 10, dy: 3 });
  const n = await page.evaluate(() => window.__bench.drawnItems());
  return { ...r, detail: `${n.total} items drawn at the end (${n.painted} on low-detail canvases)` };
});
await scenario('zoom out from 100% to fit', async () => frames({ kind: 'zoom', to: fit.zoom, at: seeded.denseSpot, step: 1 / 1.06 }));
// #184: out of low detail in one step (0.17 → 0.26, about the frame of interest), then the frames
// while the items it painted mount.
await scenario('leave low detail', async () => {
  await frames({ kind: 'zoom', to: 0.17, at: seeded.denseSpot, step: 1.06 });
  await sleep(300);
  const r = await frames({ kind: 'zoom', to: 0.26, at: seeded.denseSpot, step: 1.53, settle: 60 });
  const n = await page.evaluate(() => window.__bench.drawnItems());
  return { ...r, detail: `${n.dom} items mounted at the end (${n.painted} still painted)` };
});
// Back to the board's fit, so the next scenarios start where people land.
await page.keyboard.press('Shift+1');
await sleep(800);

await scenario('select all', async () => {
  await page.evaluate(() => window.__bench.afterKey());
  await page.keyboard.press('Control+a');
  const t = await page.evaluate(() => window.__bench.done());
  const sel = await selectedCount();
  return { ms: t.ms, longTasksMs: t.longTasks, detail: `${sel} selected`, ...(sel < seeded.elements.length * 0.9 ? { note: `only ${sel} selected` } : {}) };
});
await scenario('pan at fit, everything selected', () => frames({ kind: 'pan', n: 60, dx: -6, dy: -2 }));
// #182: selected items mount like the rest, so zooming in with everything selected mounts what is near the view.
await scenario('zoom in to 100%, everything selected', async () => {
  await page.evaluate((p) => window.__bench.centerOn(p), seeded.denseSpot);
  const r = await frames({ kind: 'zoom', to: 1, at: seeded.denseSpot, step: 1.06 });
  const n = await page.evaluate(() => window.__bench.drawnItems());
  return { ...r, detail: `${n.dom} items mounted at the end` };
});
await page.keyboard.press('Escape');
await sleep(300);

await scenario('drag 500 items', async () => {
  await page.keyboard.press('Shift+1');
  await sleep(800);
  const a = await page.evaluate((p) => window.__bench.toScreen(p), { x: seeded.dragRegion.x, y: seeded.dragRegion.y });
  const b = await page.evaluate((p) => window.__bench.toScreen(p), { x: seeded.dragRegion.x + seeded.dragRegion.w, y: seeded.dragRegion.y + seeded.dragRegion.h });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const sel = await selectedCount();
  const grab = await page.evaluate((p) => window.__bench.toScreen(p), { x: 140, y: 180 });
  // Did it move? Asked of the collaborator's copy (items may be pixels on a canvas, not DOM).
  const before = elements.get(seeded.remoteIds[0]).x;
  await page.evaluate(() => window.__bench.record());
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) await page.mouse.move(grab.x + i * 4, grab.y + i * 2);
  const tUp = await page.evaluate(() => performance.now());
  await page.mouse.up();
  const r = await page.evaluate((t) => window.__bench.stop(t), tUp);
  await sleep(500);
  const after = elements.get(seeded.remoteIds[0]).x;
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await sleep(500);
  const note = sel < 450 ? `the marquee selected ${sel}` : before === after ? 'nothing moved' : undefined;
  return { ...r, detail: `${sel} selected, drop settled in ${Math.round(r.settleMs)} ms`, ...(note ? { note } : {}) };
});

await scenario("a collaborator's edit appears", async () => {
  const ms = [];
  for (let i = 0; i < 9; i++) ms.push(await page.evaluate(() => window.__bench.remoteEdit()));
  ms.sort((x, y) => x - y);
  return { ms: ms[4], detail: `median of 9, worst ${Math.round(ms[8])} ms (localhost relay included)` };
});
await scenario('a collaborator drags 50 items', () => page.evaluate(() => window.__bench.remoteDrag(60)));
await scenario('memory at the end', () => memory());

for (const p of problems) console.error(p);
await browser.close();

const out = path.resolve(opt('out', path.join(ROOT, 'bench-results', `board-${results.date.replace(/[:.]/g, '-')}.json`)));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 2));
const earlier = opt('compare') ? [JSON.parse(fs.readFileSync(opt('compare'), 'utf8'))] : [];
printTable([...earlier, results]);
console.log(`\nsaved ${path.relative(process.cwd(), out)}`);
if (problems.length) process.exitCode = 1;
process.exit();

// ---------------------------------------------------------------------------------------------

async function memory() {
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(200);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const mb = m.JSHeapUsedSize / 2 ** 20;
  return { mb: Math.round(mb), detail: `${Math.round(mb)} MB JS heap, ${m.Nodes} DOM nodes, ${m.LayoutObjects} layout objects`, nodes: m.Nodes, layoutObjects: m.LayoutObjects };
}

/** How many items the selection live region says are selected (it speaks a moment after the selection). */
async function selectedCount() {
  for (let t = Date.now(); ; await sleep(50)) {
    const n = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[aria-live]')) {
        const m = /(\d+) items selected/.exec(el.textContent ?? '');
        if (m) return Number(m[1]);
      }
      return 0;
    });
    if (n || Date.now() - t > 3000) return n;
  }
}

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Main-thread work in a trace, summed by kind (ms), biggest first. */
function summarizeTrace(file) {
  const { traceEvents } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const main = traceEvents.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const sums = {};
  for (const e of traceEvents) {
    if (!main || e.pid !== main.pid || e.tid !== main.tid || e.ph !== 'X' || !e.dur) continue;
    if (!['FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'Commit', 'MajorGC', 'MinorGC', 'ParseHTML', 'RunMicrotasks', 'HitTest', 'IntersectionObserverController::computeIntersections'].includes(e.name)) continue;
    sums[e.name] = (sums[e.name] ?? 0) + e.dur / 1000;
  }
  return Object.fromEntries(Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v)]));
}

/** The functions with the most self time in a CPU profile (ms), biggest first. */
function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const f = n.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url ? `${f.url.split('/').pop()}:${f.lineNumber + 1}` : ''}`.trim();
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return Object.fromEntries([...self].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, Math.round(v)]));
}

function fmt(r) {
  if (!r) return '—';
  const n = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const parts = [];
  if (r.ms !== undefined) parts.push(`${n(r.ms)} ms`);
  if (r.median !== undefined) parts.push(`frame ${n(r.median)} / ${n(r.p95)} / ${n(r.worst)} ms (${r.frames} frames)`);
  if (r.mb !== undefined && !r.detail) parts.push(`${r.mb} MB`);
  if (r.detail) parts.push(r.detail);
  if (r.note) parts.push(`NOTE: ${r.note}`);
  return parts.join(', ');
}

function printTable(runs) {
  const names = [...new Set(runs.flatMap((r) => Object.keys(r.scenarios)))];
  const last = runs[runs.length - 1];
  console.log(`\n${last.board.items} items (${Object.entries(last.board).filter(([k]) => k !== 'items').map(([k, v]) => `${v} ${k}`).join(', ')})`);
  console.log(`${last.machine.cpu}, ${last.machine.cores} threads, ${last.machine.memoryGb} GB, ${last.machine.os}, Chromium ${last.machine.chromium}, ${last.machine.viewport}, ${last.machine.theme}`);
  console.log('Frames: median / p95 / worst, ms (60 Hz budget 16.7 ms).\n');
  console.log(`| Scenario | ${runs.map((r) => `${r.commit}${r.dirty ? '+' : ''}`).join(' | ')} |`);
  console.log(`|---|${runs.map(() => '---').join('|')}|`);
  for (const name of names) console.log(`| ${name} | ${runs.map((r) => fmt(r.scenarios[name])).join(' | ')} |`);
  for (const r of runs)
    for (const [name, s] of Object.entries(r.scenarios)) {
      if (s.hot) console.log(`\n${name} — hottest functions (self ms): ${Object.entries(s.hot).map(([k, v]) => `${k} ${v}`).join('; ')}`);
      if (s.trace) console.log(`${name} — main thread (ms): ${Object.entries(s.trace).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
}

/** A deterministic `w`×`h` PNG (a soft gradient with bands), picture `k` of a set. */
function png(w, h, k) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const hue = [
    [230, 120, 90],
    [90, 160, 220],
    [120, 190, 110],
    [210, 170, 70],
    [160, 110, 200],
    [80, 180, 180],
  ][k % 6];
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const band = Math.sin((x * (k + 2)) / 37 + y / 23) * 18;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.max(0, Math.min(255, Math.round(hue[c] * (1 - t * 0.6) + 255 * t * 0.4 + band)));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Runs in the page before the app (addInitScript): drives frames and measures them. */
function benchRuntime() {
  const longTasks = [];
  try {
    new PerformanceObserver((l) => longTasks.push(...l.getEntries().map((e) => ({ start: e.startTime, dur: e.duration })))).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long task timing */
  }
  const longSince = (t) => Math.round(longTasks.filter((e) => e.start >= t).reduce((s, e) => s + e.dur, 0));
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const viewport = () => document.querySelector('.fr-viewport');
  /** Items on the canvas: their own DOM, and those painted on low-detail canvases. */
  const drawnItems = () => {
    let painted = 0;
    for (const c of document.querySelectorAll('canvas.fr-lod-layer')) painted += Number(c.getAttribute('data-items') ?? 0);
    const dom = document.querySelectorAll('.fr-el').length;
    return { dom, painted, total: dom + painted };
  };
  const stats = (deltas) => {
    const s = [...deltas].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { frames: s.length, median: q(0.5), p95: q(0.95), worst: s[s.length - 1], over16: s.filter((d) => d > 1000 / 60).length };
  };
  const camera = () => {
    const m = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(document.querySelector('.fr-world')?.style.transform ?? '');
    if (!m) return { x: 0, y: 0, zoom: 1 };
    const zoom = Number(m[3]);
    return { x: -Number(m[1]) / zoom, y: -Number(m[2]) / zoom, zoom };
  };
  const toScreen = (p) => {
    const c = camera();
    const r = viewport().getBoundingClientRect();
    return { x: r.left + (p.x - c.x) * c.zoom, y: r.top + (p.y - c.y) * c.zoom };
  };
  const wheel = (x, y, dx, dy, ctrlKey = false) =>
    viewport().dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey, bubbles: true, cancelable: true }));
  let recording = null;
  window.__bench = {
    camera,
    toScreen,
    drawnItems,
    centerOn(p) {
      const r = viewport().getBoundingClientRect();
      const s = toScreen(p);
      wheel(r.left + r.width / 2, r.top + r.height / 2, s.x - (r.left + r.width / 2), s.y - (r.top + r.height / 2));
    },
    async loaded() {
      let first = null;
      let last = 0;
      let lastAt = 0;
      let stable = 0;
      for (;;) {
        await raf();
        if (performance.now() > 180_000) throw new Error(`the board did not finish drawing (${last} items drawn)`);
        const n = drawnItems().total;
        if (n && first === null) first = performance.now();
        if (n !== last) {
          last = n;
          lastAt = performance.now();
          stable = 0;
        } else if (n && ++stable >= 60 && performance.now() - lastAt > 1500) break;
      }
      await raf();
      // Loaded: every item drawn AND the page done with it — a long task after the count settled
      // (DOM swapped for canvases, say) is still loading.
      const busyUntil = longTasks.reduce((t, e) => Math.max(t, e.start + e.dur), 0);
      return { ms: Math.round(Math.max(lastAt, busyUntil)), first: Math.round(first), count: last, painted: drawnItems().painted, nodes: document.getElementsByTagName('*').length, longTasks: longSince(0) };
    },
    census() {
      const out = {};
      for (const el of document.querySelectorAll('.fr-world *')) {
        const type = el.closest('.fr-el')?.getAttribute('data-type') ?? '(world)';
        const c = (out[type] ??= { nodes: 0 });
        const add = (k) => (c[k] = (c[k] ?? 0) + 1);
        add('nodes');
        const cs = getComputedStyle(el);
        if (el.tagName === 'svg') add('svg');
        if (cs.boxShadow !== 'none') add('shadow');
        if (cs.overflow !== 'visible' && el.tagName !== 'svg') add('clip');
        if (cs.filter !== 'none' || cs.backdropFilter !== 'none') add('filter');
        if (cs.transform !== 'none') add('transform');
        if (Number(cs.opacity) < 1) add('opacity');
        if (cs.mixBlendMode !== 'normal') add('blend');
        if (cs.clipPath !== 'none') add('clipPath');
      }
      return out;
    },
    /** `n` frames of pan or a zoom to `to` about world point `at`; one wheel event per frame. */
    async frames(spec) {
      const deltas = [];
      const t0 = performance.now();
      let prev = await raf();
      let capped = false;
      for (let i = 0; spec.kind === 'pan' ? i < spec.n : true; i++) {
        // Bounded: a scenario that takes seconds a frame stops after a minute (and says so).
        if (performance.now() - t0 > 60_000) {
          capped = true;
          break;
        }
        if (spec.kind === 'pan') {
          const r = viewport().getBoundingClientRect();
          wheel(r.left + r.width / 2, r.top + r.height / 2, spec.dx, spec.dy);
        } else {
          const z = camera().zoom;
          const left = spec.to / z;
          if (Math.abs(Math.log(left)) < 1e-3 || i > 400) break;
          const f = spec.step > 1 ? Math.min(spec.step, left) : Math.max(spec.step, left);
          const s = toScreen(spec.at);
          wheel(s.x, s.y, 0, -Math.log(f) / 0.01, true);
        }
        const now = await raf();
        deltas.push(now - prev);
        prev = now;
      }
      // What a gesture leaves behind (the settle after the camera stops) counts too.
      for (let i = 0; i < (spec.settle ?? 10); i++) {
        const now = await raf();
        deltas.push(now - prev);
        prev = now;
      }
      return { ...stats(deltas), longTasksMs: longSince(t0), ...(capped ? { note: `stopped after a minute (${deltas.length} frames)` } : {}) };
    },
    /** Arms a key timer: done() resolves at the second frame after the next keydown. */
    afterKey() {
      recording = { key: null };
      window.addEventListener('keydown', (e) => recording && recording.key === null && (recording.key = e.timeStamp), { capture: true, once: true });
      return true;
    },
    async done() {
      while (recording.key === null) await raf();
      await raf();
      await raf();
      const ms = performance.now() - recording.key;
      const lt = longSince(recording.key);
      recording = null;
      return { ms, longTasks: lt };
    },
    /** Records frame times until stop(); stop also waits for the frames to settle. */
    record() {
      const deltas = [];
      const rec = { deltas, on: true };
      let prev = performance.now();
      const tick = (now) => {
        deltas.push(now - prev);
        prev = now;
        if (rec.on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      recording = rec;
      rec.t0 = performance.now();
    },
    async stop(tUp) {
      // Settled: three frames in a row as quick as the median frame of the drag (or 50 ms, a long
      // task) after the mouse came up; at most 15 s.
      const s = [...recording.deltas].sort((a, b) => a - b);
      const calmMs = Math.max(20, Math.min(50, (s[Math.floor(s.length / 2)] ?? 16) * 1.5));
      let calm = 0;
      let settleMs = 0;
      for (let prev = await raf(); calm < 3 && settleMs < 15_000; ) {
        const now = await raf();
        calm = now - prev < calmMs ? calm + 1 : 0;
        prev = now;
        settleMs = now - tUp;
      }
      recording.on = false;
      const r = { ...stats(recording.deltas), settleMs, longTasksMs: longSince(recording.t0) };
      recording = null;
      return r;
    },
    /** A collaborator moves a sticky: ms from asking to the frame that shows it. */
    async remoteEdit() {
      const id = window.__benchRemoteId;
      const look = () => document.querySelector(`.fr-el[data-id="${id}"]`)?.getAttribute('style') ?? [...document.querySelectorAll('canvas.fr-lod-layer')].map((c) => c.dataset.paints).join();
      const before = look();
      const t0 = performance.now();
      await window.__benchRemoteEdit();
      while (look() === before) {
        if (performance.now() - t0 > 10_000) throw new Error('the edit never showed');
        await new Promise((r) => setTimeout(r, 0));
      }
      await raf();
      return performance.now() - t0;
    },
    /** Frame times while a collaborator drags 50 stickies (one update every 16 ms). */
    async remoteDrag(steps) {
      const deltas = [];
      const t0 = performance.now();
      let on = true;
      const done = window.__benchRemoteDrag(steps).then(() => (on = false));
      let prev = await raf();
      while (on) {
        const now = await raf();
        deltas.push(now - prev);
        prev = now;
      }
      await done;
      return { ...stats(deltas), longTasksMs: longSince(t0) };
    },
  };
}
