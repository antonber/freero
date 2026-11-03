import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import * as repo from './repo';
import { createUser, hashToken, newToken, sessionFromCookieHeader, updateProfile } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

async function signedIn(userId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await repo.insertSession({ id: newToken().slice(0, 20), tokenHash: hashToken(token), userId, now, expiresAt: now + 86_400_000, userAgent: '', ip: '' });
  return `freero_session=${token}`;
}

it('the theme picked on one device comes with the session on another, a later profile edit keeps it, and only system / light / dark are taken', async () => {
  const u = await createUser({ name: 'Night Owl', email: 'owl@test.freero.app', password: 'password-123' });
  const laptop = await signedIn(u.id);
  expect((await sessionFromCookieHeader(laptop))?.user.theme).toBe('system');
  await updateProfile(u.id, { theme: 'dark' });
  await updateProfile(u.id, { name: 'Night Owl 2' });
  const phone = await signedIn(u.id);
  expect((await sessionFromCookieHeader(phone))?.user.theme).toBe('dark');
  await expect(updateProfile(u.id, { theme: 'sepia' })).rejects.toMatchObject({ status: 400 });
  expect((await sessionFromCookieHeader(laptop))?.user.theme).toBe('dark');
});
