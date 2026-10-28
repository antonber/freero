// Uploaded files: validated here, stored through the platform object storage (S3-compatible or
// local disk) under flat keys "<random id>.<ext>", and always addressed as "/uploads/<key>".
// User uploads are recorded per owner for the storage quota (UPLOAD_QUOTA_MB).
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';
import { storage } from '../../platform/storage';
import * as repo from './repo';

export const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]),
);

export const FILE_NAME_RE = /^[A-Za-z0-9_-]{6,64}\.(png|jpg|gif|webp|svg)$/;

export function maxUploadBytes(): number {
  return getConfig().maxUploadBytes;
}

/** Normalises a Content-Type header ("image/png; charset=x" -> "image/png"). */
export function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => data[offset + i] === b);
}

/** Checks the bytes look like the declared type (so a .png is really a PNG). */
export function contentMatches(data: Uint8Array, type: string): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(data, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8);
    case 'image/svg+xml':
      return /<svg[\s>]/i.test(Buffer.from(data.subarray(0, 4096)).toString('utf8'));
    default:
      return false;
  }
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;

/**
 * Validates and stores a file; returns its URL ("/uploads/<id>.<ext>"). With `ownerId` the file
 * counts towards that user's quota (413 when it would exceed it); without (board thumbnails,
 * which replace each other) it does not.
 */
export async function saveUpload(data: Uint8Array, contentType: string, ownerId?: string): Promise<string> {
  const type = mediaType(contentType);
  const ext = EXT_BY_TYPE[type];
  const max = maxUploadBytes();
  if (!ext) throw new HttpError(415, 'Unsupported file type. Use PNG, JPEG, GIF, WebP or SVG.');
  if (data.byteLength === 0) throw badRequest('Empty upload');
  if (data.byteLength > max) throw new HttpError(413, `File is too large (max ${mb(max)})`);
  if (!contentMatches(data, type)) throw badRequest(`File content is not a valid ${ext.toUpperCase()} image`);
  const name = `${newId(16)}.${ext}`;
  if (ownerId) {
    const quota = getConfig().uploadQuotaBytes;
    if (!(await repo.reserveUpload(name, ownerId, data.byteLength, type, quota, Date.now())))
      throw new HttpError(413, `Upload quota reached (${mb(quota)} per account). Delete unused images to free space.`);
  }
  try {
    await storage().put(name, data, type);
  } catch (e) {
    if (ownerId) await repo.deleteUploadRow(name).catch(() => {});
    throw e;
  }
  return `/uploads/${name}`;
}

/** Deletes a file previously returned by saveUpload. Unknown/foreign URLs are ignored. */
export async function deleteUpload(url: string | null | undefined): Promise<void> {
  const name = url?.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null;
  if (!name || !FILE_NAME_RE.test(name)) return;
  await storage().delete(name);
  await repo.deleteUploadRow(name);
}

/**
 * Deletes every file the user uploaded (account purge), including images placed on boards they
 * did not own: an erased account takes its uploads with it. Returns how many.
 */
export async function deleteUploadsOwnedBy(ownerId: string): Promise<number> {
  const names = await repo.namesOwnedBy(ownerId);
  for (const name of names) await deleteUpload(`/uploads/${name}`);
  return names.length;
}

/** Bytes of upload quota the user has used. */
export function uploadBytesUsed(ownerId: string): Promise<number> {
  return repo.bytesUsedBy(ownerId);
}
