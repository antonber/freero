#!/usr/bin/env node
// Seeds a fully populated demo account on any Freero instance, for directory reviewers (Claude
// connectors directory, ChatGPT app directory) and demos. Everything goes through the public
// surface a customer uses: the account API to sign up or sign in and make a short-lived personal
// token, then the MCP server (the same tools an assistant calls) to fill the boards. The token is
// revoked at the end.
//
//   FREERO_URL=https://freero.example.com REVIEWER_EMAIL=reviewer@example.com REVIEWER_PASSWORD='…' \
//     node scripts/seed-reviewer-account.mjs [--name "Directory Reviewer"] [--force] [--json out.json]
//
//   or: node scripts/seed-reviewer-account.mjs --url … --email … --password … (flags win over env)
//
// It signs in when the account exists and signs up when it doesn't. Run it again and it skips boards
// the account already has (by title) unless --force. The account must NOT have two-step
// verification on: reviewers sign in with the email and password alone. On a server that sends
// email, verify the address once (use a mailbox you control). Never hard-code credentials here, and
// don't run it against an instance you don't operate.
//
// Board text is invented demo content; nothing comes from a real customer.
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (opt('url') ?? process.env.FREERO_URL ?? '').replace(/\/+$/, '');
const EMAIL = opt('email') ?? process.env.REVIEWER_EMAIL;
const PASSWORD = opt('password') ?? process.env.REVIEWER_PASSWORD;
const NAME = opt('name') ?? process.env.REVIEWER_NAME ?? 'Directory Reviewer';
const FORCE = flag('force');
const JSON_OUT = opt('json');
if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: FREERO_URL=… REVIEWER_EMAIL=… REVIEWER_PASSWORD=… node scripts/seed-reviewer-account.mjs [--name …] [--force] [--json file]');
  process.exit(2);
}
if (!/^https?:\/\//.test(BASE)) {
  console.error(`FREERO_URL must be an http(s) URL, got ${BASE}`);
  process.exit(2);
}

// ---- the account API (a session cookie, like the web app) ----
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const [k] = pair.split('=');
    cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), pair].join('; ');
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

async function signIn() {
  const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status === 200 && login.json?.user) return { user: login.json.user, created: false };
  if (login.status === 200) throw new Error('This account has two-step verification on. Reviewers must sign in with the email and password alone: turn it off for the reviewer account.');
  if (login.status !== 401 && login.status !== 400) throw new Error(`Signing in failed: ${login.status} ${login.text}`);
  const signup = await api('POST', '/api/auth/signup', { name: NAME, email: EMAIL, password: PASSWORD });
  if (signup.status === 200 || signup.status === 201) return { user: signup.json.user, created: true };
  throw new Error(`Couldn’t sign in (${login.status}: ${login.json?.error ?? login.text}) or sign up (${signup.status}: ${signup.json?.error ?? signup.text}). Check the email and password.`);
}

// ---- the MCP server, as an assistant uses it ----
let mcp;
async function tool(name, args) {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (r.isError) throw new Error(`${name}: ${text}`);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text result */
  }
  return { ...(parsed ?? {}), ...(r.structuredContent ?? {}), text };
}

const made = { account: EMAIL, instance: BASE, boards: [], docs: [] };
const existing = new Map();
async function loadExisting() {
  let cursor;
  do {
    const page = await tool('search_boards', { limit: 50, ...(cursor ? { cursor } : {}) });
    // Board titles are people's text: they arrive inside the untrusted-content envelope.
    for (const b of page.untrusted_board_content?.boards ?? page.boards ?? []) existing.set(b.title, b);
    cursor = page.nextCursor;
  } while (cursor);
}
/** A board with this title, made once: returns null when it is there already (and not --force). */
async function newBoard(title, description) {
  if (!FORCE && existing.has(title)) {
    const b = existing.get(title);
    console.log(`  = ${title} (already there: ${b.url})`);
    made.boards.push({ title, id: b.id, url: b.url, skipped: true });
    return null;
  }
  const out = await tool('create_board', { title, description });
  const board = { title, id: out.boardId, url: out.url };
  made.boards.push(board);
  return board;
}

