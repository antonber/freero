import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCOUNT_SUSPENDED } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser, hashToken, newToken, onSessionEnd, refuseIfSuspended, suspendUser, unsuspendUser, userFromCookieHeader } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

/** A signed-in browser of the user: its cookie header (the session row as startSession writes it). */
async function signedIn(userId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await repo.insertSession({ id: newToken().slice(0, 20), tokenHash: hashToken(token), userId, now, expiresAt: now + 86_400_000, userAgent: '', ip: '' });
  return `freero_session=${token}`;
}

it('suspending an account ends its sessions everywhere at once, and a session a racing sign-in creates afterwards never resolves', async () => {
  const u = await createUser({ name: 'Spammer', email: 'spammer@test.freero.app', password: 'password-123' });
  const cookie = await signedIn(u.id);
  expect((await userFromCookieHeader(cookie))?.id).toBe(u.id);
  const ended: string[] = [];
  const stop = onSessionEnd((key) => ended.push(key)); // realtime closes these sockets on every instance
  await suspendUser(u.id);
  stop();
  expect(ended).toHaveLength(1);
  expect(await userFromCookieHeader(cookie)).toBeNull();

  const racing = await signedIn(u.id); // a sign-in that passed its checks just before the suspension
  expect(await userFromCookieHeader(racing)).toBeNull();
  await expect(refuseIfSuspended(u.id)).rejects.toMatchObject({ status: 403, code: ACCOUNT_SUSPENDED });

  await unsuspendUser(u.id);
  await expect(refuseIfSuspended(u.id)).resolves.toBeUndefined();
  expect((await userFromCookieHeader(await signedIn(u.id)))?.id).toBe(u.id);
});
