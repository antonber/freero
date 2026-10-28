import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, duplicateBoard, listBoards } from './service';

// The content write of a duplicate succeeds and then the request fails (e.g. the connection drops).
vi.mock('../realtime/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../realtime/index')>();
  return {
    ...real,
    snapshotBoardDoc: async (id: string) => (await real.snapshotBoardDoc(id)) ?? new Uint8Array([0, 0]),
    initBoardDoc: async (id: string, state: Uint8Array) => {
      await real.initBoardDoc(id, state);
      throw new Error('connection lost');
    },
  };
});

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

// The content write runs in another module (realtime) yet joins the duplicate's transaction: were it
// outside, it could not even see the uncommitted board row (FK) — and on PGlite it would deadlock.
it('a duplicate that fails after its content was written leaves no copy behind', async () => {
  const user = await createUser({ name: 'Dup', email: 'dup@test.freero.app', password: 'password-123' });
  const source = await createBoard(user.id, 'Original', '');
  await expect(duplicateBoard(source, user.id, 'owner')).rejects.toThrow('connection lost');
  const boards = await listBoards(user.id, 'all', '');
  expect(boards.map((b) => b.title)).toEqual(['Original']);
});
