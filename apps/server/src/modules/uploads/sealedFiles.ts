// Uploaded files under their workspace's key (#159; docs/design/compliance.md §3). A file uploaded
// to a board of a workspace with an encryption key is stored sealed with the workspace's data key
// (keys' envelope: AES-256-GCM), and every read through this module opens it — the uploads route,
// board and comment downloads, exports, backups, renders, moderation — while that key is usable.
//
// Stored object: HEADER | chunk 0 | chunk 1 | …
//   HEADER = MAGIC | u16 ref length | ref ('<workspaceId>:<version>') | u32 chunk size | u64 size
//   chunk  = nonce (12) | tag (16) | ciphertext (chunk size bytes; the last one shorter)
// Chunks are sealed one by one so a byte range (a video seeking) opens only the chunks it covers.
// Each chunk's additional data names the workspace, the file, its index and how many there are:
// a chunk moved, dropped, repeated or copied into another file never opens. The header names the
// data key itself, so a file being sealed again (rotation, a move) reads right whichever version
// a reader finds; the row's `sealed_with` says that it is sealed (and is what the jobs query).
//
// MAGIC is no image, document or media signature, so an object served without this module (a bucket
// URL, a release without it) is never shown as content.
import { Readable } from 'node:stream';
import { badRequest } from '../../platform/http';
import { readAll, storage, type ByteRange, type StorageArea } from '../../platform/storage';
import { KeyUnavailableError, keysInUse, openerFor, type BlobSealer } from '../keys/index';
import * as repo from './repo';
import type { UploadRow } from './repo';

const MAGIC = Buffer.from('\0FREERO-SEALED-FILE-1\0', 'latin1');
/** Plaintext bytes per chunk. */
export const CHUNK = 64 * 1024;
const OVERHEAD = 12 + 16;
/** Long enough for any header (a ref is a workspace id and a version). */
const HEADER_MAX = MAGIC.length + 2 + 512 + 4 + 8;

const aadOf = (workspaceId: string, name: string, index: number, count: number) => `freero.upload.v1\0${workspaceId}\0${name}\0${index}\0${count}`;
const workspaceOf = (ref: string) => ref.slice(0, ref.lastIndexOf(':'));

export const isSealedObject = (head: Uint8Array): boolean => Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, MAGIC.length)).equals(MAGIC);

/** The bytes to store for upload `name`, sealed with `sealer` (its workspace's current data key). */
export function sealFile(name: string, plain: Uint8Array, sealer: BlobSealer): Buffer {
  const ref = Buffer.from(sealer.ref, 'utf8');
  if (ref.length > 512) throw badRequest('Unreadable key reference');
  const head = Buffer.alloc(MAGIC.length + 2 + ref.length + 4 + 8);
  MAGIC.copy(head, 0);
  head.writeUInt16BE(ref.length, MAGIC.length);
  ref.copy(head, MAGIC.length + 2);
  head.writeUInt32BE(CHUNK, MAGIC.length + 2 + ref.length);
  head.writeBigUInt64BE(BigInt(plain.byteLength), MAGIC.length + 2 + ref.length + 4);
  const ws = workspaceOf(sealer.ref);
  const count = Math.ceil(plain.byteLength / CHUNK);
  const parts: Buffer[] = [head];
  for (let i = 0; i < count; i++) parts.push(sealer.seal(aadOf(ws, name, i, count), plain.subarray(i * CHUNK, Math.min(plain.byteLength, (i + 1) * CHUNK))));
  return Buffer.concat(parts);
}

interface Header {
  ref: string;
  chunk: number;
  size: number;
  length: number;
}

function parseHeader(b: Buffer, workspaceHint: string): Header {
  const fail = () => new KeyUnavailableError(workspaceHint, 'a stored file is damaged');
  if (b.length < MAGIC.length + 2 || !isSealedObject(b)) throw fail();
  const refLen = b.readUInt16BE(MAGIC.length);
  const length = MAGIC.length + 2 + refLen + 4 + 8;
  if (b.length < length) throw fail();
  const ref = b.subarray(MAGIC.length + 2, MAGIC.length + 2 + refLen).toString('utf8');
  const chunk = b.readUInt32BE(MAGIC.length + 2 + refLen);
  const size = Number(b.readBigUInt64BE(MAGIC.length + 2 + refLen + 4));
  if (!chunk || !Number.isSafeInteger(size)) throw fail();
  return { ref, chunk, size, length };
}

export interface OpenedFile {
  body: Readable;
  /** Bytes in `body` (the range's length with a range). */
  size: number | null;
}

/**
 * Opens a sealed object: the chunks covering `range` (plaintext bytes, inclusive) or all of it.
 * Throws KeyUnavailableError when its key can't be used or a chunk doesn't belong to this file.
 */
