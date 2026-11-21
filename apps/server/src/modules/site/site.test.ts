import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import type { Config } from '../../platform/config';
import { flushProductEvents, startProductAnalytics, stopProductAnalytics } from '../analytics/index';
import siteRoutes, { mountPath } from './routes';
import { ORIGIN_PLACEHOLDER } from './site';

// A minimal site build (the manifest apps/site writes), served by the real routes.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-site-fixture-'));
const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="About ${title}."/><link rel="canonical" href="${ORIGIN_PLACEHOLDER}/claude"/><style>.topbar{color:red}</style></head>` +
  `<body><header class="topbar"><nav aria-label="Main"><a href="/pricing">Pricing</a></nav></header><main id="main"><h1>${title}</h1><p>Read <a href="/agents">the agents guide</a>.</p><script>track()</script></main><footer>Footer links</footer></body></html>`;
fs.mkdirSync(path.join(dist, 'claude'));
fs.mkdirSync(path.join(dist, '_site'));
fs.writeFileSync(path.join(dist, 'index.html'), page('Home'));
fs.writeFileSync(path.join(dist, 'claude/index.html'), page('Freero for Claude'));
fs.writeFileSync(path.join(dist, '404.html'), page('Not here'));
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nSitemap: ${ORIGIN_PLACEHOLDER}/sitemap.xml\n`);
// A legal page as apps/site builds it: a draft (banner + noindex) with tokens for the operator's facts.
fs.mkdirSync(path.join(dist, 'privacy'));
fs.writeFileSync(
  path.join(dist, 'privacy/index.html'),
  `<!doctype html><html><head><title>Privacy</title><meta name="robots" content="noindex, follow"/></head><body><aside class="legal-draft" role="note"><strong>Draft: not in effect.</strong> Under legal review.</aside><h1>Privacy policy</h1><p>Operated by [[freero-legal:operator]][[freero-legal:atAddress]]. Write to [[freero-legal:contact]]. Deleted after [[freero-legal:deletionGraceDays]] days.</p></body></html>`,
);
// A legal page the operator hasn't approved yet (apps/site `underReview`), as built: noindex, with its review line.
fs.mkdirSync(path.join(dist, 'dpa'));
fs.writeFileSync(
  path.join(dist, 'dpa/index.html'),
  `<!doctype html><html><head><title>DPA</title><meta name="robots" content="noindex, follow"/></head><body><aside class="legal-draft" role="note"><strong>Draft: not in effect.</strong></aside><p class="legal-review" role="note"><strong>Draft — under review.</strong></p><h1>Data processing addendum</h1><p>Processor: [[freero-legal:operator]].</p></body></html>`,
);
fs.writeFileSync(
  path.join(dist, 'manifest.json'),
  JSON.stringify({
    version: 1,
    pages: [
      { path: '/', file: 'index.html' },
      { path: '/claude', file: 'claude/index.html' },
      { path: '/privacy', file: 'privacy/index.html' },
      { path: '/dpa', file: 'dpa/index.html' },
    ],
    files: [{ path: '/robots.txt', file: 'robots.txt', type: 'text/plain' }],
    notFound: '404.html',
    prefixes: ['/vs/'],
    assetsPrefix: '/_site',
    legal: ['/privacy', '/dpa'],
    underReview: ['/dpa'],
  }),
);

let server: http.Server;
let base = '';
let config: Config;
beforeAll(async () => {
  config = await openTestDb({
    PUBLIC_URL: 'https://whiteboard.example.com',
    FREERO_SITE_DIST: dist,
    SITE_ANALYTICS_SRC: 'https://stats.example.org/script.js',
    SITE_ANALYTICS_ATTRS: 'domain=whiteboard.example.com',
    SITE_LEGAL_CONTACT_EMAIL: 'privacy@whiteboard.example.com',
    ACCOUNT_DELETION_GRACE_DAYS: '21',
  });
  const app = createApp(config);
  app.use(mountPath, siteRoutes({ config, onShutdown: () => undefined }));
  app.get('/login', (_req, res) => res.send('the web app'));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
  fs.rmSync(dist, { recursive: true, force: true });
});

it('marketing pages carry PUBLIC_URL and the operator’s analytics script, whose origin alone the CSP lets run; app pages get neither', async () => {
  const res = await fetch(`${base}/claude`);
  const html = await res.text();
  expect(html).toContain('<link rel="canonical" href="https://whiteboard.example.com/claude"/>');
  expect(html).toContain('<script defer src="https://stats.example.org/script.js" data-domain="whiteboard.example.com"></script></head>');
  const csp = res.headers.get('content-security-policy')!;
  expect(csp).toContain("script-src 'self' https://stats.example.org;");
  expect(csp).toContain("connect-src 'self' https://stats.example.org");

  const app = await fetch(`${base}/login`);
  expect(await app.text()).toBe('the web app');
  expect(app.headers.get('content-security-policy')).toContain("script-src 'self';");
});

