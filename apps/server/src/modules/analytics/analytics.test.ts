import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../platform/http';
import { loadConfig, type Config } from '../../platform/config';
import analyticsRoutes, { mountPath } from './routes';

/** The module's routes with a stand-in for the web build's static files behind them. */
async function serve(config: Config) {
  const app = createApp(config);
  app.use(mountPath, analyticsRoutes({ config, onShutdown: () => undefined }));
  app.get('/analytics.js', (_req, res) => res.type('text/javascript').send('/* runtime */'));
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

it('with it, the analytics frame runs the runtime in frame mode and only this origin may frame it', async () => {
  expect(await (await fetch(`${on.base}/api/analytics`)).json()).toEqual({ enabled: true, productAnalytics: false });
  expect(await (await fetch(`${on.base}/analytics.js`)).text()).toBe('/* runtime */');
  const res = await fetch(`${on.base}/analytics-frame`);
  expect(await res.text()).toContain('<script src="/analytics.js" data-freero-ga="G-TEST123" data-mode="frame"></script>');
  expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
});
