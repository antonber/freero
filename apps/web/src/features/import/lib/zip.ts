// Reading ZIP packages (Office Open XML: .vsdx) from untrusted bytes. Written from the ZIP
// format (end-of-central-directory → central directory → local headers); entries are unpacked one
// at a time, on demand, through the browser's own `DecompressionStream`, counting real output
// bytes — never trusting the sizes the file declares — so a zip bomb is stopped at the cap, not
// after it has filled memory. Encrypted entries, ZIP64 and compression other than store / deflate
// are refused.
import { ImportError } from './common';

export interface ZipLimits {
  /** Entries the directory may list. */
  maxEntries: number;
  /** Bytes one entry may unpack to. */
  maxEntryBytes: number;
  /** Bytes all entries read from this file may unpack to together. */
  maxTotalBytes: number;
  /** Absolute time (Date.now()) after which reading stops. */
  deadline: number;
}

interface Entry {
  method: number;
  compressed: number;
  offset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

const damaged = () => new ImportError('This file is damaged (it isn’t a readable ZIP package).');

export class ZipPackage {
  private readonly entries = new Map<string, Entry>();
  private unpacked = 0;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: ZipLimits,
  ) {}

  /** Reads the directory (nothing is unpacked yet); throws ImportError for anything that isn't a sane ZIP. */
  static open(bytes: Uint8Array, limits: ZipLimits): ZipPackage {
    const zip = new ZipPackage(bytes, limits);
    // The end-of-central-directory record: within the last 64 KB + 22 bytes.
    let eocd = -1;
    for (let o = bytes.length - 22; o >= Math.max(0, bytes.length - 65557); o--) {
      if (bytes[o] === 0x50 && bytes[o + 1] === 0x4b && bytes[o + 2] === 0x05 && bytes[o + 3] === 0x06) {
        eocd = o;
        break;
      }
    }
    if (eocd < 0) throw damaged();
    const count = u16(bytes, eocd + 10);
    const cdOffset = u32(bytes, eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ImportError('This file uses a ZIP64 layout, which Freero doesn’t read.');
    if (count > limits.maxEntries) throw new ImportError(`This file holds ${count} parts; Freero reads packages of up to ${limits.maxEntries}.`);
    let o = cdOffset;
    for (let i = 0; i < count; i++) {
      if (o + 46 > bytes.length || u32(bytes, o) !== 0x02014b50) throw damaged();
      const flags = u16(bytes, o + 8);
      const method = u16(bytes, o + 10);
      const compressed = u32(bytes, o + 20);
      const nameLen = u16(bytes, o + 28);
      const extraLen = u16(bytes, o + 30);
      const commentLen = u16(bytes, o + 32);
      const local = u32(bytes, o + 42);
      if (o + 46 + nameLen > bytes.length) throw damaged();
      const name = new TextDecoder().decode(bytes.subarray(o + 46, o + 46 + nameLen));
      o += 46 + nameLen + extraLen + commentLen;
      if (flags & 1) throw new ImportError('This file is encrypted; save it without a password and import it again.');
      if (compressed === 0xffffffff || local === 0xffffffff) throw new ImportError('This file uses a ZIP64 layout, which Freero doesn’t read.');
      // The data starts after the local header, whose own name / extra lengths may differ.
      if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw damaged();
      const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      if (start + compressed > bytes.length) throw damaged();
      if (!zip.entries.has(name)) zip.entries.set(name, { method, compressed, offset: start });
    }
    return zip;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** An entry's bytes, unpacked; null when there is no such entry. Throws ImportError past a limit or on damage. */
  async read(name: string, maxBytes = this.limits.maxEntryBytes): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    this.checkTime();
    const raw = this.bytes.subarray(e.offset, e.offset + e.compressed);
    const cap = Math.min(maxBytes, this.limits.maxEntryBytes, this.limits.maxTotalBytes - this.unpacked);
    if (e.method === 0) {
      if (raw.byteLength > cap) throw tooBig();
      this.unpacked += raw.byteLength;
      return raw;
    }
    if (e.method !== 8) throw new ImportError('A part of this file is compressed in a way Freero doesn’t read.');
    const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(c) {
        c.enqueue(raw.slice());
        c.close();
      },
    });
    const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) throw tooBig();
        this.checkTime();
        chunks.push(value);
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      if (err instanceof ImportError) throw err;
      throw damaged();
    }
    this.unpacked += total;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  /** An entry as UTF-8 text (a byte-order mark dropped); null when there is no such entry. */
  async text(name: string): Promise<string | null> {
    const b = await this.read(name);
    return b ? new TextDecoder().decode(b) : null;
  }

  checkTime(): void {
    if (Date.now() > this.limits.deadline) throw new ImportError('This file takes too long to read; split it into smaller files.');
  }
}

const tooBig = () => new ImportError('This file unpacks to more than Freero imports.');
