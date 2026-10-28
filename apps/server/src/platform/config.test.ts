import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe('configuration', () => {
  it('refuses to start production without its required settings, listing every problem at once', () => {
    const problems = problemsOf({ NODE_ENV: 'production', PORT: 'eighty', S3_BUCKET: 'b' });
    expect(problems.join('\n')).toMatch(/DATABASE_URL/);
    expect(problems.join('\n')).toMatch(/PUBLIC_URL/);
    expect(problems.join('\n')).toMatch(/SESSION_SECRET/);
    expect(problems.join('\n')).toMatch(/PORT/);
    expect(problems.join('\n')).toMatch(/S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
  });

  it('does not silently fall back to a default when a limit or URL is malformed', () => {
    expect(problemsOf({ RATE_LIMIT_LOGIN: '10 per minute' })).toHaveLength(1);
    expect(problemsOf({ DATABASE_URL: 'mysql://x/y' })).toHaveLength(1);
    expect(problemsOf({ SESSION_SECRET: 'short' })).toHaveLength(1);
    // A provider with half its credentials would silently hide its button.
    expect(problemsOf({ OIDC_GOOGLE_CLIENT_ID: 'id-only' })).toHaveLength(1);
    expect(problemsOf({ GEOIP_DB_PATH: '/nonexistent/GeoLite2-City.mmdb' })).toHaveLength(1);
  });

  it('refuses a plain-http sign-in provider in production (a test provider must never reach it)', () => {
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/f', PUBLIC_URL: 'https://w.example.com', SESSION_SECRET: 'x'.repeat(40) };
    const provider = { OIDC_GOOGLE_CLIENT_ID: 'id', OIDC_GOOGLE_CLIENT_SECRET: 'secret', OIDC_GOOGLE_ISSUER: 'http://127.0.0.1:4252' };
    expect(problemsOf({ ...prod, ...provider })).toHaveLength(1);
    expect(problemsOf({ ...provider })).toHaveLength(0);
  });

  it('a complete production environment starts', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db:5432/freero',
      PUBLIC_URL: 'https://whiteboard.example.com/some/path',
      SESSION_SECRET: 'x'.repeat(40),
      RATE_LIMIT_LOGIN: '5/15m',
    });
    expect(config.publicUrl).toBe('https://whiteboard.example.com'); // origin only: CSRF compares origins
    expect(config.rateLimits.login).toEqual({ limit: 5, windowMs: 15 * 60_000 });
  });
});
