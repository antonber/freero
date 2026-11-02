#!/usr/bin/env node
// Submit a deployment's pages to IndexNow after a deploy (Bing, Yandex, Seznam, Naver and the other
// engines that share it). The URLs come from the live sitemap.xml, so the list is exactly what the
// site asks to have indexed; the key is the one the server serves at /<key>.txt (SITE_INDEXNOW_KEY).
//
//   SITE_INDEXNOW_KEY=<key> node scripts/indexnow.mjs --site https://freero.app [--since 2026-11-02] [--dry-run]
//
//   --site     the public origin (default: PUBLIC_URL)
//   --key      the IndexNow key (default: SITE_INDEXNOW_KEY)
//   --since    only pages whose sitemap lastmod is on or after this day (YYYY-MM-DD): the changed ones
//   --dry-run  list what would be sent, send nothing
//
// It first checks that <site>/<key>.txt answers with the key (the server must be deployed with the
// same SITE_INDEXNOW_KEY), since IndexNow rejects every URL otherwise. Exit code 1 on any failure.
import { INDEXNOW_ENDPOINT, indexNowRequests, sitemapUrls } from './lib/indexnow.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const site = (opt('site') ?? process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
const key = opt('key') ?? process.env.SITE_INDEXNOW_KEY ?? '';
const since = opt('since') ?? null;
const dryRun = args.includes('--dry-run');

function fail(message) {
  console.error(`indexnow: ${message}`);
  process.exit(1);
}

// http only on this machine, to try it against a local server with --dry-run.
if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(site)) fail('--site (or PUBLIC_URL) must be an https origin such as https://freero.app');
if (!key) fail('no key: pass --key or set SITE_INDEXNOW_KEY');
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail('--since must be a date, YYYY-MM-DD');

async function text(url) {
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status !== 200) fail(`${url} answered ${res.status}`);
  return res.text();
}

const served = (await text(`${site}/${key}.txt`)).trim();
if (served !== key) fail(`${site}/${key}.txt does not contain the key: deploy the server with the same SITE_INDEXNOW_KEY`);

const urls = await sitemapUrls(text, `${site}/sitemap.xml`, { since });
const { bodies, skipped } = indexNowRequests(site, key, urls);
for (const u of skipped) console.warn(`indexnow: skipping ${u}: not on ${site}`);
const count = bodies.reduce((n, b) => n + b.urlList.length, 0);
if (!count) {
  console.log(`indexnow: nothing to submit${since ? ` changed since ${since}` : ''}`);
  process.exit(0);
}
if (dryRun) {
  for (const b of bodies) for (const u of b.urlList) console.log(u);
  console.log(`indexnow: dry run, ${count} URLs not sent`);
  process.exit(0);
}

for (const body of bodies) {
  const res = await fetch(INDEXNOW_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  // 200: received. 202: received, the key is still being checked. Anything else: refused.
  if (res.status !== 200 && res.status !== 202) fail(`IndexNow refused ${body.urlList.length} URLs: ${res.status} ${await res.text()}`);
  console.log(`indexnow: submitted ${body.urlList.length} URLs (${res.status})`);
}
