import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfig } from './config';
import { createApp } from './http';

// A domain move: the instance now answers at freero.app and used to answer at old.example.app.
const config = loadConfig({ PUBLIC_URL: 'https://freero.app', PREVIOUS_PUBLIC_URLS: 'https://old.example.app' });
let server: http.Server;
let port = 0;

beforeAll(async () => {
  const app = createApp(config);
  app.get('/board/:id', (_req, res) => void res.send('board'));
  app.post('/api/trackers/webhooks/:id', (_req, res) => void res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const request = (method: string, path: string, host: string) =>
  new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const req = http.request({ port, method, path, headers: { host, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });

it('sends a link to the old domain to the same board on the new one, query included', async () => {
  expect(await request('GET', '/board/abc?item=x1', 'old.example.app')).toEqual({ status: 301, location: 'https://freero.app/board/abc?item=x1' });
  expect((await request('GET', '/board/abc', 'freero.app')).status).toBe(200);
});

it('keeps serving webhooks posted to the old domain (trackers do not follow redirects) and its health check', async () => {
  expect((await request('POST', '/api/trackers/webhooks/w1', 'old.example.app')).status).toBe(200);
  expect((await request('GET', '/healthz', 'old.example.app')).status).toBe(200);
});

it('refuses a previous address without PUBLIC_URL to move to, or equal to it (a redirect loop)', () => {
  expect(() => loadConfig({ PREVIOUS_PUBLIC_URLS: 'https://old.example.app' })).toThrow(/PREVIOUS_PUBLIC_URLS needs PUBLIC_URL/);
  expect(() => loadConfig({ PUBLIC_URL: 'https://freero.app', PREVIOUS_PUBLIC_URLS: 'https://freero.app/' })).toThrow(/must not contain PUBLIC_URL/);
});
