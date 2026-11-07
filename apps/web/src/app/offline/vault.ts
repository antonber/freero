// Boards kept on this device (#178; ARCHITECTURE.md "Offline copies"). One person's vault per
// browser profile: their account card and up to MAX_OFFLINE_BOARDS boards (the summary the page
// needs to open it, and the board's Yjs state the engine hands over), each part sealed with
// AES-256-GCM under a key made for this sign-in. The key is a non-extractable WebCrypto key kept
// beside the records; it is deleted with them on sign-out, when the session is found gone, and
// when someone else signs in here — so a copy never outlives the session it was made in, and a
// record left behind by an interrupted delete is unreadable once its key is gone.
//
// What the key does NOT protect against: someone who can read this browser profile while the
// person is signed in has the key too. That is why a workspace under its own encryption key
// (#159) keeps no offline copies unless its policy says so (`offlineCopies: 'all'`).
import type { Account, BoardSummary } from '@freero/shared';
import type { OfflineCopy } from '@engine';

/** The most boards kept; opening another one drops the one opened longest ago. */
export const MAX_OFFLINE_BOARDS = 20;

/** Key-value storage under the vault (IndexedDB in the browser; a Map in tests). */
export interface VaultBackend {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** What the board page needs to open a board from the device (its summary and team). */
export interface OfflineBoardInfo {
  board: BoardSummary;
  team: { id: string; name: string; company?: { id: string; name: string } | null } | null;
}

interface Sealed {
  iv: Uint8Array;
  data: ArrayBuffer;
}
interface MetaRecord {
  userId: string;
  key: CryptoKey;
  createdAt: number;
}
interface BoardRecord {
  openedAt: number;
  info: Sealed;
  shared: Sealed;
  private?: Sealed;
  editors?: Sealed;
  /** Reveals waiting to be sent (OfflineCopy.ops). */
  ops?: Sealed;
}

const META = 'meta';
const ACCOUNT = 'account';
const BOARD = 'board:';
const text = new TextEncoder();
const untext = new TextDecoder();

export class OfflineVault {
  constructor(
    private readonly db: VaultBackend,
    private readonly subtle: SubtleCrypto = globalThis.crypto.subtle,
    private readonly now: () => number = Date.now,
  ) {}

  /** Changes run one at a time: two first saves must not each make a key (one board's would be lost). */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Whose vault this is (null: none). */
  async owner(): Promise<string | null> {
    return (await this.db.get<MetaRecord>(META))?.userId ?? null;
  }

  /** Deletes everything: the key first, so whatever a failed delete leaves can't be read. */
  wipe(): Promise<void> {
    return this.serial(() => this.wipeNow());
  }

  private async wipeNow(): Promise<void> {
    await this.db.delete(META);
    await this.db.clear();
  }

  /** This person's key: made on first use; another person's vault is wiped first. */
  private async keyFor(userId: string, create: boolean): Promise<CryptoKey | null> {
    const meta = await this.db.get<MetaRecord>(META);
    if (meta && meta.userId === userId) return meta.key;
    if (meta) await this.wipeNow();
    if (!create) return null;
    const key = await this.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await this.db.put(META, { userId, key, createdAt: this.now() } satisfies MetaRecord);
    return key;
  }