async function seedRetro() {
  const b = await newBoard('Sprint 14 retro', 'What went well, what didn’t, and what we’ll change next sprint.');
  if (!b) return;
  const { clusters, containerId: frameId } = await tool('add_clusters', {
    boardId: b.id,
    placement: { newFrame: 'Sprint 14 retrospective' },
    clusters: [
      {
        title: 'Went well',
        color: 'green',
        items: ['Checkout redesign shipped on the planned date', 'Pairing on the payments bug cut review time in half', 'Design and engineering demoed together', 'Zero rollbacks this sprint'],
      },
      {
        title: 'Didn’t go well',
        color: 'pink',
        items: ['Docs were finished two days after release', 'Too many handoffs between QA and engineering', 'Flaky end-to-end tests blocked merges twice', 'Support didn’t know the launch date'],
      },
      { title: 'Ideas', color: 'blue', items: ['Write docs in the same pull request', 'One release channel for support and sales', 'Quarantine flaky tests automatically'] },
    ],
  });
  // The actions go into the retro's frame, next to the themes they came from.
  await tool('add_cards', {
    boardId: b.id,
    placement: { into: frameId },
    cards: [
      { title: 'Docs ship with the feature', description: 'Owner: Priya. Add a docs checkbox to the PR template.', status: 'todo', dueDate: '2026-11-13' },
      { title: 'Announce launch dates in #releases', description: 'Owner: Sam. One post per release, a week ahead.', status: 'doing' },
      { title: 'Quarantine flaky e2e tests', description: 'Owner: Lee. Auto-retry once, then file an issue.', status: 'todo', dueDate: '2026-11-20' },
    ],
  });
  await tool('add_comment', { boardId: b.id, itemId: clusters[1].titleId, text: 'Handoffs came up in the last two retros as well — worth a working session?' });
  // A proposal waiting for review: what an assistant with read + suggest access does. Made through a
  // token of its own that stays (#89): revoking a credential withdraws what it proposed (KAI-224),
  // so one made with the seed's token, revoked at the end, would never be there for reviewers.
  const proposer = await api('POST', '/api/auth/tokens', { name: 'Demo assistant', scopes: ['boards:read', 'boards:suggest'], expiresInDays: null });
  if (proposer.status !== 201) throw new Error(`Couldn’t make the demo assistant's token: ${proposer.status} ${proposer.text}`);
  const assistant = new Client({ name: 'freero-reviewer-seed', version: '1.0.0' });
  await assistant.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${proposer.json.secret}` } } }));
  try {
    const r = await assistant.callTool({
      name: 'propose_changes',
      arguments: {
        boardId: b.id,
        description: 'A theme that groups the release-process notes',
        structure: { kind: 'stickies', title: 'Suggested theme: release process', items: ['Docs, support and QA all learn about releases late', 'One release checklist owned by the release captain'] },
      },
    });
    if (r.isError) throw new Error(`propose_changes: ${(r.content ?? []).map((c) => c.text ?? '').join(' ')}`);
  } finally {
    await assistant.close().catch(() => undefined);
  }
  console.log(`  + ${b.title}: three clusters and three action cards in a frame, a comment, one proposal waiting for review (by the "Demo assistant" token, kept: revoking it withdraws the proposal)`);
}

async function seedRoadmap() {
  const b = await newBoard('Product roadmap: H1 2027', 'Now, next and later, with owners and target dates.');
  if (!b) return null;
  await tool('add_cards', {
    boardId: b.id,
    title: 'H1 2027 roadmap',
    columns: [
      {
        title: 'Now',
        cards: [
          { title: 'Self-serve workspace billing', description: 'Owner: Ana. Invoices, seats and receipts in the admin console.', status: 'doing', dueDate: '2026-12-15', color: '#5b3ff0' },
          { title: 'Faster board load on mobile', description: 'Owner: Kofi. Target: under 1.5 s on a mid-range phone.', status: 'doing', dueDate: '2026-12-01' },
          { title: 'Audit log export to S3', description: 'Owner: Mei. Daily, signed, for compliance teams.', status: 'todo', dueDate: '2027-01-15' },
        ],
      },
      {
        title: 'Next',
        cards: [
          { title: 'Offline editing', description: 'Edit without a connection; changes merge when you are back.', status: 'todo', dueDate: '2027-03-01' },
          { title: 'Template gallery for workshops', description: 'Retros, story maps, planning poker and lean canvas.', status: 'todo' },
          { title: 'Calendar view for task cards', description: 'Cards with due dates on a month grid.', status: 'todo' },
        ],
      },
      {
        title: 'Later',
        cards: [
          { title: 'Whiteboard-to-slides export', description: 'Each frame becomes a slide.', status: 'todo' },
          { title: 'Read-only presenter links', description: 'Follow the presenter without an account.', status: 'todo' },
        ],
      },
    ],
  });
  await tool('add_diagram', {
    boardId: b.id,
    outline: {
      text: 'H1 2027 goals',
      children: [
        { text: 'Teams pay without talking to sales', children: [{ text: 'Self-serve billing' }, { text: 'Seat management' }] },
        { text: 'Boards feel instant everywhere', children: [{ text: 'Mobile load time' }, { text: 'Offline editing' }] },
        { text: 'Compliance teams say yes', children: [{ text: 'Audit export' }, { text: 'Retention settings' }] },
      ],
    },
  });
  console.log(`  + ${b.title}: a Now / Next / Later kanban with eight cards (owners, dates), a goals mind map`);
  return b;
}

async function seedFlow() {
  const b = await newBoard('Signup flow', 'How a new team gets from the landing page to its first board.');
  if (!b) return;
  await tool('add_diagram', {
    boardId: b.id,
    mermaid: [
      'flowchart LR',
      '  A[Landing page] --> B{Has an account?}',
      '  B -- yes --> C[Log in]',
      '  B -- no --> D[Sign up]',
      '  D --> E[Verify email]',
      '  E --> F[Create workspace]',
      '  C --> G[Dashboard]',
      '  F --> G',
      '  G --> H[First board from a template]',
      '  H --> I[Invite teammates]',
    ].join('\n'),
  });
  await tool('add_stickies', {
    boardId: b.id,
    title: 'Open questions',
    color: 'yellow',
    stickies: ['Can we skip email verification for invited people?', 'Which template do most teams start with?', 'Do we ask for a team name before the first board?'],
  });
  console.log(`  + ${b.title}: a flowchart with attached connectors, three open questions`);
}

async function seedControlRoom() {
  const title = 'Agent control room: docs migration';
  if (!FORCE && existing.has(title)) {
    const b = existing.get(title);
    console.log(`  = ${title} (already there: ${b.url})`);
    made.boards.push({ title, id: b.id, url: b.url, skipped: true });
    return;
  }
  const out = await tool('post_status', {
    title,
    agent: 'Docs assistant',
    plan: ['Inventory the old help center', 'Map each article to a new page', 'Migrate and rewrite in batches of ten', 'Ask a person to review each batch', 'Redirect the old URLs'],
    status: 'Migrating batch 2 of 4; waiting on a decision about the API reference.',
    tasks: [
      { title: 'Inventory old articles', state: 'done', externalId: 'inv' },
      { title: 'Migrate batch 1: basics', state: 'done', externalId: 'b1' },
      { title: 'Migrate batch 2: boards and sharing', state: 'doing', externalId: 'b2' },
      { title: 'Migrate batch 3: integrations', state: 'todo', externalId: 'b3' },
      { title: 'Set up redirects', state: 'todo', externalId: 'redirects' },
      { title: 'Move the API reference?', state: 'blocked', externalId: 'api-ref', note: 'Generate it from openapi.json, or keep the hand-written pages? I need a person to decide.' },
    ],
  });
  made.boards.push({ title, id: out.boardId, url: out.url });
  console.log(`  + ${title}: an agent lane with its plan, status and six tasks across To do / Doing / Done / Blocked`);
}

async function seedDoc(roadmap) {
  const title = 'H1 2027 planning brief';
  if (!FORCE && made.docs.length === 0) {
    const found = await tool('search_docs', { query: title });
    const d = (found.untrusted_board_content?.docs ?? found.docs ?? []).find((x) => x.title === title);
    if (d) {
      console.log(`  = ${title} (already there: ${d.url})`);
      made.docs.push({ title, id: d.id, url: d.url, skipped: true });
      return;
    }
  }
  const boardRef = roadmap ?? made.boards.find((x) => x.title.startsWith('Product roadmap'));
  const markdown = [
    `# ${title}`,
    '',
    'What we are building in the first half of 2027, why, and how we will know it worked.',
    '',
    '## Goals',
    '',
    '1. **Teams pay without talking to sales.** Self-serve billing and seat management.',
    '2. **Boards feel instant everywhere.** Mobile load under 1.5 s; offline editing next.',
    '3. **Compliance teams say yes.** Audit export and retention settings.',
    '',
    '## The roadmap, live',
    '',
    'The board below is the real roadmap: drag a card and it moves here too.',
    '',
    ...(boardRef ? [`![Live board](freero://board/${boardRef.id})`, ''] : []),
    '## Decisions so far',
    '',
    '| Decision | Date | Owner |',
    '|---|---|---|',
    '| Billing ships before offline editing | 2026-10-20 | Ana |',
    '| Mobile performance budget: 1.5 s | 2026-10-22 | Kofi |',
    '',
    '## Open questions',
    '',
    '- [ ] Do we need annual plans at launch?',
    '- [x] Who owns the template gallery? (Design)',
  ].join('\n');
  const out = await tool('create_doc', { markdown, title });
  made.docs.push({ title, id: out.docId, url: out.url });
  console.log(`  + ${title}: a doc with goals, a decisions table, a checklist and the roadmap board embedded live`);
}

