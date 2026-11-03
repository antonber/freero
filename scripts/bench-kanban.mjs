#!/usr/bin/env node
// Kanban performance benchmark (docs/design/kanban-fields-and-views.md §18). Not a unit test:
// timings depend on the machine, so it reports numbers and checks nothing but that each scenario
// did what it says. Run it before a phase-3 step merges and compare with the doc's
// "Performance (as measured)" table.
//
//   npm run bench:kanban [-- --sizes 500,1000,2000,5000] [--big 5000] [--repeat 3] [--only <name part>] [--side web|server] [--json]
//
// web:    a real engine session (scripts/bench/kanban-web.ts through vite-node with the web app's
//         config): bulk creation into a kanban by every path the app has, and the hot paths on a
//         big kanban (a card moved, re-lays, an unrelated edit, visible elements, the outline).
// server: the pure planning behind every server write to a kanban (scripts/bench/kanban-server.ts
//         with tsx): add_cards / structure placement and withKanbanLayout.
// Each line is the median of --repeat fresh runs (one run for the slowest scenarios at 5k).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const side = opt('side', 'both');
const pass = ['sizes', 'big', 'repeat', 'only'].flatMap((k) => (opt(k) === undefined ? [] : [`--${k}`, opt(k)]));
const npx = 'npx';

function run(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } });
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    process.exit(r.status ?? 1);
  }
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l));
}

const results = [];
if (side !== 'server') results.push(...run(npx, ['vite-node', '../../scripts/bench/kanban-web.ts', ...pass], path.join(root, 'apps/web')));
if (side !== 'web') results.push(...run(npx, ['tsx', 'scripts/bench/kanban-server.ts', ...pass], root));

if (args.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// One table per side: a row per scenario, a column per size (scenarios on the big kanban have one).
const fmt = (r) => (r.skip ? `n/a (${r.skip})` : r.ms === undefined ? (r.ok ? 'ok' : 'FAILED') : `${r.ms < 10 ? r.ms.toFixed(1) : Math.round(r.ms)} ms${r.per ? ` / ${r.per}` : ''}${r.note ? ` (${r.note})` : ''}`);
let failed = false;
for (const s of ['web', 'server']) {
  const rows = results.filter((r) => r.side === s);
  if (!rows.length) continue;
  const bulk = rows.filter((r) => r.n !== null && !/\(\d+ cards/.test(r.name));
  const sizes = [...new Set(bulk.map((r) => r.n))].sort((a, b) => a - b);
  console.log(`\n${s === 'web' ? 'Web (engine session)' : 'Server (planning)'}\n`);
  if (bulk.length) {
    console.log(`| Bulk creation | ${sizes.join(' | ')} |`);
    console.log(`|---|${sizes.map(() => '---:').join('|')}|`);
    for (const name of [...new Set(bulk.map((r) => r.name))]) console.log(`| ${name} | ${sizes.map((n) => fmt(bulk.find((r) => r.name === name && r.n === n) ?? { ms: NaN })).join(' | ')} |`);
  }
  const hot = rows.filter((r) => !bulk.includes(r));
  if (hot.length) {
    console.log('\n| On a big kanban | |\n|---|---:|');
    for (const r of hot) console.log(`| ${r.name} | ${fmt(r)} |`);
  }
  failed ||= rows.some((r) => r.note || r.ok === false);
}
if (failed) console.log('\nA line with a note did not do what it says (see the note).');
