// Object storage behind one interface: S3-compatible (S3_* set: AWS S3, MinIO, R2, GCS interop,
// Backblaze…) or the local disk (<data>/uploads) otherwise. Keys are flat names ("<id>.png").
//
// With S3 configured, reads fall back to the local disk for keys S3 does not have, so files
// uploaded before the switch keep working until they are copied over (docs/operations.md).
//
// Two areas: 'public' (default; with S3 under `uploads/`, which S3_PUBLIC_URL may expose) and
// 'private' (with S3 under `private/`, never covered by the public URL: kept copies of files an
// operator removed, KAI-179). On local disk both live in the same directory, which is never
// served as such.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Config, S3Config } from './config';
import { addReadinessCheck } from './health';

export interface StoredObject {
  body: Readable;
  contentType: string | null;
  size: number | null;
}

/** Bytes `start` to `end` of an object, both inclusive (an HTTP Range resolved against its size). */
export interface ByteRange {
  start: number;
  end: number;
}

export interface StoredKey {
  key: string;
  size: number;
}

export type StorageArea = 'public' | 'private';

export interface PutOptions {
  area?: StorageArea;
  /** Cache-Control stored with the object (S3: sent by the bucket and a CDN in front of it). */
  cacheControl?: string;
}

export interface ObjectStorage {
  readonly kind: 'local' | 's3';
  put(key: string, data: Uint8Array, contentType: string, opts?: PutOptions): Promise<void>;
  /**
   * The object, or null when there is no such key. With `range`, `body` holds just those bytes
   * (the caller resolved the range against `stat`); `size` is then the length of the range.
   */
  get(key: string, opts?: { area?: StorageArea; range?: ByteRange }): Promise<StoredObject | null>;
  /** The size of an object of the public area, or null when there is no such key. */
  stat(key: string): Promise<{ size: number } | null>;
  /** Deleting a missing key is not an error. */
  delete(key: string, opts?: { area?: StorageArea }): Promise<void>;
  /** A URL clients may fetch the object from directly, or null when the app must stream it. */
  publicUrl(key: string): string | null;
  /** Every stored key (in no particular order; with S3, also the local-disk fallback's). */
  list(): AsyncIterable<StoredKey>;
  ping(): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;
/** S3 prefix of the private area: outside `uploads/`, so a public-read policy on that never covers it. */
const PRIVATE_PREFIX = 'private/';
function checkKey(key: string): string {
  if (!KEY_RE.test(key) || key.startsWith('.')) throw new Error(`invalid storage key: ${key}`);
  return key;
}

export class LocalStorage implements ObjectStorage {
  readonly kind = 'local' as const;
  constructor(private dir: string) {}

