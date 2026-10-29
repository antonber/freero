// A board's meeting link is sealed at rest (KAI-143): these links often carry the meeting's
// passcode, so the database (a dump, a backup) must not hold them readable.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { sealStoredCallLinks } from './call';
import * as repo from './repo';
import { createBoard } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const LINK = 'https://meet.example.com/j/123456?pwd=s3cretPasscode';

it('a call link is stored sealed yet reads back; a plain one stored before still works and the job seals it', async () => {
  const user = await createUser({ name: 'Caller', email: 'caller@test.freero.app', password: 'password-123' });
  const sealedBoard = await createBoard(user.id, 'Standup', '');
  const legacyBoard = await createBoard(user.id, 'Retro', '');
  await repo.setCall(sealedBoard.id, { url: LINK, jitsi: false });
  await repo.setCall(legacyBoard.id, { url: LINK, jitsi: false });
  const stored = async (id: string) => (await repo.storedCallUrls('', 100)).find((r) => r.id === id)!.stored;
  expect(await stored(sealedBoard.id)).not.toContain('s3cretPasscode');
  expect((await repo.getBoard(sealedBoard.id))?.callUrl).toBe(LINK);

  // A row written before links were sealed holds plain text.
  await repo.replaceStoredCallUrl(legacyBoard.id, await stored(legacyBoard.id), LINK);
  expect((await repo.getBoard(legacyBoard.id))?.callUrl).toBe(LINK);
  expect(await sealStoredCallLinks(repo)).toBe(1);
  expect(await stored(legacyBoard.id)).not.toContain('s3cretPasscode');
  expect((await repo.getBoard(legacyBoard.id))?.callUrl).toBe(LINK);
  expect(await sealStoredCallLinks(repo)).toBe(0); // idempotent
});
