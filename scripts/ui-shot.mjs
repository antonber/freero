#!/usr/bin/env node
// Drive the real Freero web app in headless Chromium and save screenshots.
//
//   node scripts/ui-shot.mjs --url http://localhost:5173/board/local --out shot.png
//        [--steps my-steps.mjs] [--width 1440] [--height 900] [--login email:password]
//
// --steps: an ES module whose default export is `async ({ page, shot }) => {}`.
//          `shot(name)` saves an extra screenshot next to --out (e.g. shot-name.png).
// --login: logs in through the real REST API first (cookie is shared with the page).
// Console errors and uncaught page errors are printed and make the exit code 1.

import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const url = opt('url');
const out = path.resolve(opt('out', 'shot.png'));
if (!url) {
  console.error('Usage: node scripts/ui-shot.mjs --url <url> --out <file.png> [--steps steps.mjs] [--login email:pw]');
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: Number(opt('width', 1440)), height: Number(opt('height', 900)) },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const login = opt('login');
if (login) {
  const [email, password] = login.split(':');
  const origin = new URL(url).origin;
  const res = await context.request.post(`${origin}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    console.error(`login failed: ${res.status()} ${await res.text()}`);
    await browser.close();
    process.exit(1);
  }
}

const shot = async (name) => {
  const file = out.replace(/\.png$/, `-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`saved ${file}`);
};

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  const steps = opt('steps');
  if (steps) {
    const mod = await import(pathToFileURL(path.resolve(steps)).href);
    await mod.default({ page, context, shot });
  }
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} catch (e) {
  problems.push(`step failed: ${e.message}`);
  await page.screenshot({ path: out }).catch(() => {});
}

await browser.close();
for (const p of problems) console.error(p);
process.exit(problems.length ? 1 : 0);
