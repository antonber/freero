import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { CommentMessageRecord } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getUser, restoreAccount, scheduleAccountDeletion } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { initBoardDoc, snapshotBoardDoc } from '../realtime/index';
import { DELETED_USER_NAME, purgeDueAccounts } from './purge';

// Boards a user opened are recorded by GET /boards/:id, which these tests don't go through.
const opened = vi.hoisted(() => new Map<string, string[]>());
vi.mock('../boards/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../boards/index')>()),
  boardIdsOpenedBy: async (userId: string) => opened.get(userId) ?? [],
}));

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const newUser = (label: string) =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@purge.test.freero.app`, password: 'password-123' });

const message = (id: string, authorId: string, authorName: string): CommentMessageRecord => ({
  kind: 'message',
  threadId: 't1',
  id,
  authorId,
  authorName,
  authorColor: '#1C7ED6',
  text: `hello from ${authorName}`,
  createdAt: 1,
});

async function comments(boardId: string): Promise<Record<string, CommentMessageRecord>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await snapshotBoardDoc(boardId))!);
  return doc.getMap<CommentMessageRecord>('comments').toJSON();
}

const afterGrace = () => Date.now() + getConfig().accountDeletionGraceMs + 60_000;

it('purging an account deletes its boards, keeps others’ boards and shows its comments as "Deleted user" — once, even when two purges race', async () => {
  const leaving = await newUser('Leaving');
  const staying = await newUser('Staying');
  const own = await createBoard(leaving.id, 'Mine', '');
  const theirs = await createBoard(staying.id, 'Theirs', '');
  const doc = new Y.Doc();
  const map = doc.getMap<CommentMessageRecord>('comments');
  map.set('m:t1:a', message('a', leaving.id, 'Leaving'));
  map.set('m:t1:b', message('b', staying.id, 'Staying'));
  await initBoardDoc(theirs.id, Y.encodeStateAsUpdate(doc));
  // They commented on a board they reached through its link (an "open", no membership row).
  opened.set(leaving.id, [theirs.id]);

  await scheduleAccountDeletion(null, leaving.id, 'password-123');
  const t = afterGrace();
  const runs = await Promise.all([purgeDueAccounts(t), purgeDueAccounts(t)]);
  expect(runs.filter((r) => r === null)).toHaveLength(1); // the other instance skipped
  expect(runs.find((r) => r !== null)).toBe(1);

  expect(await getUser(leaving.id)).toBeNull();
  expect((await getBoardAccess(own.id, staying.id)).exists).toBe(false);
  expect((await getBoardAccess(theirs.id, staying.id)).role).toBe('owner');
  const after = await comments(theirs.id);
  expect(after['m:t1:a']).toMatchObject({ authorName: DELETED_USER_NAME, text: 'hello from Leaving' });
  expect(after['m:t1:b'].authorName).toBe('Staying');

  expect(await purgeDueAccounts(t)).toBe(0);
});

it('an account restored during its grace period is never purged', async () => {
  const user = await newUser('Restored');
  const board = await createBoard(user.id, 'Keep me', '');
  await scheduleAccountDeletion(null, user.id, 'password-123');
  await restoreAccount(user.id);
  await purgeDueAccounts(afterGrace());
  expect(await getUser(user.id)).not.toBeNull();
  expect((await getBoardAccess(board.id, user.id)).role).toBe('owner');
});
