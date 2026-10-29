import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import type { Config } from '../../platform/config';
import siteRoutes, { mountPath } from './routes';
import { ORIGIN_PLACEHOLDER } from './site';

// A minimal site build (the manifest apps/site writes), served by the real routes.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-site-fixture-'));
const page = (title: string) => `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${ORIGIN_PLACEHOLDER}/claude"/></head><body><h1>${title}</h1></body></html>`;
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
  `<!doctype html><html><head><title>Privacy</title><meta name="robots" content="noindex, follow"/></head><body><aside class="legal-draft" role="note"><strong>Draft: not in effect.</strong> Under legal review.</aside><h1>Privacy policy</h1><p>Operated by [[freero-legal:operator]]. Write to [[freero-legal:contact]]. Deleted after [[freero-legal:deletionGraceDays]] days.</p></body></html>`,
);
fs.writeFileSync(
  path.join(dist, 'manifest.json'),
  JSON.stringify({
    version: 1,
    pages: [
      { path: '/', file: 'index.html' },
      { path: '/claude', file: 'claude/index.html' },
      { path: '/privacy', file: 'privacy/index.html' },
    ],
    files: [{ path: '/robots.txt', file: 'robots.txt', type: 'text/plain' }],
    notFound: '404.html',
    prefixes: ['/vs/'],
    assetsPrefix: '/_site',
    legal: ['/privacy'],
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

/** The same site build served with other SITE_LEGAL_* settings. */
async function servedWith(legal: Partial<Config['site']['legal']>, run: (base: string) => Promise<void>) {
  const app = createApp(config);
  app.use(mountPath, siteRoutes({ config: { ...config, site: { ...config.site, legal: { ...config.site.legal, ...legal } } }, onShutdown: () => undefined }));
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  try {
    await run(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  } finally {
    await new Promise((r) => s.close(r));
  }
}

it('until an operator is named, the privacy policy is visibly a draft that search engines may not index and sign-up asks nobody to agree; naming one puts it in effect with this server’s own facts', async () => {
  const draft = await fetch(`${base}/privacy`);
  const draftHtml = await draft.text();
  expect(draftHtml).toContain('Draft: not in effect');
  expect(draftHtml).toContain('<meta name="robots" content="noindex, follow"/>');
  expect(draft.headers.get('x-robots-tag')).toBe('noindex');
  expect(draftHtml).toContain('[the operator’s legal name: not set yet]');
  expect(await (await fetch(`${base}/api/site/legal`)).json()).toEqual({ legal: null });

  await servedWith({ operator: 'Kaiten Gaming <LLC>' }, async (live) => {
    const res = await fetch(`${live}/privacy`);
    const html = await res.text();
    expect(html).not.toContain('Draft: not in effect');
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large"/>');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    // The operator's facts, escaped as text; the retention this server is configured with.
    expect(html).toContain('Operated by Kaiten Gaming &lt;LLC&gt;.');
    expect(html).toContain('<a href="mailto:privacy@whiteboard.example.com">privacy@whiteboard.example.com</a>');
    expect(html).toContain('Deleted after 21 days.');
    expect(html).not.toContain('[[freero-legal:');
  });
});
