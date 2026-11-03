// What a board starts with (#115): new boards get today's defaults (line jumps on); a copy is its
// source, so a board that turned line jumps off stays that way when duplicated.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Y_SETTINGS } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { initBoardDoc, snapshotBoardDoc } from '../realtime/index';
import { createBoard, duplicateBoard } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

async function settingsOf(boardId: string): Promise<Record<string, unknown>> {
  const state = await snapshotBoardDoc(boardId);
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc.getMap<unknown>(Y_SETTINGS).toJSON();
}

it('a new board starts with line jumps on, and a copy of a board that turned them off keeps them off', async () => {
  const user = await createUser({ name: 'Lines', email: 'lines@test.freero.app', password: 'password-123' });
  const fresh = await createBoard(user.id, 'Fresh', '');
  expect(await settingsOf(fresh.id)).toMatchObject({ lineJumps: true });

  // A board whose owner turned them off (stored before anyone opened it).
  const plain = await createBoard(user.id, 'Plain lines', '');
  const off = new Y.Doc();
  off.getMap(Y_SETTINGS).set('lineJumps', false);
  await initBoardDoc(plain.id, Y.encodeStateAsUpdate(off));
  const copy = await duplicateBoard(plain, user.id, 'owner');
  expect(await settingsOf(copy.id)).toMatchObject({ lineJumps: false });
});
