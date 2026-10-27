import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage } from './storage';

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
