#!/usr/bin/env node
// The marketing site's "how it works" screenshots, taken from the real app: a real server, real
// accounts, a board filled through the real API, a personal token acting as an agent, and a local
// mock Jira (scripts/lib/mock-jira.mjs). Saved as WebP at 800 and 1600 px wide into
// apps/site/src/assets/shots/, which the site's <Shot> reads.
//
//   1. Start a throwaway server that serves the built web app, on ports nobody else uses:
//        npm run build -w @freero/web
//        PORT=4571 FREERO_DATA_DIR=<scratch>/data TRACKER_PRIVATE_ENDPOINTS=true npx tsx apps/server/src/main.ts
//   2. node scripts/site-shots.mjs --base http://localhost:4571 --data <scratch>/data [--out <dir>] [--only poker,roadmap]
//      (--only: just these shots; workshop, proposal, review and tracker are taken together)
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
const ONLY = opt('only')?.split(',');
const want = (...names) => !ONLY || names.some((n) => ONLY.includes(n));
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
/** The same shape, nearly the whole window: for a board too wide for `area` (an agent's lane). */
const wide = (x, y) => ({ x, y, width: 1400, height: 980 });

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
  const openBoard = async (page, id, q = '') => {
    await page.goto(`${BASE}/board/${id}${q}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-fr-element]', { timeout: 20_000 }).catch(() => {});
    await sleep(1200);
  };
  if (want('workshop', 'proposal', 'review', 'tracker')) {
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
  }

  // Planning poker (/use-cases/planning-poker): Maria estimates three story cards with Leo and Ana;
  // the shot is the revealed round.
  if (want('poker')) {
    const ana = new Person('Ana Silva', `ana-${stamp}@shots.freero.test`);
    await ana.signup();
    const sprint = (await maria.req('POST', '/api/boards', { title: 'Sprint 19 planning' })).board;
    for (const p of [leo, ana]) await maria.req('POST', `/api/boards/${sprint.id}/members`, { email: p.email, role: 'editor' });
    const stories = [
      { type: 'card', text: 'Export a board as PDF with one page per frame', color: '#5B3FF0' },
      { type: 'card', text: 'Remember the last zoom level per board', color: '#1FBF96' },
      { type: 'card', text: 'Invite guests from the share dialog', color: '#F5A524' },
    ];
    await maria.req('POST', `/api/boards/${sprint.id}/insert-structure`, { structure: { kind: 'items', items: stories, layout: 'grid', title: 'Ready for estimation' } });
    const anaPage = await (await ctx(ana)).newPage();
    for (const page of [mariaPage, leoPage, anaPage]) await openBoard(page, sprint.id);
    await mariaPage.getByRole('button', { name: 'Board menu' }).click();
    await mariaPage.getByText('Estimate with planning poker…', { exact: true }).click();
    await mariaPage.getByRole('button', { name: 'Start estimating' }).click();
    const pick = async (page, v) => {
      await page.locator('.fr-est-bar__deck .fr-est-card', { hasText: new RegExp(`^${v}$`) }).first().click({ timeout: 15_000 });
      await sleep(300);
    };
    await pick(mariaPage, '5');
    await pick(leoPage, '5');
    await pick(anaPage, '8');
    await sleep(800);
    await mariaPage.getByRole('button', { name: 'Reveal' }).click();
    await mariaPage.mouse.move(1500, 960);
    await sleep(1500);
    // The round's bar sits at the top of the window, the item under it.
    await save(mariaPage, 'poker', area(300, 0));
    await anaPage.close();
  }

  // An agent's control room (/use-cases/agent-control-room): a token acting as Claude Code posts
  // its plan, status and tasks through the REST API's control-room endpoint.
  if (want('control-room')) {
    const room = (await maria.req('POST', '/api/boards', { title: 'Data migration' })).board;
    const { secret } = await maria.req('POST', '/api/auth/tokens', { name: 'Claude Code', scopes: ['boards:read', 'boards:write'], expiresInDays: 1 });
    await maria.req(
      'POST',
      `/api/v1/boards/${room.id}/control-room`,
      {
        agent: 'Claude Code',
        plan: ['Inventory the old billing tables', 'Write the migration and its rollback', 'Run it on a copy of production', 'Hand over for review'],
        status: 'Migration written; 18 of 22 tables checked on the copy. Waiting on an answer about archived invoices.',
        tasks: [
          { title: 'List every table the billing service reads', state: 'done' },
          { title: 'Map old columns to the new schema', state: 'done' },
          { title: 'Write the migration and its rollback', state: 'done' },
          { title: 'Check row counts on the production copy', state: 'doing' },
          { title: 'Archived invoices: migrate or keep read-only?', state: 'blocked', note: 'Finance still reads them monthly. Should they move to the new tables or stay where they are?' },
          { title: 'Write the hand-over notes', state: 'todo' },
        ],
      },
      { authorization: `Bearer ${secret}` },
    );
    await openBoard(mariaPage, room.id);
    // The lane (notes and a four-column kanban) is wide: one step out, and most of the window.
    await mariaPage.getByRole('button', { name: 'Zoom out' }).click();
    await sleep(400);
    await mariaPage.mouse.move(1500, 960);
    await sleep(800);
    await save(mariaPage, 'control-room', wide(100, 10));
  }

  // A roadmap (/use-cases/roadmaps): Jira issues imported onto a timeline, a lane per epic.
  if (want('roadmap')) {
    const road = (await maria.req('POST', '/api/boards', { title: 'Q4 roadmap' })).board;
    await openBoard(mariaPage, road.id);
    await mariaPage.getByRole('button', { name: 'More tools' }).click();
    await mariaPage.locator('.fr-moretools__item', { hasText: 'Timeline' }).click();
    await mariaPage.mouse.click(800, 500);
    await sleep(1200);
    const outline = await maria.req('GET', `/api/boards/${road.id}/outline?format=json`);
    const timelineId = JSON.stringify(outline).match(/"id":"([^"]+)","kind":"timeline"/)?.[1];
    if (!timelineId) throw new Error(`no timeline on the roadmap board: ${JSON.stringify(outline).slice(0, 400)}`);
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const at = (days) => new Date(monday.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const epics = { checkout: { key: 'WEB-900', fields: { summary: 'New checkout' } }, search: { key: 'WEB-901', fields: { summary: 'Search' } }, mobile: { key: 'WEB-902', fields: { summary: 'Mobile app' } } };
    const items = [
      ['Payment step redesign', 'checkout', 0, 12],
      ['Saved addresses', 'checkout', 10, 24],
      ['Express checkout', 'checkout', 26, 45],
      ['Search index rebuild', 'search', 3, 20],
      ['Typo-tolerant search', 'search', 21, 38],
      ['Offline mode', 'mobile', 7, 30],
      ['Push notifications', 'mobile', 31, 50],
    ];
    for (const [summary, epic, from, to] of items)
      jira.create('WEB', { summary, labels: ['roadmap'], parent: epics[epic], customfield_10015: at(from), duedate: at(to), description: { type: 'doc', version: 1, content: [] } });
    const conn = (
      await maria.req('POST', '/api/trackers/connections', { provider: 'jira', name: 'Jira roadmap', site: jira.url, deployment: 'cloud', email: jira.email, token: jira.token, defaults: { project: 'WEB' } })
    ).connection;
    await maria.req('POST', `/api/boards/${road.id}/trackers/import`, { connectionId: conn.id, query: 'labels = roadmap', timeline: { id: timelineId, groupBy: 'epic' } });
    await openBoard(mariaPage, road.id);
    await mariaPage.keyboard.press('Escape');
    // The timeline is wider than the shot: one step out.
    await mariaPage.getByRole('button', { name: 'Zoom out' }).click();
    await sleep(400);
    await mariaPage.mouse.move(1500, 960);
    await sleep(1200);
    await save(mariaPage, 'roadmap', area(300, 150));
  }
} finally {
  await browser.close();
  await jira.close?.();
}
console.log('done');
process.exit(0);