async function openSealedObject(name: string, key: string, area: StorageArea | undefined, head: Buffer, range: ByteRange | undefined, workspaceHint: string): Promise<OpenedFile | null> {
  const h = parseHeader(head, workspaceHint);
  const open = await openerFor(h.ref);
  const ws = workspaceOf(h.ref);
  const count = Math.ceil(h.size / h.chunk);
  if (h.size === 0) return { body: Readable.from([]), size: 0 };
  const start = range ? Math.min(range.start, h.size - 1) : 0;
  const end = range ? Math.min(range.end, h.size - 1) : h.size - 1;
  const first = Math.floor(start / h.chunk);
  const last = Math.floor(end / h.chunk);
  const stride = h.chunk + OVERHEAD;
  const lastPlain = Math.min(h.chunk, h.size - last * h.chunk);
  const obj = await storage().get(key, { ...(area ? { area } : {}), range: { start: h.length + first * stride, end: h.length + last * stride + OVERHEAD + lastPlain - 1 } });
  if (!obj) return null;
  async function* chunks(): AsyncGenerator<Buffer> {
    let pending = Buffer.alloc(0);
    let i = first;
    const take = function* (final: boolean): Generator<Buffer> {
      while (i <= last) {
        const want = OVERHEAD + (i === last ? lastPlain : h.chunk);
        if (pending.length < want) {
          if (final) throw new KeyUnavailableError(ws, 'a stored file is cut short');
          return;
        }
        let plain = open(aadOf(ws, name, i, count), pending.subarray(0, want));
        pending = pending.subarray(want);
        if (i === last) plain = plain.subarray(0, end - last * h.chunk + 1);
        if (i === first) plain = plain.subarray(start - first * h.chunk);
        i++;
        yield plain;
      }
    };
    for await (const c of obj!.body) {
      pending = pending.length ? Buffer.concat([pending, Buffer.from(c as Uint8Array)]) : Buffer.from(c as Uint8Array);
      yield* take(false);
    }
    yield* take(true);
  }
  // The first chunk is opened before anything is answered: a file that doesn't open (another
  // file's bytes, altered, a key gone) is refused with a status, not a broken response.
  const rest = chunks();
  let head1: IteratorResult<Buffer>;
  try {
    head1 = await rest.next();
  } catch (e) {
    obj.body.destroy();
    throw e;
  }
  async function* all(): AsyncGenerator<Buffer> {
    if (!head1.done) yield head1.value;
    yield* rest;
  }
  return { body: Readable.from(all()), size: end - start + 1 };
}

/**
 * An upload's bytes as uploaded, whether stored sealed or not: what every read of an upload goes
 * through. `storageKey` / `area`: where its bytes are (a removed file's kept copy). Null when there
 * are no bytes. Throws KeyUnavailableError for a sealed file whose key can't be used (or whose row
 * says sealed but whose bytes aren't: never served as they are).
 */
export async function openStoredUpload(
  name: string,
  row: Pick<UploadRow, 'sealedWith' | 'workspaceId'> | null,
  opts: { range?: ByteRange; storageKey?: string; area?: StorageArea } = {},
): Promise<OpenedFile | null> {
  const key = opts.storageKey ?? name;
  const area = opts.area;
  const sealedRow = row?.sealedWith ?? null;
  // Stored as uploaded and never anyone's to seal (no workspace, or no key anywhere): as is.
  if (!sealedRow && (!row?.workspaceId || !(await keysInUse()))) return storage().get(key, { ...(area ? { area } : {}), ...(opts.range ? { range: opts.range } : {}) });
  const peek = await storage().get(key, { ...(area ? { area } : {}), range: { start: 0, end: HEADER_MAX - 1 } });
  if (!peek) return null;
  const head = await readAll(peek);
  if (isSealedObject(head)) return openSealedObject(name, key, area, head, opts.range, workspaceOf(sealedRow ?? row?.workspaceId ?? 'unknown'));
  if (sealedRow) throw new KeyUnavailableError(workspaceOf(sealedRow), 'a stored file is not sealed as its row says');
  // Not sealed (yet): as is.
  return storage().get(key, { ...(area ? { area } : {}), ...(opts.range ? { range: opts.range } : {}) });
}

/** An upload's bytes as uploaded, by name (its row looked up): see openStoredUpload. */
export async function openUpload(name: string, opts: { range?: ByteRange } = {}): Promise<OpenedFile | null> {
  return openStoredUpload(name, await repo.getUploadRow(name), opts);
}

/** All of a stored object's bytes as uploaded (a sealed one opened). For sealing a file again. */
export async function readStoredPlain(name: string, row: Pick<UploadRow, 'sealedWith' | 'workspaceId'>): Promise<Buffer | null> {
  const peek = await storage().get(name, { range: { start: 0, end: HEADER_MAX - 1 } });
  if (!peek) return null;
  const head = await readAll(peek);
  if (!isSealedObject(head)) {
    const obj = await storage().get(name);
    return obj ? readAll(obj) : null;
  }
  const opened = await openSealedObject(name, name, undefined, head, undefined, workspaceOf(row.sealedWith ?? row.workspaceId ?? 'unknown'));
  return opened ? readAll({ body: opened.body, contentType: null, size: opened.size }) : null;
}
