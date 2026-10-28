import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { initBoardDoc } from '../realtime/index';
import { saveUpload, uploadBytesUsed } from './store';
import { sweepUploadsLocked, UPLOAD_GRACE_MS } from './sweep';

const HOUR = 3_600_000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-sweep-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });
const nameOf = (url: string) => url.slice('/uploads/'.length);
// Local storage keeps files under <data>/uploads.
const stored = async (url: string) => fs.existsSync(path.join(dir, 'uploads', nameOf(url)));

/** A board document as the web engine writes it: elements are plain values in the 'elements' map. */
function docState(elements: Array<Record<string, unknown>>): Uint8Array {
  const doc = new Y.Doc();
  const map = doc.getMap('elements');
  for (const el of elements) map.set(el.id as string, el);
  return Y.encodeStateAsUpdate(doc);
}

it('an image removed from its board stays for the grace period after its last reference (undo still works), then is deleted and frees quota', async () => {
  const owner = await user('Painter');
  const url = await saveUpload(PNG, 'image/png', owner.id);
  const board = await createBoard(owner.id, 'Moodboard', '');
  await initBoardDoc(board.id, docState([{ id: 'i1', type: 'image', x: 0, y: 0, w: 10, h: 10, src: url }]));

  // Long after the upload, the image is still on the board: kept, and seen referenced now.
  const t0 = Date.now() + 10 * UPLOAD_GRACE_MS;
  expect(await sweepUploadsLocked(t0)).toBe(0);
  expect(await stored(url)).toBe(true);

  // Someone deletes it from the board. An hour later it must still be there for undo.
  await initBoardDoc(board.id, docState([{ id: 's1', type: 'sticky', x: 0, y: 0, w: 10, h: 10, text: 'hi' }]));
  expect(await sweepUploadsLocked(t0 + HOUR)).toBe(0);
  expect(await stored(url)).toBe(true);

  // A grace period after the last round that saw it referenced, it goes, and its bytes are freed.
  expect(await sweepUploadsLocked(t0 + UPLOAD_GRACE_MS + HOUR)).toBe(1);
  expect(await stored(url)).toBe(false);
  expect(await uploadBytesUsed(owner.id)).toBe(0);
});

it('a fresh upload not placed on any board yet (still on its way) is not swept', async () => {
  const owner = await user('Uploader');
  const url = await saveUpload(PNG, 'image/png', owner.id);
  await sweepUploadsLocked(Date.now() + HOUR);
  expect(await stored(url)).toBe(true);
});

it('an upload referenced while a round runs (after its mark, before the delete) is kept', async () => {
  const owner = await user('Paster');
  const url = await saveUpload(PNG, 'image/png', owner.id);
  let scans = 0;
  // The mark sees nothing; by the re-check someone has pasted the image onto a board.
  const references = async () => new Set(scans++ === 0 ? [] : [nameOf(url)]);
  await sweepUploadsLocked(Date.now() + 10 * UPLOAD_GRACE_MS, references);
  expect(await stored(url)).toBe(true);
  expect(await uploadBytesUsed(owner.id)).toBe(PNG.byteLength);
});

it('a stored file with no row (its row went with a deleted account, or it predates quotas) is swept a grace period after it is first seen unreferenced', async () => {
  const url = await saveUpload(PNG, 'image/png'); // no owner: no row, like a thumbnail
  const t0 = Date.now() + 10 * UPLOAD_GRACE_MS; // an old file
  await sweepUploadsLocked(t0);
  expect(await stored(url)).toBe(true); // first seen now, so it gets the whole grace period
  await sweepUploadsLocked(t0 + UPLOAD_GRACE_MS + HOUR);
  expect(await stored(url)).toBe(false);
});