it('a missing page under a site prefix is the site’s own 404, and /claude/ redirects to the one canonical URL', async () => {
  const missing = await fetch(`${base}/vs/nobody`);
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('Not here');
  const slash = await fetch(`${base}/claude/?ref=x`, { redirect: 'manual' });
  expect([slash.status, slash.headers.get('location')]).toEqual([301, '/claude?ref=x']);
});

it('the IndexNow key file is served at /<key>.txt only while SITE_INDEXNOW_KEY is set, so search engines accept this host’s submissions and nobody else’s key verifies', async () => {
  const key = 'a1b2c3d4e5f6a7b8c9d0';
  expect((await fetch(`${base}/${key}.txt`)).status).toBe(404);
  await servedWithSite({ indexNowKey: key }, async (b) => {
    const res = await fetch(`${b}/${key}.txt`);
    expect([res.status, await res.text()]).toEqual([200, key]);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect((await fetch(`${b}/b2c3d4e5f6a7b8c9d0e1.txt`)).status).toBe(404);
  });
});

/** The same site build served with other site settings. */
async function servedWithSite(site: Partial<Config['site']>, run: (base: string) => Promise<void>) {
  const app = createApp(config);
  app.use(mountPath, siteRoutes({ config: { ...config, site: { ...config.site, ...site } }, onShutdown: () => undefined }));
  app.use(errorHandler());
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  try {
    await run(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  } finally {
    await new Promise((r) => s.close(r));
  }
}

/** The same site build served with other SITE_LEGAL_* settings. */
async function servedWith(legal: Partial<Config['site']['legal']>, run: (base: string) => Promise<void>) {
  await servedWithSite({ legal: { ...config.site.legal, ...legal } }, run);
}

it('until an operator is named, the privacy policy is visibly a draft that search engines may not index and sign-up asks nobody to agree; naming one puts it in effect with this server’s own facts', async () => {
  const draft = await fetch(`${base}/privacy`);
  const draftHtml = await draft.text();
  expect(draftHtml).toContain('Draft: not in effect');
  expect(draftHtml).toContain('<meta name="robots" content="noindex, follow"/>');
  expect(draft.headers.get('x-robots-tag')).toBe('noindex');
  expect(draftHtml).toContain('[the operator’s legal name: not set yet]');
  expect(draftHtml).toContain('[postal address: not set yet]');
  expect(await (await fetch(`${base}/api/site/legal`)).json()).toEqual({ legal: null });

  await servedWith({ operator: 'Kaiten Gaming <LLC>' }, async (live) => {
    const res = await fetch(`${live}/privacy`);
    const html = await res.text();
    expect(html).not.toContain('Draft: not in effect');
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large"/>');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    // The operator's facts, escaped as text (no address set: the clause is left out, never a placeholder
    // on terms in force); the retention this server is configured with.
    expect(html).toContain('Operated by Kaiten Gaming &lt;LLC&gt;.');
    expect(html).toContain('<a href="mailto:privacy@whiteboard.example.com">privacy@whiteboard.example.com</a>');
    expect(html).toContain('Deleted after 21 days.');
    expect(html).not.toContain('[[freero-legal:');
  });
});

it('a page the operator hasn’t approved stays out of search results and keeps its “under review” line even once the legal pages are in effect', async () => {
  await servedWith({ operator: 'Kaiten Gaming LLC' }, async (live) => {
    const res = await fetch(`${live}/dpa`);
    const html = await res.text();
    expect(html).toContain('Processor: Kaiten Gaming LLC.');
    expect(html).toContain('Draft — under review.');
    expect(html).toContain('<meta name="robots" content="noindex, follow"/>');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });
});

it('marketing pages load the Google Analytics runtime only where GA_MEASUREMENT_ID is set', async () => {
  // This suite's server has no id: no runtime, no Google host anywhere on the page or in its CSP.
  const plain = await fetch(`${base}/claude`);
  expect(await plain.text()).not.toMatch(/analytics\.js|googletagmanager|data-freero-ga/);
  expect(plain.headers.get('content-security-policy')).not.toMatch(/googletagmanager|google-analytics/);

  const withGa: Config = { ...config, googleAnalyticsId: 'G-TEST123' };
  const app = createApp(withGa);
  app.use(mountPath, siteRoutes({ config: withGa, onShutdown: () => undefined }));
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  try {
    const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const res = await fetch(`${b}/claude`);
    expect(await res.text()).toContain('<script src="/analytics.js" data-freero-ga="G-TEST123" defer></script></head>');
    expect(res.headers.get('content-security-policy')).toContain('https://www.googletagmanager.com');
    // The site's own 404 too: its footer has the analytics opt-out like every page.
    expect(await (await fetch(`${b}/vs/nobody`)).text()).toContain('data-freero-ga="G-TEST123"');
  } finally {
    await new Promise((r) => s.close(r));
  }
});

describe('pages as Markdown for AI agents', () => {
  const as = (ua: string, extra: Record<string, string> = {}) => ({ headers: { 'User-Agent': ua, ...extra } });
  const CLAUDEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
  const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  it('an AI agent gets a page as Markdown at its own address — its text and links, not the header, footer, styling or scripts — while a browser and Googlebot get the HTML, which names the .md copy', async () => {
    const res = await fetch(`${base}/claude`, as(CLAUDEBOT));
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(res.headers.get('vary')).toMatch(/Accept/);
    expect(res.headers.get('vary')).toMatch(/User-Agent/);
    const md = await res.text();
    expect(md).toContain('title: "Freero for Claude"');
    expect(md).toContain('url: "https://whiteboard.example.com/claude"');
    expect(md).toContain('# Freero for Claude');
    expect(md).toContain('Read [the agents guide](https://whiteboard.example.com/agents).');
    for (const gone of ['Pricing', 'Footer links', 'track()', 'color:red', '<']) expect(md).not.toContain(gone);

    // Search engines are never shown a different page from people's: the HTML, as a browser gets it.
    for (const ua of [GOOGLEBOT, CHROME]) {
      const html = await fetch(`${base}/claude`, as(ua));
      expect(html.headers.get('content-type')).toMatch(/^text\/html/);
      const text = await html.text();
      expect(text).toContain('<link rel="alternate" type="text/markdown" href="/claude.md"/>');
      expect(text).toContain('<footer>Footer links</footer>');
    }

    // Any client may ask for it: by Accept, or at the page's address + .md (never a search result of its own).
    const accepted = await fetch(`${base}/claude`, as(CHROME, { Accept: 'text/markdown, text/html;q=0.9' }));
    expect(await accepted.text()).toBe(md);
    const copy = await fetch(`${base}/claude.md`, as(CHROME));
    expect(await copy.text()).toBe(md);
    expect(copy.headers.get('x-robots-tag')).toBe('noindex');
    expect(copy.headers.get('link')).toBe('<https://whiteboard.example.com/claude>; rel="canonical"');
    expect(await (await fetch(`${base}/index.md`)).text()).toContain('# Home');
    expect((await fetch(`${base}/nothing-here.md`)).status).not.toBe(200);
  });

  it('a legal page’s Markdown is the filled-in page: a draft says it is one and stays out of search, terms in force name this server’s operator', async () => {
    const draft = await fetch(`${base}/privacy.md`);
    const draftMd = await draft.text();
    expect(draftMd).toContain('**Draft: not in effect.**');
    expect(draftMd).toContain('\\[the operator’s legal name: not set yet\\]');
    expect(draft.headers.get('x-robots-tag')).toBe('noindex');

    await servedWith({ operator: 'Kaiten Gaming <LLC>' }, async (live) => {
      const res = await fetch(`${live}/privacy`, as(CLAUDEBOT));
      const md = await res.text();
      expect(md).not.toContain('Draft: not in effect');
      expect(res.headers.get('x-robots-tag')).toBeNull();
      // Escaped, so the name can't become HTML where the Markdown is rendered.
      expect(md).toContain('Operated by Kaiten Gaming \\<LLC>.');
      expect(md).toContain('[privacy@whiteboard.example.com](mailto:privacy@whiteboard.example.com)');
      expect(md).toContain('Deleted after 21 days.');
    });
  });

  it('each agent visit reaches PostHog as agent_page_fetched under the agent’s name — page and how it asked, no person profile — and a person’s visit sends nothing', async () => {
    const bodies: string[] = [];
    const posthog = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        bodies.push((req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":1}');
      });
    });
    await new Promise<void>((r) => posthog.listen(0, '127.0.0.1', r));
    const withPostHog: Config = { ...config, posthog: { key: 'phc_testtesttesttesttesttest1234', host: `http://127.0.0.1:${(posthog.address() as AddressInfo).port}`, browserHost: '', uiHost: '', assets: '', browser: false, errors: false } };
    startProductAnalytics(withPostHog);
    try {
      await fetch(`${base}/claude`, as(CLAUDEBOT));
      await fetch(`${base}/claude.md`, as('curl/8.9'));
      await fetch(`${base}/claude`, as(CHROME));
      await flushProductEvents();
      const events = bodies.flatMap((b) => (JSON.parse(b) as { batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> }).batch);
      expect(events.map((e) => [e.event, e.distinct_id, e.properties.agent, e.properties.path, e.properties.via])).toEqual([
        ['agent_page_fetched', 'agent:ClaudeBot', 'ClaudeBot', '/claude', 'user-agent'],
        ['agent_page_fetched', 'agent:other', 'other', '/claude', 'md-url'],
      ]);
      expect(events[0].properties).toMatchObject({ $process_person_profile: false, $geoip_disable: true });
    } finally {
      await stopProductAnalytics();
      await new Promise((r) => posthog.close(r));
    }
  });
});