  private async seal(key: CryptoKey, aad: string, bytes: Uint8Array): Promise<Sealed> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const data = await this.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(aad) }, key, bytes as Uint8Array<ArrayBuffer>);
    return { iv, data };
  }

  private async open(key: CryptoKey, aad: string, s: Sealed): Promise<Uint8Array> {
    return new Uint8Array(await this.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as Uint8Array<ArrayBuffer>, additionalData: text.encode(aad) }, key, s.data));
  }

  /** Keeps the account card (to open boards offline after a reload); only into this person's vault. */
  rememberAccount(user: Account): Promise<void> {
    return this.serial(() => this.rememberNow(user));
  }

  private async rememberNow(user: Account): Promise<void> {
    const key = await this.keyFor(user.id, false);
    if (!key) return;
    await this.db.put(ACCOUNT, await this.seal(key, `${user.id}\naccount`, text.encode(JSON.stringify(user))));
  }

  /** The account the vault belongs to, or null (no vault, or unreadable). */
  async account(): Promise<Account | null> {
    const meta = await this.db.get<MetaRecord>(META);
    const sealed = await this.db.get<Sealed>(ACCOUNT);
    if (!meta || !sealed) return null;
    try {
      const user = JSON.parse(untext.decode(await this.open(meta.key, `${meta.userId}\naccount`, sealed))) as Account;
      return user.id === meta.userId ? user : null;
    } catch {
      return null;
    }
  }

  saveBoard(user: Account, info: OfflineBoardInfo, copy: OfflineCopy): Promise<void> {
    return this.serial(() => this.saveNow(user, info, copy));
  }

  private async saveNow(user: Account, info: OfflineBoardInfo, copy: OfflineCopy): Promise<void> {
    const key = await this.keyFor(user.id, true);
    if (!key) return;
    const id = info.board.id;
    const aad = (part: string) => `${user.id}\n${id}\n${part}`;
    const record: BoardRecord = {
      openedAt: this.now(),
      info: await this.seal(key, aad('info'), text.encode(JSON.stringify(info))),
      shared: await this.seal(key, aad('shared'), copy.shared),
      ...(copy.private ? { private: await this.seal(key, aad('private'), copy.private) } : {}),
      ...(copy.editors ? { editors: await this.seal(key, aad('editors'), copy.editors) } : {}),
      ...(copy.ops ? { ops: await this.seal(key, aad('ops'), copy.ops) } : {}),
    };
    const known = await this.boardIds();
    await this.db.put(BOARD + id, record);
    if (!(await this.db.get(ACCOUNT))) await this.rememberNow(user);
    if (!known.includes(id) && known.length + 1 > MAX_OFFLINE_BOARDS) await this.evict(known.length + 1 - MAX_OFFLINE_BOARDS, id);
  }

  private async evict(count: number, keep: string): Promise<void> {
    const ages: Array<[string, number]> = [];
    for (const id of await this.boardIds()) {
      if (id === keep) continue;
      ages.push([id, (await this.db.get<BoardRecord>(BOARD + id))?.openedAt ?? 0]);
    }
    ages.sort((a, b) => a[1] - b[1]);
    for (const [id] of ages.slice(0, count)) await this.db.delete(BOARD + id);
  }

  /** The board as kept for this person, or null (none, someone else's vault, or unreadable). */
  async loadBoard(userId: string, boardId: string): Promise<{ info: OfflineBoardInfo; copy: OfflineCopy } | null> {
    const key = await this.keyFor(userId, false);
    const r = await this.db.get<BoardRecord>(BOARD + boardId);
    if (!key || !r) return null;
    const aad = (part: string) => `${userId}\n${boardId}\n${part}`;
    try {
      const info = JSON.parse(untext.decode(await this.open(key, aad('info'), r.info))) as OfflineBoardInfo;
      if (info.board.id !== boardId) return null;
      const copy: OfflineCopy = { shared: await this.open(key, aad('shared'), r.shared) };
      if (r.private) copy.private = await this.open(key, aad('private'), r.private);
      if (r.editors) copy.editors = await this.open(key, aad('editors'), r.editors);
      if (r.ops) copy.ops = await this.open(key, aad('ops'), r.ops);
      return { info, copy };
    } catch {
      return null;
    }
  }

  forgetBoard(boardId: string): Promise<void> {
    return this.serial(() => this.db.delete(BOARD + boardId));
  }

  async boardIds(): Promise<string[]> {
    return (await this.db.keys()).filter((k) => k.startsWith(BOARD)).map((k) => k.slice(BOARD.length));
  }
}

/** A vault backend in memory (tests; browsers without IndexedDB keep nothing instead). */
export function memoryBackend(): VaultBackend & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: async <T,>(k: string) => raw.get(k) as T | undefined,
    put: async (k, v) => void raw.set(k, v),
    delete: async (k) => void raw.delete(k),
    keys: async () => [...raw.keys()],
    clear: async () => raw.clear(),
  };
}

/** The browser's IndexedDB (one object store), or null where there is none (private modes may refuse it). */
export function indexedDbBackend(name = 'freero-offline'): VaultBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  const STORE = 'records';
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      opened = null;
      throw err;
    }));
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: <T,>(k: string) => run<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    put: async (k, v) => void (await run('readwrite', (s) => s.put(v, k))),
    delete: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    keys: async () => (await run('readonly', (s) => s.getAllKeys())).map(String),
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}
