// The `.freero` board backup file (KAI-137): a ZIP that holds one board — its content as JSON, the
// files it shows, and a manifest. Pure: building, reading (defensively: the file is untrusted
// input) and the remapping a restore applies. Spec: docs/board-backup.md.
//
//   freero.json    the manifest (format, version, the board, a sha256 of every other entry)
//   board.json     the shared doc: { <collection>: { <key>: <JSON value> } }
//   editors.json   (owners/editors' backups) the hidden frames' contents, same layout
//   files/<name>   the uploads the content references, under their stored names
import { createHash } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

export const BACKUP_FORMAT = 'freero.board-backup';
/**
 * The version this server writes. Within a major format, later versions only ADD (new manifest
 * fields, new collections): a reader keeps what it knows. A change an older reader would get wrong
 * raises `minReaderVersion`, and older readers refuse such a file with a clear message. Reading an
 * OLDER file goes through `UPGRADES` (one step per version), so every file this format ever wrote
 * still restores.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Collection name -> key -> JSON value. */
export type ContentJson = Record<string, Record<string, unknown>>;

export interface BackupFile {
  /** The upload's stored name ("<id>.<ext>"), as `/uploads/<name>` in the content. */
  name: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** The oldest reader that understands this file. */
  minReaderVersion: number;
  exportedAt: string;
  /** The Freero it was made on (its public origin), or null. */
  origin: string | null;
  board: { id: string; title: string; description: string; createdAt: string };
  content: { doc: { path: string; sha256: string }; editors: { path: string; sha256: string } | null };
  files: BackupFile[];
  /** Uploads the content references that the file does not carry, and why. */
  missingFiles: Array<{ name: string; reason: string }>;
}

export interface BackupContents {
  manifest: BackupManifest;
  doc: ContentJson;
  editors: ContentJson | null;
  /** The carried files, by stored name. */
  files: Map<string, Uint8Array>;
}

export class BackupFormatError extends Error {}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function buildBackup(input: {
  exportedAt: Date;
  origin: string | null;
  board: BackupManifest['board'];
  doc: ContentJson;
  editors: ContentJson | null;
  files: Array<{ name: string; data: Uint8Array }>;
  missingFiles: BackupManifest['missingFiles'];
}): Uint8Array {
  const entries: Zippable = {};
  const docBytes = strToU8(JSON.stringify(input.doc));
  const editorsBytes = input.editors ? strToU8(JSON.stringify(input.editors)) : null;
  entries['board.json'] = docBytes;
  if (editorsBytes) entries['editors.json'] = editorsBytes;
  const files: BackupFile[] = [];
  for (const f of input.files) {
    const path = `files/${f.name}`;
    // Images and media are compressed already: stored as they are.
    entries[path] = [f.data, { level: 0 }];
    files.push({ name: f.name, path, bytes: f.data.byteLength, sha256: sha256(f.data) });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    minReaderVersion: 1,
    exportedAt: input.exportedAt.toISOString(),
    origin: input.origin,
    board: input.board,
    content: {
      doc: { path: 'board.json', sha256: sha256(docBytes) },
      editors: editorsBytes ? { path: 'editors.json', sha256: sha256(editorsBytes) } : null,
    },
    files,
    missingFiles: input.missingFiles,
  };
  entries['freero.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(entries, { level: 6 });
}

export interface ReadLimits {
  /** Bytes of the whole file. */
  maxFileBytes: number;
  /** Bytes once unpacked (the file's entries say their sizes; a larger claim is refused before unpacking). */
  maxUnpackedBytes: number;
  /** Bytes of one JSON entry. */
  maxJsonBytes: number;
  /** Entries in the ZIP. */
  maxEntries: number;
  /** Keys over every collection of a content file. */
  maxKeys: number;
}

const ENTRY_RE = /^(freero\.json|board\.json|editors\.json|files\/[A-Za-z0-9_-]{6,64}\.[a-z0-9]{2,5})$/;
const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Older manifests and their content, brought up to the current version one step at a time. */
const UPGRADES: Record<number, (c: BackupContents) => BackupContents> = {
  // e.g. 1: (c) => ({ ...c, manifest: { ...c.manifest, version: 2, … } })
};

const fail = (msg: string): never => {
  throw new BackupFormatError(msg);
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return fail(`The backup’s ${what} is not valid JSON`);
  }
}

function checkContent(v: unknown, what: string, limits: ReadLimits): ContentJson {
  if (!isRecord(v)) fail(`The backup’s ${what} is not a board`);
  let keys = 0;
  const out: ContentJson = {};
  for (const [name, entries] of Object.entries(v as Record<string, unknown>)) {
    if (!COLLECTION_RE.test(name)) fail(`The backup’s ${what} has a collection named “${name.slice(0, 40)}”`);
    if (!isRecord(entries)) fail(`The backup’s ${what} has a malformed “${name}” collection`);
    keys += Object.keys(entries as object).length;
    if (keys > limits.maxKeys) fail(`The backup holds more than ${limits.maxKeys} items`);
    out[name] = entries as Record<string, unknown>;
  }
  for (const [id, el] of Object.entries(out.elements ?? {})) {
    if (!isRecord(el) || el.id !== id || typeof el.type !== 'string') fail(`The backup’s ${what} has a malformed item`);
  }
  return out;
}

