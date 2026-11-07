// Export archives (personal data, legal cases; #186) live in the private storage area: with S3,
// under `private/`, which S3_PUBLIC_URL never covers. Archives written to the public area before
// keep opening until they expire, and are deleted from there.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { deletePrivateFile, newPrivateFileKey, openPrivateFile, savePrivateFile } from './index';

// A bucket double: PUT stores the body at its path, GET returns it (404 NoSuchKey otherwise), DELETE removes it.
const objects = new Map<string, Buffer>();
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (req.method === 'PUT') {
      objects.set(path, Buffer.concat(chunks));
      res.setHeader('ETag', '"x"');
    } else if (req.method === 'DELETE') {
      objects.delete(path);
      res.statusCode = 204;
    } else if (req.method === 'GET' && objects.has(path)) {
      res.setHeader('Content-Type', 'application/zip');
      return res.end(objects.get(path));
    } else {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/xml');
      return res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>none</Message></Error>');
    }
    res.end();
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  initStorage(
    await openTestDb({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_BUCKET: 'freero',
      S3_ACCESS_KEY_ID: 'any',
      S3_SECRET_ACCESS_KEY: 'any',
      S3_PUBLIC_URL: 'https://cdn.example.test',
    }),
  );
});
afterAll(async () => {
  await closeTestDb();
  server.close();
});

async function read(key: string): Promise<string | null> {
  const file = await openPrivateFile(key);
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const c of file.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString();
}

it('an export archive is never stored where the public URL serves files, and one stored there before still opens and is deleted', async () => {
  const key = newPrivateFileKey();
  await savePrivateFile(key, Buffer.from('archive'));
  expect([...objects.keys()]).toEqual([`/freero/private/${key}`]);
  expect(await read(key)).toBe('archive');

  const before = newPrivateFileKey();
  objects.set(`/freero/uploads/${before}`, Buffer.from('older archive')); // written by an earlier release
  expect(await read(before)).toBe('older archive');

  await deletePrivateFile(key);
  await deletePrivateFile(before);
  expect(objects.size).toBe(0);
});
