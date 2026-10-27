import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { requestOriginKind } from './security';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('CSRF origin check', () => {
  const direct = loadConfig({});
  const proxied = loadConfig({ TRUST_PROXY: '1', PUBLIC_URL: 'https://board.example.com' });

  it('refuses a cross-site form post even when the browser sends only a Referer', () => {
    expect(requestOriginKind(req({ host: 'app.test', origin: 'https://evil.test' }), direct, false)).toBe('cross');
    expect(requestOriginKind(req({ host: 'app.test', referer: 'https://evil.test/page' }), direct, false)).toBe('cross');
    expect(requestOriginKind(req({ host: 'app.test', origin: 'null' }), direct, false)).toBe('cross');
    expect(requestOriginKind(req({ host: 'app.test', 'sec-fetch-site': 'cross-site' }), direct, false)).toBe('cross');
  });

  it('does not refuse the app itself behind a TLS-terminating proxy that rewrites Host', () => {
    const r = req({ host: 'app:4000', 'x-forwarded-host': 'board.example.com', origin: 'https://board.example.com' });
    expect(requestOriginKind(r, proxied, true)).toBe('same');
    expect(requestOriginKind(req({ host: 'app.test', origin: 'http://APP.test' }), direct, false)).toBe('same');
  });

  it('lets non-browser clients (no Origin, no Referer) through: they cannot carry a victim’s cookies', () => {
    expect(requestOriginKind(req({ host: 'app.test' }), direct, false)).toBe('unknown');
  });
});