  private file(key: string) {
    return path.join(this.dir, checkKey(key));
  }
  async put(key: string, data: Uint8Array, _contentType?: string, _opts?: PutOptions): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    // Write then rename: a reader never sees a half-written file.
    const tmp = `${this.file(key)}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, this.file(key));
  }
  async get(key: string, opts: { area?: StorageArea; range?: ByteRange } = {}): Promise<StoredObject | null> {
    const { range } = opts;
    // Open first, then stat and stream that handle: a file deleted meanwhile (the uploads sweep)
    // is either a clean "not found" or still read whole. Stat-then-open by name left a gap where
    // the 200 and its length went out and the stream then failed, cutting the connection.
    const file = this.file(key);
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, 'r');
    } catch {
      return null;
    }
    try {
      const stat = await handle.stat();
      if (stat.isFile()) {
        if (!range) return { body: handle.createReadStream(), contentType: null, size: stat.size };
        const end = Math.min(range.end, stat.size - 1);
        return { body: handle.createReadStream({ start: range.start, end }), contentType: null, size: Math.max(0, end - range.start + 1) };
      }
    } catch {
      /* treated as missing */
    }
    await handle.close().catch(() => {});
    return null;
  }
  async stat(key: string): Promise<{ size: number } | null> {
    const st = await fs.promises.stat(this.file(key)).catch(() => null);
    return st?.isFile() ? { size: st.size } : null;
  }
  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.file(key), { force: true });
  }
  publicUrl(): string | null {
    return null;
  }
  async *list(): AsyncIterable<StoredKey> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return; // nothing stored yet
    }
    for (const name of names) {
      if (!KEY_RE.test(name) || name.startsWith('.')) continue;
      const stat = await fs.promises.stat(path.join(this.dir, name)).catch(() => null);
      if (stat?.isFile()) yield { key: name, size: stat.size };
    }
  }
  async ping(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.access(this.dir, fs.constants.W_OK);
  }
}

export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;
  private client: S3Client;
  private prefix = 'uploads/';

  constructor(
    private s3: S3Config,
    private fallback: LocalStorage | null,
  ) {
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint ?? undefined,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
  }

  private objectKey(key: string, area: StorageArea = 'public'): string {
    return (area === 'private' ? PRIVATE_PREFIX : this.prefix) + checkKey(key);
  }

  async put(key: string, data: Uint8Array, contentType: string, opts: PutOptions = {}): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.s3.bucket,
        Key: this.objectKey(key, opts.area),
        Body: data,
        ContentType: contentType,
        CacheControl: opts.area === 'private' ? 'private, no-store' : (opts.cacheControl ?? 'public, max-age=3600'),
      }),
    );
  }

  private async getObject(objectKey: string, range?: ByteRange): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.s3.bucket, Key: objectKey, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
      );
      if (!out.Body) return null;
      return { body: out.Body as Readable, contentType: out.ContentType ?? null, size: out.ContentLength ?? null };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === 'NoSuchKey' || e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async get(key: string, opts: { area?: StorageArea; range?: ByteRange } = {}): Promise<StoredObject | null> {
    // A private object made before the private area existed lives under the public prefix.
    return (
      (await this.getObject(this.objectKey(key, opts.area), opts.range)) ??
      (opts.area === 'private' ? await this.getObject(this.objectKey(key)) : null) ??
      (this.fallback ? this.fallback.get(key, { range: opts.range }) : null)
    );
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.s3.bucket, Key: this.objectKey(key) }));
      return { size: out.ContentLength ?? 0 };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata.httpStatusCode === 404))
        return this.fallback ? this.fallback.stat(key) : null;
      throw e;
    }
  }

  async delete(key: string, opts: { area?: StorageArea } = {}): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s3.bucket, Key: this.objectKey(key, opts.area) }));
    if (opts.area === 'private') await this.client.send(new DeleteObjectCommand({ Bucket: this.s3.bucket, Key: this.objectKey(key) }));
    await this.fallback?.delete(key);
  }

  async *list(): AsyncIterable<StoredKey> {
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.s3.bucket, Prefix: this.prefix, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) {
        const key = o.Key?.slice(this.prefix.length);
        if (key && KEY_RE.test(key)) yield { key, size: o.Size ?? 0 };
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    if (this.fallback) yield* this.fallback.list();
  }

  publicUrl(key: string): string | null {
    return this.s3.publicUrl ? `${this.s3.publicUrl}/${this.prefix}${checkKey(key)}` : null;
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.s3.bucket }));
  }
}

let instance: ObjectStorage | null = null;

export function initStorage(config: Config): ObjectStorage {
  const local = new LocalStorage(config.uploadsDir);
  instance = config.s3 ? new S3Storage(config.s3, local) : local;
  const s = instance;
  addReadinessCheck('storage', () => s.ping());
  return s;
}

export function storage(): ObjectStorage {
  if (!instance) throw new Error('Storage not initialised: call initStorage() from main.ts first');
  return instance;
}

/** Collects a stored object into memory (small objects only, e.g. tests and copies). */
export async function readAll(obj: StoredObject): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of obj.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
