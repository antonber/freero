// Uploaded files live on disk under <dataDir>/uploads as <random id>.<ext>.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

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

export function uploadsDir(): string {
  return getConfig().uploadsDir;
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

/** Validates and writes a file; returns its public URL ("/uploads/<id>.<ext>"). */
export function saveUpload(data: Uint8Array, contentType: string): string {
  const type = mediaType(contentType);
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new HttpError(415, 'Unsupported file type. Use PNG, JPEG, GIF, WebP or SVG.');
  if (data.byteLength === 0) throw badRequest('Empty upload');
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (max 15MB)');
  if (!contentMatches(data, type)) throw badRequest(`File content is not a valid ${ext.toUpperCase()} image`);
  const name = `${newId(16)}.${ext}`;
  fs.mkdirSync(uploadsDir(), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir(), name), data);
  return `/uploads/${name}`;
}

/** Deletes a file previously returned by saveUpload. Unknown/foreign URLs are ignored. */
export function deleteUpload(url: string | null | undefined): void {
  const name = url?.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null;
  if (!name || !FILE_NAME_RE.test(name)) return;
  fs.rmSync(path.join(uploadsDir(), name), { force: true });
}
