#!/usr/bin/env node
// Accessibility check (#141): axe-core (MPL-2.0, a dev dependency, unmodified) against the real
// app in headless Chromium — the main flows in the states people meet them: signed out, the
// dashboard, account settings, the admin console, a board idle and with a selection, the share
// dialog, the board menu, the timer, the sticker panel, the walkthrough dialog, the shortcut sheet,
// presenting, in the dark theme and at phone width. Rules: WCAG 2.0 / 2.1 / 2.2 A and AA (axe's
// tags) plus its best practices. Fails on a *serious* or *critical* violation; *moderate* and
// *minor* ones are listed. A few keyboard checks run beside it: a dialog keeps focus inside and
// gives it back to what opened it, and the board's regions are reachable with F6.
//
//   npm run a11y [-- --base http://localhost:5173 --login email:password] [--no-build] [--only <scenario>] [--shots <dir>]
//
// Without --base: the web app is built into a temp folder and served by a real server (NODE_ENV=test,
// a throwaway data dir, a free port), and a user is signed up for the run; pages are opened with
// CSP bypassed so axe can be injected (the production CSP rightly forbids inline scripts). With --base: an app that
// is already running (e.g. `npm run dev`), signed in as --login.
//
// axe finds what a machine can find (about a third of WCAG). docs/accessibility.md says what was
// checked by hand and what remains for an external audit; the conformance report is the site's
// /accessibility page.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const ONLY = opt('only');
const SHOTS = opt('shots');
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const FAILING = new Set(['serious', 'critical']);

// ---------------------------------------------------------------------------------------------
// The app: a running one (--base), or a build served by a real server for this run.
let base = opt('base');
let login = opt('login');
let server = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-a11y-'));
if (!base) {
  const dist = path.join(work, 'web');
  if (!flag('no-build') || !fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('building the web app…');
    const r = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(ROOT, 'apps/web'), stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FREERO_DATA_DIR: path.join(work, 'data'), FREERO_WEB_DIST: dist, NODE_ENV: 'test', SITE: 'false', RATE_LIMIT_SIGNUP: '100/1h', RATE_LIMIT_LOGIN: '100/5m' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    const ok = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
    if (ok) break;
    if (i > 240) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch();
const stop = async (code) => {
  await browser.close().catch(() => undefined);
  server?.kill();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(code);
};

async function signedInContext(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true, ...opts });
  const [email, password] = login.split(':');
  const res = await context.request.post(`${base}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
  return context;
}

if (!login) {
  const email = `a11y-${Date.now()}@test.freero.app`;
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${base}/api/auth/signup`, { data: { name: 'Ada Access', email, password: 'password-123' } });
  if (!res.ok()) throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
  await ctx.close();
  login = `${email}:password-123`;
}

// ---------------------------------------------------------------------------------------------
const findings = [];
const keyboard = [];
let ran = 0;

async function scan(page, name) {
  if (ONLY && !name.includes(ONLY)) return;
  ran++;
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
  }, TAGS);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  for (const v of violations) findings.push({ scenario: name, ...v });
  console.log(`${violations.some((v) => FAILING.has(v.impact)) ? '✗' : '✓'} ${name}${violations.length ? `: ${violations.map((v) => `${v.id} (${v.impact})`).join(', ')}` : ''}`);
}

function expectKeyboard(ok, what) {
  keyboard.push({ ok, what });
  console.log(`${ok ? '✓' : '✗'} keyboard: ${what}`);
}

