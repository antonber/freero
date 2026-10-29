#!/usr/bin/env node
// The marketing site's "how it works" screenshots, taken from the real app: a real server, real
// accounts, a board filled through the real API, a personal token acting as an agent, and a local
// mock Jira (scripts/lib/mock-jira.mjs). Saved as WebP at 800 and 1600 px wide into
// apps/site/src/assets/shots/, which the site's <Shot> reads.
//
//   1. Start a throwaway server that serves the built web app, on ports nobody else uses:
//        npm run build -w @freero/web
//        PORT=4571 FREERO_DATA_DIR=<scratch>/data TRACKER_PRIVATE_ENDPOINTS=true npx tsx apps/server/src/main.ts
//   2. node scripts/site-shots.mjs --base http://localhost:4571 --data <scratch>/data [--out <dir>]
//   3. Look at every image before committing it. Stop the server.
//
// Names and board text are invented demo content; nothing comes from a real customer.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startMockJira } from './lib/mock-jira.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base');
const DATA = opt('data');
const OUT = path.resolve(opt('out', 'apps/site/src/assets/shots'));
if (!BASE || !DATA) {
  console.error('Usage: node scripts/site-shots.mjs --base http://localhost:4571 --data <server data dir> [--out dir]');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** A person with a session cookie, talking to the server's REST API. */
class Person {
  constructor(name, email) {
    Object.assign(this, { name, email, password: 'shots-password-123', cookie: '' });
  }
  async req(method, url, body, headers = {}) {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [k] = pair.split('=');
      this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), pair].join('; ');
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
    return json;
  }
  async signup() {
    this.id = (await this.req('POST', '/api/auth/signup', { name: this.name, email: this.email, password: this.password })).user.id;
    const re = /\/verify-email\?token=([A-Za-z0-9_-]+)/;
    const token = await waitFor(
      () => {
        const dir = path.join(DATA, 'outbox');
        if (!fs.existsSync(dir)) return null;
        for (const f of fs.readdirSync(dir)) {
          const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (m.to === this.email && re.test(m.text)) return re.exec(m.text)[1];
        }
        return null;
      },
      10_000,
      `the verification mail to ${this.email}`,
    );
    await this.req('POST', '/api/auth/verify-email', { token });
  }
}

/** Every shot is the same 1000×700 part of the 1600×1000 window (10:7), so the strip lines up. */
const area = (x, y) => ({ x, y, width: 1000, height: 700 });

/** Pans the canvas (mouse wheel) until `locator` sits at (x, y) on the screen. */
async function panTo(page, locator, x, y) {
  for (let i = 0; i < 4; i++) {
    const b = await locator.boundingBox();
    if (!b || (Math.abs(b.x - x) < 8 && Math.abs(b.y - y) < 8)) return;
    await page.mouse.move(800, 500);
    await page.mouse.wheel(b.x - x, b.y - y);
    await sleep(300);
  }
}

/** Saves the page (or a clip of it) as <name>-1600.webp and <name>-800.webp. */
async function save(page, name, clip) {
  const png = await page.screenshot({ clip, type: 'png' });
  const b64 = png.toString('base64');
  const out = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const enc = (w) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.round((img.height * w) / img.width);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', 0.86).split(',')[1];
    };
    return { big: enc(1600), small: enc(800) };
  }, b64);
  fs.writeFileSync(path.join(OUT, `${name}-1600.webp`), Buffer.from(out.big, 'base64'));
  fs.writeFileSync(path.join(OUT, `${name}-800.webp`), Buffer.from(out.small, 'base64'));
  console.log(`saved ${name}`);
}

const stamp = Date.now();
const maria = new Person('Maria Lopez', `maria-${stamp}@shots.freero.test`);
const leo = new Person('Leo Okafor', `leo-${stamp}@shots.freero.test`);
await maria.signup();
await leo.signup();

const board = (await maria.req('POST', '/api/boards', { title: 'Launch retro' })).board;
await maria.req('POST', `/api/boards/${board.id}/members`, { email: leo.email, role: 'editor' });
const notes = [
  'Demo went smoothly',
  'Docs were late again',
  'Too many handoffs before release',
  'QA found issues on the last day',
  'Support didn’t know the launch date',
  'Feature flags made rollback easy',
  'Release notes written twice',
  'Ship smaller batches',
];
await maria.req('POST', `/api/boards/${board.id}/insert-structure`, { structure: { kind: 'stickies', title: 'What happened in the launch?', items: notes, color: 'yellow' } });

