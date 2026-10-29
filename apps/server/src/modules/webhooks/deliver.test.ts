// Webhook URLs are typed by workspace admins: nothing they type may make the server call into its
// own network — not when the endpoint is added, and not at connect time.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { checkEndpointUrl, postOnce } from './deliver';

it('refuses private, loopback, link-local and metadata addresses, plain http and credentials in the URL when it is added', () => {
  for (const url of [
    'http://example.com/hook',
    'https://localhost/hook',
    'https://app.localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.1.2.3/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[::ffff:7f00:1]/hook',
    'https://user:pw@example.com/hook',
  ])
    expect(() => checkEndpointUrl(url, false), url).toThrow();
  expect(checkEndpointUrl('https://hooks.example.com/services/T1/B2/abc', false).hostname).toBe('hooks.example.com');
});

it('a name that only resolves to a loopback address is refused when connecting, and the receiver behind it is never reached', async () => {
  let reached = false;
  const server = http.createServer((_req, res) => {
    reached = true;
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    // "localhost." (trailing dot) passes the name check and resolves to 127.0.0.1 through DNS: the
    // connect-time lookup is what stops it.
    const out = await postOnce(`https://localhost.:${port}/hook`, '{}', {}, { timeoutMs: 3000, allowPrivate: false });
    expect(out.ok).toBe(false);
    // (Where the resolver doesn't answer for "localhost." at all, nothing is reached either.)
    expect(out.error).toMatch(/private address|ENOTFOUND/);
    expect(reached).toBe(false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
