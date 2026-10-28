import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage, readAll, storage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { isUploadRemoved, purgeRemovedUpload, removeUpload, restoreUpload } from './moderation';
import { saveUpload, uploadBytesUsed } from './store';
import { sweepUploadsLocked, UPLOAD_GRACE_MS } from './sweep';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-takedown-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });
const nameOf = (url: string) => url.slice('/uploads/'.length);
const served = async (name: string) => (await isUploadRemoved(name)) === false && (await storage().get(name)) !== null;

it('a removed upload stays gone through sweep rounds long after nothing references it (no deletion of the tombstone, no re-adoption), and restore brings back the same bytes', async () => {
  const owner = await user('Uploader');
  const name = nameOf(await saveUpload(PNG, 'image/png', owner.id));
  expect(await removeUpload(name)).toBe(true);
  expect(await served(name)).toBe(false);
  expect(await uploadBytesUsed(owner.id)).toBe(0); // removed files don't count toward the quota

  // Nothing references it; rounds far past the grace period must neither delete the tombstone
  // (the URL would turn from 410 into 404) nor adopt the kept copy as a fresh upload.
  const later = Date.now() + 5 * UPLOAD_GRACE_MS;
  await sweepUploadsLocked(later);
  await sweepUploadsLocked(later + 2 * UPLOAD_GRACE_MS);
  expect(await isUploadRemoved(name)).toBe(true);
  expect(await served(name)).toBe(false);

  expect(await restoreUpload(name)).toBe(true);
  const back = await storage().get(name);
  expect(back && Buffer.compare(await readAll(back), PNG)).toBe(0);
  expect(await isUploadRemoved(name)).toBe(false);
});

it('after the kept copy is purged the file can never be restored, and its URL stays removed', async () => {
  const owner = await user('Purged');
  const name = nameOf(await saveUpload(PNG, 'image/png', owner.id));
  await removeUpload(name);
  expect(await purgeRemovedUpload(name)).toBe(true);
  expect(await restoreUpload(name)).toBe(false);
  expect(await isUploadRemoved(name)).toBe(true);
  // Nothing of it is left in storage, under any key.
  expect(fs.readdirSync(path.join(dir, 'uploads')).filter((f) => f.includes(name))).toEqual([]);
});
