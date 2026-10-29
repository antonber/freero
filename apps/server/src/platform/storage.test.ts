import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage, S3Storage } from './storage';

describe('local object storage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-storage-'));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('never reads, writes or deletes outside its directory, whatever the key', async () => {
    const s = new LocalStorage(path.join(dir, 'uploads'));
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
    for (const key of ['../secret.txt', '..', '.', 'a/b.png', 'a\\b.png', '']) {
      await expect(s.get(key)).rejects.toThrow(/invalid storage key/);
      await expect(s.put(key, new Uint8Array([1]), 'image/png')).rejects.toThrow(/invalid storage key/);
      await expect(s.delete(key)).rejects.toThrow(/invalid storage key/);
    }
    expect(fs.readFileSync(path.join(dir, 'secret.txt'), 'utf8')).toBe('secret');
  });
});

describe('S3 object storage', () => {
  it('asks the bucket to encrypt every object it writes when S3_SSE is set, public and private area alike (KAI-143)', async () => {
    const puts: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.method === 'PUT') puts.push({ url: req.url ?? '', headers: req.headers });
        res.setHeader('ETag', '"x"');
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const s = new S3Storage(
        {
          endpoint: `http://127.0.0.1:${port}`,
          bucket: 'freero',
          region: 'us-east-1',
          accessKeyId: 'any',
          secretAccessKey: 'any',
          publicUrl: null,
          forcePathStyle: true,
          sse: { mode: 'aws:kms', kmsKeyId: 'alias/freero' },
        },
        null,
      );
      await s.put('abcdefgh.png', new Uint8Array([1, 2, 3]), 'image/png');
      await s.put('private-abcdefghijklmnop.zip', new Uint8Array([4]), 'application/zip', { area: 'private' });
      expect(puts.map((p) => p.url.split('?')[0])).toEqual(['/freero/uploads/abcdefgh.png', '/freero/private/private-abcdefghijklmnop.zip']);
      for (const p of puts) {
        expect(p.headers['x-amz-server-side-encryption']).toBe('aws:kms');
        expect(p.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe('alias/freero');
      }
    } finally {
      server.close();
    }
  });
});
