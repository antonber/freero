import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { EMBED_FRAME_ORIGINS } from '@freero/shared';
import { allowFraming, contentSecurityPolicy, requestOriginKind, securityHeaders } from './security';

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

describe('frames the CSP allows (live embeds, KAI-127)', () => {
  const frameSrc = (env: NodeJS.ProcessEnv) =>
    contentSecurityPolicy(loadConfig(env), 'app.test', true)
      .split('; ')
      .find((d) => d.startsWith('frame-src '))!
      .split(' ')
      .slice(1);

  it('lets the browser frame only the built-in providers and the operator’s extra origins, so a tampered link can frame nothing else', () => {
    expect(frameSrc({}).sort()).toEqual([...EMBED_FRAME_ORIGINS].sort());
    const extended = frameSrc({ EMBED_EXTRA_ORIGINS: 'https://embed.example.com, https://maps.example.org' });
    expect(extended).toEqual(expect.arrayContaining(['https://embed.example.com', 'https://maps.example.org', ...EMBED_FRAME_ORIGINS]));
    expect(extended).toHaveLength(EMBED_FRAME_ORIGINS.length + 2);
  });

  it('refuses operator origins that would widen framing beyond one https site', () => {
    for (const bad of ['http://embed.example.com', 'https://embed.example.com/path', '*', 'https://*.example.com', 'https://user:pw@embed.example.com'])
      expect(() => loadConfig({ EMBED_EXTRA_ORIGINS: bad })).toThrow(/EMBED_EXTRA_ORIGINS/);
    expect(() => loadConfig({ EMBED_EXTRA_ORIGINS: 'https://board.example.com', PUBLIC_URL: 'https://board.example.com' })).toThrow(/EMBED_EXTRA_ORIGINS/);
  });
});

it('Google Analytics widens the CSP only by Google’s hosts and the app’s own analytics frame, and not at all when unset, on any page another site may frame, or on the embeds’ pages', () => {
  const directives = (csp: string) => new Map(csp.split('; ').map((d) => [d.split(' ')[0], new Set(d.split(' ').slice(1))]));
  const unset = contentSecurityPolicy(loadConfig({}), 'app.test', true);
  expect(unset).not.toMatch(/googletagmanager|google-analytics|analytics.google/);
  // Framed pages: the assistants' live view (framable) and a board embedded on any site (ancestors '*').
  for (const opts of [{ framable: true }, { ancestors: ['*'] }])
    expect(contentSecurityPolicy(loadConfig({ GA_MEASUREMENT_ID: 'G-TEST123' }), 'app.test', true, opts)).toBe(contentSecurityPolicy(loadConfig({}), 'app.test', true, opts));
  // The embeds' own pages (the embedded board, its sign-in popup), as the security headers set them.
  const cspAt = (path: string, env: NodeJS.ProcessEnv) => {
    const set: Record<string, string> = {};
    securityHeaders(loadConfig(env))({ method: 'GET', path, headers: { host: 'app.test' }, secure: true } as never, { setHeader: (k: string, v: string) => (set[k.toLowerCase()] = v) } as never, () => undefined);
    return set['content-security-policy'];
  };
  for (const path of ['/embed/b/abc', '/embed/connect/abc', '/embed/board/abc']) expect(cspAt(path, { GA_MEASUREMENT_ID: 'G-TEST123' }), path).toBe(cspAt(path, {}));
  expect(cspAt('/app', { GA_MEASUREMENT_ID: 'G-TEST123' })).toContain('googletagmanager');

  const before = directives(unset);
  const after = directives(contentSecurityPolicy(loadConfig({ GA_MEASUREMENT_ID: 'g-test123' }), 'app.test', true));
  expect([...after.keys()]).toEqual([...before.keys()]);
  const added: string[] = [];
  for (const [name, sources] of after) {
    for (const s of before.get(name)!) expect(sources.has(s), `${name} lost ${s}`).toBe(true);
    for (const s of sources) if (!before.get(name)!.has(s)) added.push(`${name} ${s}`);
  }
  expect(added.sort()).toEqual(
    [
      'script-src https://www.googletagmanager.com',
      'connect-src https://*.google-analytics.com',
      'connect-src https://*.analytics.google.com',
      'connect-src https://*.googletagmanager.com',
      "frame-src 'self'",
    ].sort(),
  );
  // A Universal Analytics id would load nothing: refused at startup instead of failing silently.
  expect(() => loadConfig({ GA_MEASUREMENT_ID: 'UA-12345-1' })).toThrow(/GA_MEASUREMENT_ID/);
});

describe('who may frame Freero (MCP Apps live view, KAI-171)', () => {
  const headersFor = (path: string, env: NodeJS.ProcessEnv = {}) => {
    const set: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (set[k.toLowerCase()] = v) };
    securityHeaders(loadConfig(env))({ method: 'GET', path, headers: { host: 'app.test' }, secure: true } as never, res as never, () => undefined);
    const ancestors = set['content-security-policy'].split('; ').find((d) => d.startsWith('frame-ancestors '))!;
    return { ancestors: ancestors.split(' ').slice(1), xfo: set['x-frame-options'] };
  };
  allowFraming(/^\/embed\//, 'the live board view, signed in with its own token (test)');

  it('lets only the assistants frame the live board view, and nobody frame any other page (clickjacking)', () => {
    const page = headersFor('/board/abc');
    expect(page).toEqual({ ancestors: ["'none'"], xfo: 'DENY' });
    const view = headersFor('/embed/board/abc', { MCP_APP_FRAME_ANCESTORS: 'https://claude.ai https://*.claudemcpcontent.com' });
    expect(view).toEqual({ ancestors: ['https://claude.ai', 'https://*.claudemcpcontent.com'], xfo: undefined });
    expect(headersFor('/embed/board/abc', { MCP_APP_FRAME_ANCESTORS: 'none' }).ancestors).toEqual(["'none'"]);
  });
});
