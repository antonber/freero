// Walkthroughs (KAI-133) against the real stack in-process: uploads, boards, members, the live
// board doc (server-written summaries) and notifications (in-memory Postgres).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mentionToken, WALKTHROUGHS_COLLECTION, type Account, type WalkthroughSummary, type WalkthroughTimeline } from '@freero/shared';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { notificationsExportOf } from '../notifications/index';
import { readBoardView } from '../realtime/index';
import { saveUpload } from '../uploads/index';
import { addComment, createWalkthrough, recordView, walkthroughUploadReferences } from './index';
import { deleteWalkthrough } from './service';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-walkthroughs-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@walkthroughs.test.freero.app`, password: 'password-123' }, { emailVerified: true });

/** A WebM recording as MediaRecorder writes it (EBML header naming the webm doc type). */
const webm = () => {
  const b = Buffer.alloc(4096, 1);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(b, 0);
  b.write('B\x82\x84webm', 8, 'latin1');
  return b;
};
const timeline: WalkthroughTimeline = { v: 1, view: [[0, 0, 0, 1600, 900], [1500, 400, 200, 800, 450]], pointer: [[100, 50, 60], [900], [1200, 500, 300]] };
const record = (userId: string, boardId: string, mediaUrl: string) =>
  createWalkthrough(boardId, userId, { title: 'Sprint review', mediaUrl, media: 'audio', durationMs: 2000, timeline });

it('a walkthrough takes only its recorder’s own video or audio upload — never someone else’s recording, nor an image', async () => {
  const [owner, editor] = await Promise.all([user('Rec'), user('Other')]);
  const b = await createBoard(owner.id, 'Review', '', 'none');
  await inviteBoardMember(null, b.id, owner, { email: editor.email, role: 'editor' });
  const mine = await saveUpload(webm(), 'video/webm', owner.id);
  const png = await saveUpload(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex'), 'image/png', owner.id);

  await expect(record(editor.id, b.id, mine)).rejects.toMatchObject({ status: 400 });
  await expect(record(owner.id, b.id, png)).rejects.toMatchObject({ status: 400 });
  const w = await record(owner.id, b.id, mine);
  expect(w).toMatchObject({ mediaUrl: mine, durationMs: 2000, timeline });
});

it('the uploads sweep keeps a recording while its walkthrough exists, and lets it go once the walkthrough is deleted', async () => {
  const owner = await user('Sweeper');
  const b = await createBoard(owner.id, 'Kept', '', 'none');
  const url = await saveUpload(webm(), 'video/webm', owner.id);
  const name = url.slice('/uploads/'.length);
  const w = await record(owner.id, b.id, url);
  expect(await walkthroughUploadReferences([name])).toEqual([name]);
  await deleteWalkthrough(b.id, w.id, owner.id);
  expect(await walkthroughUploadReferences([name])).toEqual([]);
});

it('watching counts each person once, and every open copy of the board sees the count; the author watching their own doesn’t count', async () => {
  const [owner, viewer] = await Promise.all([user('Teller'), user('Watcher')]);
  const b = await createBoard(owner.id, 'Watched', '', 'none');
  await inviteBoardMember(null, b.id, owner, { email: viewer.email, role: 'viewer' });
  const w = await record(owner.id, b.id, await saveUpload(webm(), 'video/webm', owner.id));
  await recordView(b.id, w.id, owner.id);
  await recordView(b.id, w.id, viewer.id);
  expect(await recordView(b.id, w.id, viewer.id)).toBe(1);
  const onBoard = (await readBoardView(b.id, { userId: viewer.id, role: 'viewer' })).collection(WALKTHROUGHS_COLLECTION).get(w.id) as WalkthroughSummary;
  expect(onBoard).toMatchObject({ title: 'Sprint review', views: 1, durationMs: 2000 });
});

it('a comment’s @mention notifies a member at that moment, never someone who can’t open the board; the author hears about the comment', async () => {
  const [owner, commenter, mate, stranger] = await Promise.all([user('Author'), user('Critic'), user('Mate'), user('Outsider')]);
  const b = await createBoard(owner.id, 'Design review', '', 'none');
  await inviteBoardMember(null, b.id, owner, { email: commenter.email, role: 'commenter' });
  await inviteBoardMember(null, b.id, owner, { email: mate.email, role: 'viewer' });
  const w = await record(owner.id, b.id, await saveUpload(webm(), 'video/webm', owner.id));

  await addComment(b.id, w.id, commenter.id, { atMs: 1500, text: `${mentionToken(mate.id)} ${mentionToken(stranger.id)} look at this` });
  const types = async (u: Account) => (await notificationsExportOf(u.id)).notifications.map((x) => (x as { type: string; data: { atMs?: number } }));
  expect(await types(mate)).toMatchObject([{ type: 'walkthrough.mention', data: { atMs: 1500, walkthroughId: w.id } }]);
  expect(await types(stranger)).toEqual([]);
  expect((await types(owner)).map((x) => x.type)).toEqual(['walkthrough.comment']);
  // A viewer may watch but not comment.
  await expect(addComment(b.id, w.id, mate.id, { atMs: 0, text: 'me too' })).rejects.toMatchObject({ status: 403 });
});
