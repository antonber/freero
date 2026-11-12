// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Account } from '@freero/shared';
import { VerifyEmailBanner } from './VerifyEmailBanner';

const unverified: Account = { id: 'u1', name: 'Ada', email: 'ada@work.example', color: '#1C7ED6', avatarUrl: null, createdAt: 0, emailVerified: false, deletionScheduledFor: null, timeZone: 'UTC' };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: unverified }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('a rate-limited resend shows the already-sent message with the minutes left, not a generic error', async () => {
  // What the server's error handler sends when RATE_LIMIT_EMAIL_VERIFY is used up (platform/rateLimit.ts).
  vi.stubGlobal('fetch', async (path: string) => {
    expect(path).toBe('/api/auth/verify-email/send');
    return new Response(JSON.stringify({ error: 'Too many requests. Please try again in 12 minutes.', code: 'rate_limited', params: { unit: 'minutes', count: 12 } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '700' },
    });
  });
  act(() => root.render(<VerifyEmailBanner />));
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Resend link')!;
  await act(async () => button.click());

  const text = host.textContent ?? '';
  expect(text).toContain('only the newest one works');
  expect(text).toContain('try again in 12 minutes');
  expect(text).not.toContain('Too many requests');
  // Clicking again can only hit the limit again.
  expect(host.querySelector('button')).toBeNull();
});
