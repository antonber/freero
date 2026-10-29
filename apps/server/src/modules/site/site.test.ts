import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
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
fs.writeFileSync(
  path.join(dist, 'manifest.json'),
  JSON.stringify({
    version: 1,
    pages: [
      { path: '/', file: 'index.html' },
      { path: '/claude', file: 'claude/index.html' },
    ],
    files: [{ path: '/robots.txt', file: 'robots.txt', type: 'text/plain' }],
    notFound: '404.html',
    prefixes: ['/vs/'],
    assetsPrefix: '/_site',
  }),
);

let server: http.Server;
let base = '';
beforeAll(async () => {
  const config = await openTestDb({
    PUBLIC_URL: 'https://whiteboard.example.com',
    FREERO_SITE_DIST: dist,
    SITE_ANALYTICS_SRC: 'https://stats.example.org/script.js',
    SITE_ANALYTICS_ATTRS: 'domain=whiteboard.example.com',
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
