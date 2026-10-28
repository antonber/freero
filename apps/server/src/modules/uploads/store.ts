// Uploaded files: validated here, stored through the platform object storage (S3-compatible or
// local disk) under flat keys "<random id>.<ext>", and always addressed as "/uploads/<key>".
// User uploads are recorded per owner for the storage quota (UPLOAD_QUOTA_MB); every kind counts.
//
// What may be served inline is an ALLOWLIST decided by the bytes, never by a file name or the type
// a client declares: raster images, SVG (sandboxed), PDF documents, and video / audio containers
// whose signature we recognise (stored under the type and extension the bytes say). Anything else
// someone attaches to a board is an opaque ATTACHMENT ("<id>.bin", application/octet-stream): never
// served at /uploads/ at all, only downloaded from its board (routes.ts: attachment disposition,
// nosniff, the workspace's downloads policy, the audit log), so an HTML, SVG or script file can
// never run as same-origin content.
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';
import { storage } from '../../platform/storage';
import * as repo from './repo';

/** Inline images and documents: the declared type must be one of these, and the bytes must be it. */
const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/** Played on the board (<video> / <audio>): the type is the one the bytes were sniffed as. */
const MEDIA_EXT_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

/** The extension of attachments: never served at /uploads/, only downloaded from a board. */
export const ATTACHMENT_EXT = 'bin';
const ATTACHMENT_TYPE = 'application/octet-stream';

export const EXT_BY_TYPE: Record<string, string> = { ...IMAGE_EXT_BY_TYPE, ...MEDIA_EXT_BY_TYPE, [ATTACHMENT_TYPE]: ATTACHMENT_EXT };

export const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]),
);

/** Extensions of video and audio uploads (served with byte ranges, for seeking). */
export const MEDIA_EXTS: ReadonlySet<string> = new Set(Object.values(MEDIA_EXT_BY_TYPE));

const EXTS = Object.values(EXT_BY_TYPE).join('|');

export const FILE_NAME_RE = new RegExp(`^[A-Za-z0-9_-]{6,64}\\.(${EXTS})$`);

/**
 * How stored content refers to an upload: "/uploads/<name>" anywhere in a string (a relative or
 * absolute URL, inside JSON or a Yjs update). Group 1 is the storage name. Valid both as a
 * JavaScript and as a Postgres regular expression, so modules can search their tables in SQL.
 */
export const UPLOAD_REF_PATTERN = `/uploads/([A-Za-z0-9_-]{6,64}\\.(?:${EXTS}))`;

/** The upload names referenced in `text` (restricted to `among` when given). */
export function uploadNamesIn(text: string, among?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(UPLOAD_REF_PATTERN, 'g'))) if (!among || among.has(m[1])) out.add(m[1]);
  return out;
}

/** Normalises a Content-Type header ("image/png; charset=x" -> "image/png"). */
export function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * What an upload request is: an image or PDF (its declared type is in the allowlist), video or
 * audio (declared video/* or audio/*: the bytes decide which container), or an attachment (asked
 * for explicitly; the declared type is ignored). Null: a type we don't take.
 */
export type UploadKind = 'image' | 'media' | 'attachment';

export function uploadKindOf(contentType: string | undefined, attachment: boolean): UploadKind | null {
  if (attachment) return 'attachment';
  const type = mediaType(contentType);
  if (type.startsWith('video/') || type.startsWith('audio/')) return 'media';
  return IMAGE_EXT_BY_TYPE[type] ? 'image' : null;
}

/** The size cap of one upload of this kind (MAX_UPLOAD_MB, MAX_MEDIA_UPLOAD_MB, MAX_ATTACHMENT_UPLOAD_MB). */
export function uploadLimitFor(kind: UploadKind): number {
  const c = getConfig();
  return kind === 'media' ? c.maxMediaUploadBytes : kind === 'attachment' ? c.maxAttachmentUploadBytes : c.maxUploadBytes;
}

/** The largest upload of any kind (what the request body parser may ever read). */
export function maxUploadBytes(): number {
  return Math.max(uploadLimitFor('image'), uploadLimitFor('media'), uploadLimitFor('attachment'));
}

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => data[offset + i] === b);
}

const ascii = (data: Uint8Array, from: number, to: number) => Buffer.from(data.subarray(from, to)).toString('latin1');

