// Presenting (#146): handing the presentation over is the server's checked state change.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PRESENTATION_COLLECTION, type PresentationSession, type User } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount, markEmailVerified, type Actor } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { snapshotBoardDoc } from '../realtime/index';
import { controlRefusal, present } from './service';

beforeAll(() => openTestDb({ FREERO_DOC_IDLE_MS: '100' }));
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@present.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
const as = async (u: User): Promise<Actor> => ({ kind: 'user', user: await getAccount(u.id) });

async function session(boardId: string): Promise<PresentationSession | undefined> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await snapshotBoardDoc(boardId))!);
  return doc.getMap<PresentationSession>(PRESENTATION_COLLECTION).get('session');
}

it('only the presenter (or the facilitator, or the owner) hands the presentation over, and only to someone on the board now', async () => {
  const [owner, editor] = [await person('Olga'), await person('Ed')];
  const board = await createBoard(owner.id, 'Deck', '', 'viewer');
  await inviteBoardMember(null, board.id, { ...owner, emailVerified: true } as never, { email: editor.email, role: 'editor' });

  await present(board.id, await as(owner), { action: 'start', frameId: 'f2' });
  expect(await session(board.id)).toMatchObject({ presenterId: owner.id, presenterName: 'Olga', frameId: 'f2' });

  await expect(present(board.id, await as(editor), { action: 'handoff', to: editor.id })).rejects.toMatchObject({ status: 403 });
  // Nobody is connected in this test: nobody is "on the board now" to take over.
  await expect(present(board.id, await as(owner), { action: 'handoff', to: editor.id })).rejects.toMatchObject({ status: 409 });
  expect((await session(board.id))?.presenterId).toBe(owner.id);

  await present(board.id, await as(owner), { action: 'end' });
  expect(await session(board.id)).toBeUndefined();
});

it('someone else can’t take over a presentation while its presenter is on the board, unless they facilitate or own it', () => {
  const current: PresentationSession = { presenterId: 'u-ann', presenterName: 'Ann', at: 1, frameId: null };
  const here = new Map([['u-ann', 'Ann'], ['u-bob', 'Bob']]);
  const bob = { id: 'u-bob', name: 'Bob', role: 'editor' as const, facilitates: false };
  expect(controlRefusal(current, bob, here)).toBe('Ann is presenting');
  expect(controlRefusal(current, { ...bob, facilitates: true }, here)).toBeNull();
  expect(controlRefusal(current, { ...bob, role: 'owner' }, here)).toBeNull();
  // A presenter who left no longer holds the presentation.
  expect(controlRefusal(current, bob, new Map([['u-bob', 'Bob']]))).toBeNull();
});
