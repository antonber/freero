// Test-only webhook receiver: records every POST Freero delivers (path, headers, body, when) and
// answers with the status set for its path (200 by default), so checks can see what was sent,
// verify signatures and make an endpoint fail on purpose. `npm run verify` uses it; it also runs
// standalone for driving the admin console by hand:
//
//   node scripts/lib/webhook-receiver.mjs --port 4502
//
// Paths are free-form: /json, /slack, /teams … each its own endpoint.

import { createHmac } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

/** Starts a receiver; resolves to { port, url(path), received, answer(path, status), close() }. */
export function startWebhookReceiver({ port = 0, host = '127.0.0.1' } = {}) {
  const received = [];
  const status = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0];
      received.push({ path, headers: req.headers, body, at: Date.now() });
      const code = status.get(path) ?? 200;
      res.statusCode = code;
      if (code >= 300 && code < 400) res.setHeader('location', 'http://127.0.0.1:9/elsewhere');
      res.end(code < 300 ? 'ok' : 'no');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: (path) => `http://${host}:${actual}${path}`,
        received,
        answer: (path, code) => status.set(path, code),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Whether a delivery's `freero-signature` header is the HMAC of its body with `secret`. */
export function signedWith(secret, delivery) {
  const parts = Object.fromEntries(String(delivery.headers['freero-signature'] ?? '').split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  return createHmac('sha256', secret).update(`${parts.t}.${delivery.body}`).digest('hex') === parts.v1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const r = await startWebhookReceiver({ port: i >= 0 ? Number(process.argv[i + 1]) : 4502 });
  console.log(`webhook receiver on http://127.0.0.1:${r.port} (POST anything; every request is printed)`);
  setInterval(() => {
    for (const d of r.received.splice(0)) console.log(`${new Date(d.at).toISOString()} ${d.path} ${d.headers['freero-event']} ${d.body.slice(0, 300)}`);
  }, 500);
}
