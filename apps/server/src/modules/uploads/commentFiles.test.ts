// Files on comments (#143) against real stored boards, real uploads and real access rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { initBoardDoc } from '../realtime/index';
import { openCommentFile } from './commentFiles';
import { saveUpload } from './store';

let dir = '';
let n = 0;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 7)]);
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@comment-files.test.freero.app`, password: 'password-123' }, { emailVerified: true });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-comment-files-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A board whose one comment, by `authorId`, carries `src`. */
async function boardWithAttachment(ownerId: string, authorId: string, src: string) {
  const board = await createBoard(ownerId, 'Plans', '');
  const doc = new Y.Doc();
  doc.transact(() => {
    const c = doc.getMap('comments');
    c.set('t:th1', { kind: 'thread', id: 'th1', x: 0, y: 0, createdBy: authorId, createdAt: 1 });
    c.set('m:th1:m1', { kind: 'message', id: 'm1', threadId: 'th1', authorId, authorName: 'A', text: 'See attached', attachments: [{ src, name: 'plan.png', size: PNG.length, image: true }], createdAt: 2 });
  });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  return board.id;
}

const read = async (f: { body: NodeJS.ReadableStream }) => {
  const parts: Buffer[] = [];
  for await (const c of f.body) parts.push(Buffer.from(c as Buffer));
  return Buffer.concat(parts);
};
const ref = { threadId: 'th1', messageId: 'm1', index: 0 };

it('a comment’s file can’t be fetched by someone who can’t open its board, inline or as a download', async () => {
  const [owner, viewer, outsider] = await Promise.all([user('Owner'), user('Viewer'), user('Outsider')]);
  const src = await saveUpload(PNG, 'image/png', owner.id, { attachment: true });
  const boardId = await boardWithAttachment(owner.id, owner.id, src);
  await inviteBoardMember(null, boardId, owner, { email: viewer.email, role: 'viewer' });

  await expect(openCommentFile(boardId, ref, outsider.id, { inline: true })).rejects.toMatchObject({ status: 403 });
  await expect(openCommentFile(boardId, ref, outsider.id)).rejects.toMatchObject({ status: 403 });

  const shown = await openCommentFile(boardId, ref, viewer.id, { inline: true });
  expect(shown.contentType).toBe('image/png');
  expect((await read(shown)).equals(PNG)).toBe(true);
});

it('a comment can’t carry someone else’s upload out of the board it belongs to', async () => {
  const [victim, thief] = await Promise.all([user('Victim'), user('Thief')]);
  // The victim's file, attached somewhere the thief can't see; the thief writes its name into a
  // comment on their own board.
  const src = await saveUpload(PNG, 'image/png', victim.id, { attachment: true });
  const boardId = await boardWithAttachment(thief.id, thief.id, src);
  await expect(openCommentFile(boardId, ref, thief.id)).rejects.toMatchObject({ status: 404 });
  await expect(openCommentFile(boardId, ref, thief.id, { inline: true })).rejects.toMatchObject({ status: 404 });
});