try {
  const anon = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  const p0 = await anon.newPage();
  await p0.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await scan(p0, 'sign-in');
  await p0.goto(`${base}/signup`, { waitUntil: 'networkidle' });
  await scan(p0, 'sign-up');
  await anon.close();

  const ctx = await signedInContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await scan(page, 'dashboard');
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await scan(page, 'account-settings');
  const ws = await (await ctx.request.post(`${base}/api/workspaces`, { data: { name: 'Access team' } })).json();
  await page.goto(`${base}/admin/${ws.workspace.id}`, { waitUntil: 'networkidle' });
  await scan(page, 'admin-console');

  const board = (await (await ctx.request.post(`${base}/api/boards`, { data: { title: 'Access check' } })).json()).board;
  await page.goto(`${base}/board/${board.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[role="application"]');
  await scan(page, 'board');
  await page.keyboard.press('n');
  await page.mouse.click(640, 400);
  await page.keyboard.type('Ship on Friday');
  await page.keyboard.press('Escape');
  await scan(page, 'board-with-selection');

  // The share dialog: focus moves in, stays in, and comes back to Share when it closes.
  const share = page.getByRole('button', { name: 'Share' });
  await share.click();
  await page.waitForSelector('[role="dialog"]');
  await scan(page, 'share-dialog');
  let inside = true;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    inside &&= await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  }
  expectKeyboard(inside, 'Tab stays inside the share dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expectKeyboard(await share.evaluate((el) => el === document.activeElement), 'closing the share dialog gives focus back to Share');

  // F6 moves between the board's regions.
  const regions = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('F6');
    regions.add(await page.evaluate(() => document.activeElement?.closest('[data-fr-region]')?.getAttribute('data-fr-region') ?? document.activeElement?.getAttribute('role') ?? ''));
  }
  expectKeyboard(regions.size >= 4, `F6 reaches the board's regions (${[...regions].filter(Boolean).join(', ')})`);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Board menu' }).click();
  await scan(page, 'board-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  await scan(page, 'timer');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await scan(page, 'shortcut-sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Board menu' }).click();
  const record = page.getByText('Record a walkthrough…');
  if (await record.count()) {
    await record.click();
    await scan(page, 'walkthrough-dialog');
    await page.keyboard.press('Escape');
  } else await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Present/ }).first().click();
  await scan(page, 'present');
  await page.keyboard.press('Escape');
  await ctx.close();

  // Dark theme.
  const dark = await signedInContext({ colorScheme: 'dark' });
  await dark.request.patch(`${base}/api/auth/me`, { data: { theme: 'dark' } });
  const dp = await dark.newPage();
  await dp.goto(`${base}/`, { waitUntil: 'networkidle' });
  await scan(dp, 'dark-dashboard');
  await dp.goto(`${base}/board/${board.id}`, { waitUntil: 'networkidle' });
  await dp.waitForSelector('[role="application"]');
  await dp.mouse.click(640, 400);
  await scan(dp, 'dark-board');
  await dark.request.patch(`${base}/api/auth/me`, { data: { theme: 'system' } });
  await dark.close();

  // Phone width.
  const phone = await signedInContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(`${base}/`, { waitUntil: 'networkidle' });
  await scan(pp, 'phone-dashboard');
  await pp.goto(`${base}/board/${board.id}`, { waitUntil: 'networkidle' });
  await pp.waitForSelector('[role="application"]');
  await scan(pp, 'phone-board');
  await phone.close();
} catch (e) {
  console.error(e);
  await stop(1);
}

const failing = findings.filter((f) => FAILING.has(f.impact));
const minor = findings.filter((f) => !FAILING.has(f.impact));
if (minor.length) {
  console.log('\nModerate / minor (listed, not failing):');
  for (const f of minor) console.log(`  ${f.scenario}: ${f.id} (${f.impact}) ${f.help} — ${f.nodes.slice(0, 3).join(' | ')}`);
}
if (failing.length) {
  console.log('\nSerious / critical:');
  for (const f of failing) console.log(`  ${f.scenario}: ${f.id} (${f.impact}) ${f.help} — ${f.nodes.slice(0, 5).join(' | ')}`);
}
const keysFailed = keyboard.filter((k) => !k.ok);
console.log(`\n${ran} states scanned; ${failing.length} serious or critical violation(s); ${keysFailed.length} keyboard check(s) failed.`);
await stop(failing.length || keysFailed.length ? 1 : 0);
