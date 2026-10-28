import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser, hashToken, newToken, onSessionEnd, recheckLiveSessions, SESSION_TTL_MS, trackLiveSessions } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

async function session(userId: string, expiresAt = Date.now() + SESSION_TTL_MS): Promise<string> {
  const key = hashToken(newToken());
  await repo.insertSession({ id: newToken().slice(0, 20), tokenHash: key, userId, now: Date.now(), expiresAt, userAgent: '', ip: '' });
  return key;
}

// KAI-146: sessions ended where no listener runs (the operator CLI, raw SQL, expiry) must not keep
// their open board tabs and bells connected until a reload.
it('sessions deleted behind the server\'s back, expired, or of a suspended account close their open connections at the next re-check; live ones stay open', async () => {
  const now = Date.now();
  const a = await createUser({ name: 'Kept', email: 'kept@live.test.freero.app', password: 'password-123' });
  const b = await createUser({ name: 'Deleted', email: 'deleted@live.test.freero.app', password: 'password-123' });
  const c = await createUser({ name: 'Suspended', email: 'suspended@live.test.freero.app', password: 'password-123' });
  const kept = await session(a.id);
  const expiring = await session(a.id, now + 60_000);
  const deleted = await session(b.id);
  const suspended = await session(c.id);
  const open = new Set([kept, expiring, deleted, suspended, kept]); // two tabs on one session
  const ended: string[] = [];
  const stopListening = onSessionEnd((key) => {
    ended.push(key);
    open.delete(key);
  });
  const stopTracking = trackLiveSessions(() => open);
  try {
    await repo.deleteSessionsOf(b.id, null); // like raw SQL or the CLI without Redis: no listener runs here
    await repo.suspend(c.id, now);
    expect(ended).toEqual([]);

    expect(await recheckLiveSessions(now + 120_000)).toBe(3);
    expect(ended.sort()).toEqual([expiring, deleted, suspended].sort());
    expect([...open]).toEqual([kept]);
    // The next round finds nothing more to close.
    expect(await recheckLiveSessions(now + 120_000)).toBe(0);
  } finally {
    stopListening();
    stopTracking();
  }
});
