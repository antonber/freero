import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage, readAll, storage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { saveUpload, uploadBytesUsed } from './store';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-media-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir, MAX_UPLOAD_MB: '1', MAX_MEDIA_UPLOAD_MB: '3', MAX_ATTACHMENT_UPLOAD_MB: '2' }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const user = () => createUser({ name: 'Media', email: `media${++n}@test.freero.app`, password: 'password-123' });
const nameOf = (url: string) => url.slice('/uploads/'.length);

/** An ISO media file of `bytes` bytes whose ftyp box names `brand` (isom: video, M4A: audio). */
const isoMedia = (brand: string, bytes = 64) => {
  const b = Buffer.alloc(bytes);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(brand, 8, 'latin1');
  return b;
};
const HTML = Buffer.from('<!doctype html><html><body><script>fetch("/api/auth/me")</script></body></html>');

it('what plays inline is decided by the bytes: a page labelled as a video is refused, and an audio file labelled as video is served as audio', async () => {
  const u = await user();
  await expect(saveUpload(HTML, 'video/mp4', u.id)).rejects.toMatchObject({ status: 415 });
  await expect(saveUpload(HTML, 'audio/mpeg', u.id)).rejects.toMatchObject({ status: 415 });
  expect(await saveUpload(isoMedia('M4A '), 'video/mp4', u.id)).toMatch(/\.m4a$/);
  expect(await saveUpload(isoMedia('isom'), 'audio/x-whatever', u.id)).toMatch(/\.mp4$/);
});

it('any file can be attached, but only ever as opaque bytes: an HTML page stays a .bin that nothing serves as a page', async () => {
  const u = await user();
  const url = await saveUpload(HTML, 'text/html', u.id, { attachment: true });
  expect(url).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.bin$/);
  // Stored byte for byte (the download is the file the person attached), counted toward their quota.
  const obj = await storage().get(nameOf(url));
  expect(obj && Buffer.compare(await readAll(obj), HTML)).toBe(0);
  expect(await uploadBytesUsed(u.id)).toBe(HTML.byteLength);
  // Without asking for an attachment, the same request is refused rather than stored.
  await expect(saveUpload(HTML, 'text/html', u.id)).rejects.toMatchObject({ status: 415 });
});

it('each kind has its own size cap: a raised video cap lets neither large images nor large attachments in', async () => {
  const u = await user();
  const MB = 1024 * 1024;
  expect(await saveUpload(isoMedia('isom', 2.5 * MB), 'video/mp4', u.id)).toMatch(/\.mp4$/);
  const png = Buffer.alloc(1.5 * MB);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await expect(saveUpload(png, 'image/png', u.id)).rejects.toMatchObject({ status: 413 });
  await expect(saveUpload(Buffer.alloc(2.5 * MB, 1), 'application/zip', u.id, { attachment: true })).rejects.toMatchObject({
    status: 413,
    message: expect.stringContaining('2MB for files'),
  });
  await expect(saveUpload(isoMedia('isom', 3.5 * MB), 'video/mp4', u.id)).rejects.toMatchObject({ status: 413 });
});
