// Icebreakers (#150): the server makes every spin and publishes it, so all clients agree; only the
// people running the session spin.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ICEBREAKER_RESULTS_COLLECTION, type ElementDraft, type IcebreakerResult, type User } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount, markEmailVerified, type Actor } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { changeBoard, snapshotBoardDoc } from '../realtime/index';
import { roll, rollRefusal } from './service';

beforeAll(() => openTestDb({ FREERO_DOC_IDLE_MS: '100' }));
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@icebreakers.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
const as = async (u: User): Promise<Actor> => ({ kind: 'user', user: await getAccount(u.id) });

async function published(boardId: string): Promise<IcebreakerResult | undefined> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await snapshotBoardDoc(boardId))!);
  return doc.getMap<IcebreakerResult>(ICEBREAKER_RESULTS_COLLECTION).get('wheel1');
}

it('the server picks the wheel’s result and publishes it for everyone; and a viewer can’t spin', async () => {
  const [owner, editor, viewer] = [await person('Owner'), await person('Edith'), await person('Victor')];
  const board = await createBoard(owner.id, 'Retro', '', 'viewer');
  await inviteBoardMember(null, board.id, { ...owner, emailVerified: true } as never, { email: editor.email, role: 'editor' });
  const wheel = { id: 'wheel1', type: 'icebreaker', kind: 'wheel', title: 'Who goes first?', entries: ['Ann', ' ', 'Bob', 'Cat'], color: '#5B3FF0', x: 0, y: 0, w: 320, h: 360, rotation: 0 } as unknown as ElementDraft;
  await changeBoard(board.id, { userId: owner.id, role: 'owner' }, () => ({ change: { create: [wheel] } }));

  const first = await roll(board.id, 'wheel1', await as(editor), 1_000);
  expect(await published(board.id)).toEqual(first);
  expect(first).toMatchObject({ seq: 1, at: 1_000, of: 3, by: 'Edith' });
  expect(['Ann', 'Bob', 'Cat']).toContain(first.picked);
  expect(['Ann', 'Bob', 'Cat'][first.index!]).toBe(first.picked);

  await expect(roll(board.id, 'wheel1', await as(viewer))).rejects.toMatchObject({ status: 403 });

  expect((await roll(board.id, 'wheel1', await as(owner))).seq).toBe(2);
});

it('during a facilitation session only the facilitator and the owner spin; editors, commenters and guests watch', () => {
  const session = { by: 'u-fac', byName: 'Fay', startedAt: 1, locked: false, allowedTypes: null, follow: false, cursorsHidden: false };
  expect(rollRefusal('editor', 'u-fac', session)).toBeNull();
  expect(rollRefusal('owner', 'u-owner', session)).toBeNull();
  expect(rollRefusal('editor', 'u-ed', session)).toMatch(/Fay/);
  expect(rollRefusal('editor', 'u-ed', undefined)).toBeNull();
  expect(rollRefusal('commenter', 'guest_1', undefined)).not.toBeNull();
});
