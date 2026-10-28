import { afterAll, beforeAll, expect, it } from 'vitest';
import { SESSION_COOKIE } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser, endSessionsBeyondLimits, hashToken, newToken, onSessionEnd, sessionFromCookieHeader, setSessionLimits, SESSION_TTL_MS } from './service';

beforeAll(() => openTestDb());
afterAll(() => {
  setSessionLimits(() => ({ maxHours: null, idleMinutes: null }));
  return closeTestDb();
});

const MIN = 60_000;

/** A session that signed in `startedMinAgo` and was last used `seenMinAgo`; returns its cookie header and key. */
async function session(userId: string, startedMinAgo: number, seenMinAgo: number): Promise<{ cookie: string; key: string }> {
  const token = newToken();
  const now = Date.now();
  await repo.insertSession({ id: newToken().slice(0, 20), tokenHash: hashToken(token), userId, now: now - startedMinAgo * MIN, expiresAt: now + SESSION_TTL_MS, userAgent: '', ip: '' });
  if (seenMinAgo < startedMinAgo) await repo.touchSession(hashToken(token), now - seenMinAgo * MIN);
  return { cookie: `${SESSION_COOKIE}=${token}`, key: hashToken(token) };
}

it('a workspace session limit signs a session out at its next request once too old, ends idle ones from the job (closing their sockets), and spares sessions in use', async () => {
  const u = await createUser({ name: 'Limited', email: 'limited@policy.test.freero.app', password: 'password-123' });
  const old = await session(u.id, 9 * 60, 1); // signed in 9 h ago, used a minute ago
  const idle = await session(u.id, 60, 45); // untouched for 45 min
  const active = await session(u.id, 60, 2);
  const ended: string[] = [];
  const stop = onSessionEnd((key) => ended.push(key));
  setSessionLimits(() => ({ maxHours: 8, idleMinutes: 30 }));
  try {
    expect(await sessionFromCookieHeader(old.cookie)).toBeNull(); // forced re-login
    expect(ended).toEqual([old.key]);
    expect(await sessionFromCookieHeader(old.cookie)).toBeNull(); // and it stays gone

    expect(await endSessionsBeyondLimits([{ userId: u.id, maxHours: 8, idleMinutes: 30 }])).toBe(1);
    expect(ended).toEqual([old.key, idle.key]);
    expect((await sessionFromCookieHeader(active.cookie))?.user.id).toBe(u.id);
    // Idempotent: a second run (another instance, the next minute) ends nothing more.
    expect(await endSessionsBeyondLimits([{ userId: u.id, maxHours: 8, idleMinutes: 30 }])).toBe(0);
  } finally {
    stop();
  }
});
