import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../platform/http';
import { loadConfig, type Config } from '../../platform/config';
import { withAnalyticsRuntime } from './index';
import analyticsRoutes, { mountPath } from './routes';

/** The module's routes with a stand-in for the web build's static files behind them. */
async function serve(config: Config) {
  const app = createApp(config);
  app.use(mountPath, analyticsRoutes({ config, onShutdown: () => undefined }));
  app.get('/analytics.js', (_req, res) => res.type('text/javascript').send('/* runtime */'));
  app.get('/posthog.js', (_req, res) => res.type('text/javascript').send('/* posthog */'));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let off: Awaited<ReturnType<typeof serve>>;
let on: Awaited<ReturnType<typeof serve>>;
beforeAll(async () => {
  off = await serve(loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory' }));
  on = await serve(loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', GA_MEASUREMENT_ID: 'G-TEST123' }));
});
afterAll(async () => {
  for (const s of [off, on]) await new Promise((r) => s.server.close(r));
});

it('without GA_MEASUREMENT_ID or POSTHOG_KEY a server offers no analytics: the app is told both are off, and neither the runtime, the frame nor the product-event endpoints exist', async () => {
  expect(await (await fetch(`${off.base}/api/analytics`)).json()).toEqual({ enabled: false, productAnalytics: false });
  expect((await fetch(`${off.base}/analytics.js`)).status).toBe(404);
  expect((await fetch(`${off.base}/analytics-frame`)).status).toBe(404);
  const post = (path: string, method: string, body: unknown) =>
    fetch(`${off.base}${path}`, { method, headers: { origin: off.base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/analytics/events', 'POST', { name: 'template_used', template: 'kanban' })).status).toBe(404);
  expect((await post('/api/analytics/opt-out', 'PUT', { optedOut: true })).status).toBe(404);
});

it('PostHog runs in pages only with POSTHOG_BROWSER: then the app is told its key, where to send (POSTHOG_BROWSER_HOST, a proxy, when set) and PostHog’s own app for links, and the marketing pages get its runtime; with POSTHOG_KEY alone neither, and /posthog.js is a 404', async () => {
  const key = { NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', POSTHOG_KEY: 'phc_testtesttesttesttesttest1234' };
  const serverOnly = await serve(loadConfig(key));
  const browser = await serve(loadConfig({ ...key, POSTHOG_BROWSER: 'true' }));
  try {
    expect((await (await fetch(`${serverOnly.base}/api/analytics`)).json()).posthog).toBeUndefined();
    expect((await fetch(`${serverOnly.base}/posthog.js`)).status).toBe(404);
    expect(withAnalyticsRuntime('<head></head>', loadConfig(key))).toBe('<head></head>');
    // Signed out: no pseudonym to identify with.
    expect((await (await fetch(`${browser.base}/api/analytics`)).json()).posthog).toEqual({ key: key.POSTHOG_KEY, host: 'https://us.i.posthog.com', uiHost: 'https://us.posthog.com' });
    expect(await (await fetch(`${browser.base}/posthog.js`)).text()).toBe('/* posthog */');
    expect(withAnalyticsRuntime('<head></head>', loadConfig({ ...key, POSTHOG_BROWSER: 'true' }))).toContain(`<script src="/posthog.js" data-freero-ph-key="${key.POSTHOG_KEY}" data-freero-ph-host="https://us.i.posthog.com" data-freero-ph-ui="https://us.posthog.com" defer></script>`);
    // Behind a proxy, pages send to it while links still open PostHog's app for POSTHOG_HOST's region.
    const proxied = loadConfig({ ...key, POSTHOG_BROWSER: 'true', POSTHOG_BROWSER_HOST: 'https://t.app.test/' });
    expect(proxied.posthog).toMatchObject({ host: 'https://us.i.posthog.com', browserHost: 'https://t.app.test', uiHost: 'https://us.posthog.com' });
    expect(withAnalyticsRuntime('<head></head>', proxied)).toContain('data-freero-ph-host="https://t.app.test" data-freero-ph-ui="https://us.posthog.com"');
  } finally {
    for (const s of [serverOnly, browser]) await new Promise((r) => s.server.close(r));
  }
});

it('with it, the analytics frame runs the runtime in frame mode and only this origin may frame it', async () => {
  expect(await (await fetch(`${on.base}/api/analytics`)).json()).toEqual({ enabled: true, productAnalytics: false });
  expect(await (await fetch(`${on.base}/analytics.js`)).text()).toBe('/* runtime */');
  const res = await fetch(`${on.base}/analytics-frame`);
  expect(await res.text()).toContain('<script src="/analytics.js" data-freero-ga="G-TEST123" data-mode="frame"></script>');
  expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
});