const jira = await startMockJira({ deployment: 'cloud' });
const browser = await chromium.launch();
try {
  const ctx = async (who) => {
    const c = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await c.addCookies(
      who.cookie.split('; ').map((p) => {
        const [k, ...v] = p.split('=');
        return { name: k, value: v.join('='), url: BASE };
      }),
    );
    return c;
  };
  const mariaPage = await (await ctx(maria)).newPage();
  const leoPage = await (await ctx(leo)).newPage();
  const open = async (page, q = '') => {
    await page.goto(`${BASE}/board/${board.id}${q}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.fr-sticky, [data-type="sticky"], [data-fr-element]', { timeout: 20_000 }).catch(() => {});
    await sleep(800);
  };
  await open(mariaPage);
  await open(leoPage);
  // Leo points at a note; Maria sees his cursor and selection.
  await leoPage.mouse.move(820, 520, { steps: 8 });
  await sleep(300);
  await leoPage.mouse.move(905, 560, { steps: 12 });
  await mariaPage.mouse.move(640, 430, { steps: 4 });
  await sleep(1200);
  await save(mariaPage, 'workshop', area(330, 160));

  // An agent (a personal token named "Claude", read + suggest) proposes themes.
  const { secret } = await maria.req('POST', '/api/auth/tokens', { name: 'Claude', scopes: ['boards:read', 'boards:suggest'], expiresInDays: 1 });
  const bearer = { authorization: `Bearer ${secret}` };
  const outline = await maria.req('GET', `/api/v1/boards/${board.id}/outline?format=json`, undefined, bearer);
  const ids = new Map();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string' && typeof n.id === 'string') ids.set(n.text.trim(), n.id);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(outline);
  const id = (t) => {
    const v = ids.get(t);
    if (!v) throw new Error(`note "${t}" not in the outline: ${[...ids.keys()].join(' | ')}`);
    return { id: v };
  };
  await maria.req(
    'POST',
    `/api/v1/boards/${board.id}/structure`,
    {
      target: 'suggestions',
      description: 'Group the retro notes into themes',
      structure: {
        kind: 'clusters',
        clusters: [
          { title: 'Handoffs and timing', items: [id('Docs were late again'), id('Too many handoffs before release'), id('Support didn’t know the launch date'), id('Release notes written twice')] },
          { title: 'Quality', items: [id('QA found issues on the last day'), id('Ship smaller batches')] },
          { title: 'What worked', items: [id('Demo went smoothly'), id('Feature flags made rollback easy')] },
        ],
      },
    },
    bearer,
  );
  await waitFor(async () => (await mariaPage.locator('.fr-sg-badge').count()) > 0, 15_000, 'the suggestion badge');
  // The proposal lands in free space next to the notes: zoom out a little and bring it into view.
  for (let i = 0; i < 2; i++) {
    await mariaPage.getByRole('button', { name: 'Zoom out' }).click();
    await sleep(400);
  }
  await panTo(mariaPage, mariaPage.locator('.fr-sg-badge').first(), 380, 150);
  await mariaPage.mouse.move(1500, 960);
  await sleep(900);
  await save(mariaPage, 'proposal', area(330, 95));

  await mariaPage.locator('.fr-sg-topbar').click();
  await sleep(900);
  await save(mariaPage, 'review', area(600, 60));

  // Accept everything, then send the "Handoffs and timing" cluster to Jira as one issue.
  await mariaPage.locator('.fr-sg-group').getByRole('button', { name: 'Accept all' }).click();
  await waitFor(async () => (await mariaPage.locator('.fr-sg-badge').count()) === 0, 10_000, 'the proposal accepted');
  await mariaPage.keyboard.press('Escape');
  const conn = (
    await maria.req('POST', '/api/trackers/connections', { provider: 'jira', name: 'Jira', site: jira.url, deployment: 'cloud', email: jira.email, token: jira.token, defaults: { project: 'WEB' } })
  ).connection;
  const handoffs = ['Docs were late again', 'Too many handoffs before release', 'Support didn’t know the launch date', 'Release notes written twice'].map((t) => id(t).id);
  await maria.req('POST', `/api/boards/${board.id}/trackers/send`, { connectionId: conn.id, project: 'WEB', itemIds: handoffs });
  await open(mariaPage, `?item=${handoffs[0]}`);
  await mariaPage.keyboard.press('Escape');
  await panTo(mariaPage, mariaPage.getByText('Handoffs and timing').first(), 200, 230);
  await mariaPage.mouse.move(1500, 960);
  await sleep(1500);
  await save(mariaPage, 'tracker', area(150, 180));
} finally {
  await browser.close();
  await jira.close?.();
}
console.log('done');
process.exit(0);
