// Files that are not board content: data-export archives (modules/privacy). Stored through the
// same object storage under "private-<random>.zip" keys, which are never served at /uploads/
// (FILE_NAME_RE accepts images and PDFs only), never adopted or swept by the uploads sweep (same
// pattern), and count toward no quota. Whoever stores one deletes it (exports expire).
import type { Readable } from 'node:stream';
import { newId } from '../../platform/ids';
import { storage } from '../../platform/storage';
import { FILE_NAME_RE } from './store';

const PRIVATE_KEY_RE = /^private-[A-Za-z0-9_-]{16,64}\.zip$/;

/** Stores an archive; returns its key. */
export async function savePrivateFile(data: Uint8Array): Promise<string> {
  const key = `private-${newId(32)}.zip`;
  await storage().put(key, data, 'application/zip');
  return key;
}

export async function openPrivateFile(key: string): Promise<{ body: Readable; size: number | null } | null> {
  if (!PRIVATE_KEY_RE.test(key)) return null;
  const obj = await storage().get(key);
  return obj ? { body: obj.body, size: obj.size } : null;
}

export async function deletePrivateFile(key: string): Promise<void> {
  if (PRIVATE_KEY_RE.test(key)) await storage().delete(key);
}

/** The bytes of an upload ("/uploads/<name>" or "<name>"), or null when it is gone. */
export async function readUpload(urlOrName: string): Promise<Buffer | null> {
  const name = urlOrName.startsWith('/uploads/') ? urlOrName.slice('/uploads/'.length) : urlOrName;
  if (!FILE_NAME_RE.test(name)) return null;
  const obj = await storage().get(name);
  if (!obj) return null;
  const chunks: Buffer[] = [];
  for await (const c of obj.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