/**
 * The video / audio type of these bytes by their container signature, or null when they are not a
 * format we play. Never looks at a name or a declared type.
 */
export function sniffMedia(data: Uint8Array): string | null {
  if (data.length < 12) return null;
  const box = ascii(data, 4, 8);
  // ISO base media (MP4, M4A, MOV): an "ftyp" box first; its major brand tells audio-only and QuickTime apart.
  if (box === 'ftyp') {
    const brand = ascii(data, 8, 12);
    if (/^(M4A |M4B |M4P |F4A )$/.test(brand)) return 'audio/mp4';
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  // Older QuickTime files start straight with a movie or data atom.
  if (box === 'moov' || box === 'mdat' || box === 'wide' || box === 'pnot') return 'video/quicktime';
  // Matroska's EBML header naming the "webm" doc type (other Matroska files don't play everywhere).
  if (startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(data, 4, 64).includes('webm') ? 'video/webm' : null;
  const magic = ascii(data, 0, 4);
  if (magic === 'OggS') return 'audio/ogg';
  if (magic === 'RIFF' && ascii(data, 8, 12) === 'WAVE') return 'audio/wav';
  if (magic === 'fLaC') return 'audio/flac';
  if (magic.startsWith('ID3')) return 'audio/mpeg';
  if (data[0] === 0xff) {
    // A frame sync: AAC in ADTS has layer bits 00, MPEG audio (MP3) never does.
    if ((data[1] & 0xf6) === 0xf0) return 'audio/aac';
    if ((data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0) return 'audio/mpeg';
  }
  return null;
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
    case 'application/pdf':
      // "%PDF-" within the first KB (the spec tolerates a little leading junk).
      return Buffer.from(data.subarray(0, 1024)).includes('%PDF-');
    default:
      return false;
  }
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;
const LIMIT_WHAT: Record<UploadKind, string> = { image: '', media: ' for video and audio', attachment: ' for files' };

/** The 413 for an upload of `kind` over its size cap. */
export function tooLarge(kind: UploadKind): HttpError {
  return new HttpError(413, `File is too large (max ${mb(uploadLimitFor(kind))}${LIMIT_WHAT[kind]})`);
}

/**
 * Validates and stores a file; returns its URL ("/uploads/<id>.<ext>"). With `ownerId` the file
 * counts towards that user's quota (413 when it would exceed it); without (board thumbnails,
 * which replace each other) it does not. `attachment`: any bytes, stored as a file that is only
 * ever downloaded (see the header); otherwise the declared type must be one we serve and the bytes
 * must be it.
 */
export async function saveUpload(data: Uint8Array, contentType: string, ownerId?: string, opts: { attachment?: boolean } = {}): Promise<string> {
  const kind = uploadKindOf(contentType, !!opts.attachment);
  if (!kind) throw new HttpError(415, 'Unsupported file type. Use PNG, JPEG, GIF, WebP, SVG, PDF, a video or an audio file.');
  if (data.byteLength === 0) throw badRequest('Empty upload');
  if (data.byteLength > uploadLimitFor(kind)) throw tooLarge(kind);
  let type: string;
  if (kind === 'attachment') type = ATTACHMENT_TYPE;
  else if (kind === 'media') {
    const sniffed = sniffMedia(data);
    if (!sniffed) throw new HttpError(415, 'This isn’t a video or audio format Freero can play (MP4, WebM, MOV, MP3, M4A, WAV, Ogg, FLAC or AAC).');
    type = sniffed;
  } else {
    type = mediaType(contentType);
    if (!contentMatches(data, type))
      throw badRequest(`File content is not a valid ${IMAGE_EXT_BY_TYPE[type].toUpperCase()} ${type === 'application/pdf' ? 'document' : 'image'}`);
  }
  const name = `${newId(16)}.${EXT_BY_TYPE[type]}`;
  if (ownerId) {
    const quota = getConfig().uploadQuotaBytes;
    if (!(await repo.reserveUpload(name, ownerId, data.byteLength, type, quota, Date.now())))
      throw new HttpError(413, `Upload quota reached (${mb(quota)} per account). Delete unused files from your boards to free space.`);
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

/** Bytes of upload quota the user has used. */
export function uploadBytesUsed(ownerId: string): Promise<number> {
  return repo.bytesUsedBy(ownerId);
}