function checkManifest(v: unknown): BackupManifest {
  if (!isRecord(v) || v.format !== BACKUP_FORMAT) return fail('This is not a Freero board backup');
  const version = v.version;
  const minReader = v.minReaderVersion ?? version;
  if (!Number.isInteger(version) || (version as number) < 1 || !Number.isInteger(minReader)) return fail('This backup has no valid format version');
  if ((minReader as number) > BACKUP_FORMAT_VERSION)
    fail(`This backup was made by a newer version of Freero (format ${version as number}); this server reads format ${BACKUP_FORMAT_VERSION}. Restore it on an up-to-date Freero.`);
  const board = v.board;
  const content = v.content;
  if (!isRecord(board) || typeof board.title !== 'string' || !isRecord(content) || !isRecord(content.doc) || !Array.isArray(v.files))
    return fail('The backup’s manifest is incomplete');
  return v as unknown as BackupManifest;
}

/**
 * Reads and checks a `.freero` file: size and entry limits before anything is unpacked, known entry
 * names only, every entry's sha256 against the manifest (a changed byte refuses the whole file),
 * the content's shape, and the format version (older ones upgraded; newer ones refused unless they
 * say this reader understands them). Throws BackupFormatError with a message for the person.
 */
export function readBackup(data: Uint8Array, limits: ReadLimits): BackupContents {
  if (data.byteLength > limits.maxFileBytes) fail(`The backup is larger than ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB`);
  let entries = 0;
  let unpacked = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(f) {
        if (++entries > limits.maxEntries) fail('The backup has too many files');
        if (!ENTRY_RE.test(f.name)) return false; // not ours: never unpacked
        const cap = f.name.endsWith('.json') ? limits.maxJsonBytes : limits.maxFileBytes;
        if (f.originalSize > cap) fail('An entry of the backup is too large');
        unpacked += f.originalSize;
        if (unpacked > limits.maxUnpackedBytes) fail('The backup unpacks to more than this server accepts');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BackupFormatError) throw e;
    return fail('This file is not a valid backup (it is not a readable ZIP file)');
  }
  const manifestBytes = raw['freero.json'] ?? fail('This is not a Freero board backup (no freero.json)');
  const manifest = checkManifest(parseJson(manifestBytes, 'manifest'));

  const entry = (path: unknown, want: unknown, what: string): Uint8Array => {
    if (typeof path !== 'string' || !ENTRY_RE.test(path)) return fail(`The backup’s manifest names an invalid ${what}`);
    const bytes = raw[path] ?? fail(`The backup is missing its ${what}`);
    if (typeof want !== 'string' || sha256(bytes) !== want) fail(`The backup’s ${what} was changed after it was made (checksum mismatch)`);
    return bytes;
  };
  const doc = checkContent(parseJson(entry(manifest.content.doc.path, manifest.content.doc.sha256, 'board content'), 'board content'), 'board content', limits);
  const ed = manifest.content.editors;
  const editors = isRecord(ed) ? checkContent(parseJson(entry(ed.path, ed.sha256, 'hidden content'), 'hidden content'), 'hidden content', limits) : null;
  const files = new Map<string, Uint8Array>();
  for (const f of manifest.files) {
    if (!isRecord(f) || typeof f.name !== 'string' || f.path !== `files/${f.name}`) fail('The backup’s manifest lists a malformed file');
    files.set(f.name, entry(f.path, f.sha256, `file ${f.name}`));
  }
  let out: BackupContents = { manifest, doc, editors, files };
  for (let v = manifest.version; v < BACKUP_FORMAT_VERSION; v++) {
    const up = UPGRADES[v] ?? fail(`Backups of format ${v} can no longer be read`);
    out = up(out);
  }
  return out;
}

/** Every string (keys included) of `content`, through `fn`. */
function mapStrings(content: ContentJson, fn: (s: string) => string): ContentJson {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isRecord(v)) {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[fn(k)] = walk(val);
      return o;
    }
    return v;
  };
  return walk(content) as ContentJson;
}

/** The element ids of these docs (the keys of their `elements`). */
export function elementIdsOf(...docs: Array<ContentJson | null>): string[] {
  return docs.flatMap((d) => Object.keys(d?.elements ?? {}));
}

const TOKEN_RE = /[A-Za-z0-9_-]{8,}/g;
const UPLOAD_RE = /\/uploads\/([A-Za-z0-9_-]{6,64}\.[a-z0-9]{2,5})/g;

/**
 * The content with every element id replaced by its new one wherever it appears as a whole token —
 * keys (`elements`, a table's `<id>:<row>:<col>` cells, a frame's notes), references (`frameId`,
 * connector ends, `attachedTo`, a thread's `elementId`) and links (`#<id>`, `?item=<id>`) — and
 * every `/uploads/<name>` replaced as `uploads` says (a name mapped to null is dropped: '' instead).
 * Ids shorter than 8 characters are left as they are (they can't be told apart from words).
 */
export function remapContent(content: ContentJson, ids: ReadonlyMap<string, string>, uploads: (name: string) => string | null): ContentJson {
  return mapStrings(content, (s) => {
    let out = s.includes('/uploads/') ? s.replace(UPLOAD_RE, (_m, name: string) => uploads(name) ?? '') : s;
    if (ids.size) out = out.replace(TOKEN_RE, (t) => ids.get(t) ?? t);
    return out;
  });
}