// ---- run ----
const { user, created } = await signIn();
console.log(`${created ? 'Created' : 'Signed in to'} ${EMAIL} (${user.name}) on ${BASE}`);
if (user.emailVerified === false) console.log('  ! The email address is not verified yet: open the verification email once so reviewers never see the reminder.');
const tokenRes = await api('POST', '/api/auth/tokens', {
  name: `Reviewer seed ${new Date().toISOString().slice(0, 16)}`,
  scopes: ['boards:read', 'boards:suggest', 'boards:write', 'comments:write'],
  expiresInDays: 1,
});
if (tokenRes.status !== 201) throw new Error(`Couldn’t make a personal token: ${tokenRes.status} ${tokenRes.text}`);
const token = tokenRes.json;
mcp = new Client({ name: 'freero-reviewer-seed', version: '1.0.0' });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token.secret}` } } }));
  await loadExisting();
  console.log('Boards and docs:');
  await seedRetro();
  const roadmap = await seedRoadmap();
  await seedFlow();
  await seedControlRoom();
  await seedDoc(roadmap);
} finally {
  await mcp.close().catch(() => undefined);
  // The seed's own token goes; the account keeps nothing it didn't make itself.
  const id = token.token?.id ?? token.id;
  if (id) await api('DELETE', `/api/auth/tokens/${encodeURIComponent(id)}`);
}

console.log('\nReviewer account ready:');
console.log(`  sign in at ${BASE}/login with ${EMAIL} and the password you supplied`);
for (const b of made.boards) console.log(`  board  ${b.title.padEnd(40)} ${b.url}`);
for (const d of made.docs) console.log(`  doc    ${d.title.padEnd(40)} ${d.url}`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(made, null, 2));
  console.log(`  (written to ${JSON_OUT})`);
}
