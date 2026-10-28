import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createBoard } from '../boards/index';
import * as repo from './repo';
import { createUser, hashToken, newToken, onSessionEnd, recheckLiveSessions, SESSION_TTL_MS, trackLiveSessions } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

async function session(userId: string, expiresAt = Date.now() + SESSION_TTL_MS): Promise<string> {
  const key = hashToken(newToken());
  await repo.insertSession({ id: newToken().slice(0, 20), tokenHash: key, userId, now: Date.now(), expiresAt, userAgent: '', ip: '' });
  return key;
}

async function guest(boardId: string, expiresAt: number): Promise<string> {
  const key = hashToken(newToken());
  const id = `guest_${newToken().slice(0, 16)}`;
  await repo.insertGuest({ id, boardId, name: 'Visitor', color: '#1C7ED6', createdAt: Date.now(), expiresAt, tokenHash: key, ip: '' });
  return key;
}

// KAI-146: sessions ended where no listener runs (the operator CLI, raw SQL, expiry) must not keep
// their open board tabs and bells connected until a reload — and guests on a link must stay on.
it('sessions deleted behind the server\'s back, expired, or of a suspended account close their open connections at the next re-check; live ones (guests too) stay open', async () => {
  const now = Date.now();
  const a = await createUser({ name: 'Kept', email: 'kept@live.test.freero.app', password: 'password-123' });
  const b = await createUser({ name: 'Deleted', email: 'deleted@live.test.freero.app', password: 'password-123' });
  const c = await createUser({ name: 'Suspended', email: 'suspended@live.test.freero.app', password: 'password-123' });
  const kept = await session(a.id);
  const expiring = await session(a.id, now + 60_000);
  const deleted = await session(b.id);
  const suspended = await session(c.id);
  const board = await createBoard(a.id, 'Shared', '', 'viewer');
  const visitor = await guest(board.id, now + 3_600_000);
  const leavingVisitor = await guest(board.id, now + 60_000);
  const open = new Set([kept, expiring, deleted, suspended, kept, visitor, leavingVisitor]); // two tabs on one session
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

    expect(await recheckLiveSessions(now + 120_000)).toBe(4);
    expect(ended.sort()).toEqual([expiring, deleted, suspended, leavingVisitor].sort());
    expect([...open].sort()).toEqual([kept, visitor].sort());
    // The next round finds nothing more to close.
    expect(await recheckLiveSessions(now + 120_000)).toBe(0);
  } finally {
    stopListening();
    stopTracking();
  }
});
