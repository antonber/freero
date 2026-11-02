// Files that are not board content: data-export archives (modules/privacy). Stored through the
// same object storage under "private-<random>.zip" keys, which are never served at /uploads/
// (FILE_NAME_RE accepts upload extensions only, never .zip), never adopted or swept by the uploads sweep (same
// pattern), and count toward no quota. Whoever stores one deletes it (exports expire).
import type { Readable } from 'node:stream';
import { newId } from '../../platform/ids';
import { storage } from '../../platform/storage';
import { contentMatches, FILE_NAME_RE } from './store';

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

// Private images (modules/problems: the screenshot attached to a problem report). The private
// storage area (S3: under `private/`, never behind S3_PUBLIC_URL), keys "confidential.<random>.<ext>"
// — a '.' before the extension, so never an upload name: never served at /uploads/, never adopted
// or swept, no quota. Only the bytes of a PNG, JPEG or WebP are kept. Whoever stores one deletes it.
const PRIVATE_AREA = { area: 'private' } as const;
const PRIVATE_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const PRIVATE_IMAGE_KEY_RE = /^confidential\.[A-Za-z0-9_-]{24,64}\.(png|jpg|webp)$/;
const TYPE_OF_PRIVATE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Stores an image in the private area; null when the bytes are not a PNG, JPEG or WebP. */
export async function savePrivateImage(data: Uint8Array): Promise<{ key: string; contentType: string } | null> {
  const contentType = Object.keys(PRIVATE_IMAGE_TYPES).find((t) => contentMatches(data, t));
  if (!contentType) return null;
  const key = `confidential.${newId(32)}.${PRIVATE_IMAGE_TYPES[contentType]}`;
  await storage().put(key, data, contentType, PRIVATE_AREA);
  return { key, contentType };
}

export async function openPrivateImage(key: string): Promise<{ body: Readable; size: number | null; contentType: string } | null> {
  const m = PRIVATE_IMAGE_KEY_RE.exec(key);
  if (!m) return null;
  const obj = await storage().get(key, PRIVATE_AREA);
  return obj ? { body: obj.body, size: obj.size, contentType: TYPE_OF_PRIVATE_EXT[m[1]] } : null;
}

export async function deletePrivateImage(key: string | null | undefined): Promise<void> {
  if (key && PRIVATE_IMAGE_KEY_RE.test(key)) await storage().delete(key, PRIVATE_AREA);
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
