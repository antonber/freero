import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { saveUpload, uploadBytesUsed } from './store';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-uploads-'));
  // 1 MB quota per account.
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir, UPLOAD_QUOTA_MB: '1' }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const pdf = (bytes: number) => {
  const b = Buffer.alloc(bytes, 0x20);
  b.write('%PDF-1.7\n');
  return b;
};

it('PDF documents are stored like images and count toward the same per-account quota', async () => {
  const user = await createUser({ name: 'Pdf', email: 'pdf@test.freero.app', password: 'password-123' });
  const url = await saveUpload(pdf(600 * 1024), 'application/pdf', user.id);
  expect(url).toMatch(/^\/uploads\/[A-Za-z0-9_-]+\.pdf$/);
  expect(await uploadBytesUsed(user.id)).toBe(600 * 1024);
  // A second one would pass the 1 MB quota: refused, and nothing more is counted.
  await expect(saveUpload(pdf(600 * 1024), 'application/pdf', user.id)).rejects.toMatchObject({ status: 413 });
  expect(await uploadBytesUsed(user.id)).toBe(600 * 1024);
});

it('a file labelled as a PDF that is not one is refused (no HTML or script smuggled in as a document)', async () => {
  const user = await createUser({ name: 'Fake', email: 'fake@test.freero.app', password: 'password-123' });
  await expect(saveUpload(Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf', user.id)).rejects.toMatchObject({ status: 400 });
});
