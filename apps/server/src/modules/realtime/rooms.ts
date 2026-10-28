// One in-memory Y.Doc + Awareness per open board, speaking the y-websocket protocol.
//
// Everything that touches the database is async, so the order of events matters:
// - A socket is admitted in steps (authenticate, check access, load the doc). Its messages are
//   queued from the first moment and replayed once it joins: y-websocket clients send sync step 1
//   right on open, and a dropped one leaves the client never synced.
// - A room exists (in `rooms`) from its first admission and loads its doc once; every socket
//   arriving meanwhile waits for that same load (never a second, empty doc).
// - Saves of one room run one after another (a slow older save never overwrites a newer one).
// - A room is unloaded only when nobody is in it, joining it, or saving it (a socket that joins
//   during the final save keeps the room alive instead of loading a stale copy).
// - Deleting a board waits for in-flight saves, so none lands after the delete.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WS_MESSAGE_ROLE, type Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logError } from '../../platform/log';
import { getUser } from '../auth/index';
import { getBoardAccess, touchBoard } from '../boards/index';
import { sanitizeAwarenessUpdate, type AwarenessIdentity } from './awareness';
import { decideUpdate } from './filter';
import { persistDuration, persistFailures } from './metrics';
import * as repo from './repo';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

const SAVE_DEBOUNCE_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const SAVE_RETRY_MS = 5000;
const RESYNC_MIN_INTERVAL_MS = 2000;
/** How long a socket's identity (name, color) is reused before re-reading the profile. */
const IDENTITY_TTL_MS = 5000;
/** Bytes a socket may send before it has joined (auth + doc load); more closes it. */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

/** Origin of the persisted state applied on load: not a change, so neither broadcast nor saved. */
const LOAD_ORIGIN = Symbol('load');

/** Who a socket is, decided once at admission. */
export interface Admission {
  boardId: string;
  userId: string;
  role: Role;
  sessionKey: string;
  identity: AwarenessIdentity;
}
export interface Refusal {
  code: number;
  reason: string;
}

interface Conn {
  ws: WebSocket;
  userId: string;
  /** Session the socket was opened with (auth's opaque key); logging out closes the socket. */
  sessionKey: string;
  role: Role;
  identity: { value: AwarenessIdentity; at: number; loading: boolean };
  /** Awareness client ids announced over this socket (removed on close). */
  awarenessIds: Set<number>;
  lastResync: number;
}

export function encodeRoleMessage(role: Role): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, WS_MESSAGE_ROLE);
  encoding.writeVarString(e, JSON.stringify({ type: 'role', role }));
  return encoding.toUint8Array(e);
}

function send(ws: WebSocket, msg: Uint8Array): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(msg, (err) => {
    if (err) ws.terminate();
  });
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Map<WebSocket, Conn>();
  /** Resolves once the persisted state is applied (rejects if it could not be loaded). */
  readonly ready: Promise<void>;
  /** Sockets admitted to this room that are waiting for `ready`. */
  pendingJoins = 0;
  destroyed = false;
  private dirty = false;
  private firstDirtyAt = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private unloadTimer: NodeJS.Timeout | null = null;
  /** Tail of this room's save queue (never rejects). */
  private saving: Promise<void> = Promise.resolve();
  private pendingSaves = 0;
  private refreshing: Promise<void> = Promise.resolve();

  constructor(readonly id: string) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, update);
      const msg = encoding.toUint8Array(e);
      for (const c of this.conns.values()) if (c.ws !== origin) send(c.ws, msg);
      this.markDirty();
    });

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
        if (conn) {
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        const msg = encoding.toUint8Array(e);
        // Sent to everyone, including the origin: y-websocket clients rely on the echo of their
        // periodic awareness renewal to know the connection is alive.
        for (const c of this.conns.values()) send(c.ws, msg);
      },
    );

    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const state = await repo.loadState(this.id);
    if (state && !this.destroyed) Y.applyUpdate(this.doc, state, LOAD_ORIGIN);
  }

  /** Adds an admitted socket; `queued` are the messages it sent before joining, in order. */
  join(ws: WebSocket, a: Admission, queued: Uint8Array[]): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
    const conn: Conn = {
      ws,
      userId: a.userId,
      sessionKey: a.sessionKey,
      role: a.role,
      identity: { value: a.identity, at: Date.now(), loading: false },
      awarenessIds: new Set(),
      lastResync: 0,
    };
    this.conns.set(ws, conn);

    ws.on('message', (data) => this.onMessage(conn, toBytes(data)));
    ws.on('close', () => this.leave(conn));

    // 1) effective role, 2) sync step 1, 3) current awareness states, then what the client said.
    send(ws, encodeRoleMessage(conn.role));
    this.sendSyncStep1(conn);
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(ws, encoding.toUint8Array(e));
    }
    for (const msg of queued) this.onMessage(conn, msg);
  }

  private sendSyncStep1(conn: Conn): void {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(e, this.doc);
    send(conn.ws, encoding.toUint8Array(e));
  }

  private onMessage(conn: Conn, data: Uint8Array): void {
    if (this.destroyed || !this.conns.has(conn.ws)) return;
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case MESSAGE_SYNC: {
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            const e = encoding.createEncoder();
            encoding.writeVarUint(e, MESSAGE_SYNC);
            syncProtocol.readSyncStep1(decoder, e, this.doc);
            send(conn.ws, encoding.toUint8Array(e));
          } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
            const update = decoding.readVarUint8Array(decoder);
            this.onUpdate(conn, update, syncType);
          }
          break;
        }
        case MESSAGE_AWARENESS: {
          const update = sanitizeAwarenessUpdate(decoding.readVarUint8Array(decoder), {
            user: this.identityOf(conn),
            ownedElsewhere: (id) => {
              for (const c of this.conns.values()) if (c !== conn && c.awarenessIds.has(id)) return true;
              return false;
            },
          });
          if (update) awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn.ws);
          break;
        }
        case MESSAGE_QUERY_AWARENESS: {
          const e = encoding.createEncoder();
          encoding.writeVarUint(e, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            e,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
          );
          send(conn.ws, encoding.toUint8Array(e));
          break;
        }
        default:
          break; // MESSAGE_AUTH and unknown types are ignored
      }
    } catch (err) {
      logError(`realtime: bad message on board ${this.id}`, err);
    }
  }

  private onUpdate(conn: Conn, update: Uint8Array, syncType: number): void {
    if (decideUpdate(conn.role, this.doc, update, conn.userId) === 'apply') {
      Y.applyUpdate(this.doc, update, conn.ws);
      return;
    }
    // Dropped. A commenter's client now holds state the server rejected; push the server's full
    // state back so it at least has everything authoritative. Only for live updates (not step 2,
    // which is itself an answer to a sync) and throttled, so a misbehaving client cannot loop us.
    if (conn.role === 'commenter' && syncType === syncProtocol.messageYjsUpdate) {
      const now = Date.now();
      if (now - conn.lastResync < RESYNC_MIN_INTERVAL_MS) return;
      conn.lastResync = now;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(e, this.doc);
      send(conn.ws, encoding.toUint8Array(e));
    }
  }

  /**
   * The socket's user as others should see it. Messages are handled synchronously and in order,
   * so a stale profile is refreshed in the background and used from the next message on (profile
   * changes show up within about IDENTITY_TTL_MS).
   */
  private identityOf(conn: Conn): AwarenessIdentity {
    const id = conn.identity;
    if (!id.loading && Date.now() - id.at > IDENTITY_TTL_MS) {
      id.loading = true;
      getUser(conn.userId)
        .then((u) => {
          if (u) id.value = { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl };
        })
        .catch((err) => logError(`realtime: could not refresh the profile of ${conn.userId}`, err))
        .finally(() => {
          id.at = Date.now();
          id.loading = false;
        });
    }
    return id.value;
  }

  /** Closes every socket opened with a session that just ended (logout). */
  endSession(sessionKey: string): void {
    for (const conn of [...this.conns.values()]) {
      if (conn.sessionKey !== sessionKey) continue;
      conn.ws.close(4401, 'Signed out');
      this.leave(conn);
    }
  }

  leave(conn: Conn): void {
    if (!this.conns.delete(conn.ws)) return;
    if (conn.awarenessIds.size > 0)
      awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
    if (this.conns.size === 0) {
      void this.flush();
      this.scheduleUnload();
    }
  }

  /** Disconnects everyone (e.g. the board was deleted). */
  closeAll(code: number, reason: string): void {
    for (const c of [...this.conns.values()]) c.ws.close(code, reason);
    this.conns.clear();
  }

  /**
   * Re-resolves every connection's role (after membership / link access changes). Refreshes run
   * one after another, so the last one always reflects the latest committed access.
   */
  refreshAccess(): Promise<void> {
    this.refreshing = this.refreshing.then(
      () => this.doRefreshAccess(),
      () => this.doRefreshAccess(),
    );
    return this.refreshing.catch((err) => logError(`realtime: could not refresh access on board ${this.id}`, err));
  }

  private async doRefreshAccess(): Promise<void> {
    const conns = [...this.conns.values()];
    const roles = await Promise.all(conns.map(async (c) => (await getBoardAccess(this.id, c.userId)).role));
    conns.forEach((conn, i) => {
      if (!this.conns.has(conn.ws)) return; // left meanwhile
      const role = roles[i];
      if (!role) {
        conn.ws.close(4403, 'Access revoked');
        this.leave(conn);
      } else if (role !== conn.role) {
        const couldWrite = conn.role !== 'viewer';
        conn.role = role;
        send(conn.ws, encodeRoleMessage(role));
        // Newly writable: ask the client for anything it has that we do not.
        if (!couldWrite && role !== 'viewer') this.sendSyncStep1(conn);
      }
    });
  }

  private markDirty(): void {
    if (this.destroyed) return;
    const now = Date.now();
    if (!this.dirty) this.firstDirtyAt = now;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, this.firstDirtyAt + SAVE_MAX_WAIT_MS - now));
    this.saveTimer = setTimeout(() => void this.flush(), delay);
    this.saveTimer.unref();
  }

  /** Unsaved changes, or a save still running. */
  get hasPendingWrites(): boolean {
    return this.dirty || this.pendingSaves > 0;
  }

  /**
   * Persists the full doc state if it changed, and bumps the board's updatedAt. Queued behind any
   * save already running; resolves when this one is done (never rejects).
   */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pendingSaves++;
    this.saving = this.saving.then(() => this.persist()).finally(() => void this.pendingSaves--);
    return this.saving;
  }

  private async persist(): Promise<void> {
    if (!this.dirty || this.destroyed) return;
    this.dirty = false;
    const now = Date.now();
    const timer = persistDuration.startTimer();
    try {
      await repo.saveState(this.id, Y.encodeStateAsUpdate(this.doc), now);
      await touchBoard(this.id, now);
      timer();
    } catch (err) {
      if (this.destroyed) return;
      if (err instanceof repo.BoardGoneError) {
        // Deleted while this doc was open (a socket got in during the delete).
        dropRoom(this, 4403, 'Board deleted');
        return;
      }
      this.dirty = true;
      persistFailures.inc();
      logError(`realtime: failed to persist board ${this.id}; retrying`, err);
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => void this.flush(), SAVE_RETRY_MS);
        this.saveTimer.unref();
      }
    }
  }

  scheduleUnload(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => void unloadRoom(this), getConfig().docIdleMs);
    this.unloadTimer.unref();
  }

  destroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.destroyed = true;
    this.awareness.destroy();
    this.doc.destroy();
  }
}

const rooms = new Map<string, Room>();
/** Bumped by every access refresh, so a socket admitted with an older answer re-checks. */
const accessEpochs = new Map<string, number>();
/** Sockets between upgrade and join (for logout). */
const admitting = new Set<{ ws: WebSocket; sessionKey: string | null }>();

function getRoom(boardId: string): Room {
  let room = rooms.get(boardId);
  if (!room) {
    const created = new Room(boardId);
    rooms.set(boardId, created);
    created.ready.catch((err) => {
      logError(`realtime: could not load board ${boardId}`, err);
      if (rooms.get(boardId) === created) rooms.delete(boardId); // the next socket tries again
      created.destroy();
    });
    room = created;
  }
  return room;
}

function dropRoom(room: Room, code: number, reason: string): void {
  if (rooms.get(room.id) === room) rooms.delete(room.id);
  room.closeAll(code, reason);
  room.destroy();
}

async function unloadRoom(room: Room): Promise<void> {
  const idle = () => rooms.get(room.id) === room && room.conns.size === 0 && room.pendingJoins === 0;
  if (!idle()) return;
  await room.flush();
  if (!idle()) return; // someone joined while we were saving: keep it
  if (room.hasPendingWrites) {
    room.scheduleUnload(); // a save failed or another one is running: try again later
    return;
  }
  rooms.delete(room.id);
  room.destroy();
}

/**
 * Admits an upgraded socket: queues what it sends, runs `authorize` (auth + access), waits for
 * the board's doc, then joins it. `sessionKey` lets a logout close it even before it joined.
 */
export async function admitSocket(
  ws: WebSocket,
  sessionKey: string | null,
  authorize: () => Promise<Admission | Refusal>,
): Promise<void> {
  const queue: Uint8Array[] = [];
  let queuedBytes = 0;
  const hold = (data: WebSocket.RawData) => {
    const bytes = toBytes(data);
    queuedBytes += bytes.byteLength;
    if (queuedBytes > MAX_QUEUED_BYTES) ws.close(1009, 'Too much data before the board loaded');
    else queue.push(bytes);
  };
  ws.on('message', hold);
  ws.on('error', () => ws.terminate());
  const entry = { ws, sessionKey };
  admitting.add(entry);
  try {
    const a = await authorize();
    if ('code' in a) return ws.close(a.code, a.reason);
    const epoch = accessEpochs.get(a.boardId) ?? 0;
    const room = getRoom(a.boardId);
    room.pendingJoins++;
    try {
      await room.ready;
    } finally {
      room.pendingJoins--;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      // Gone while waiting (closed, signed out): don't leave an empty room loaded forever.
      if (room.conns.size === 0 && room.pendingJoins === 0 && !room.destroyed) room.scheduleUnload();
      return;
    }
    if (room.destroyed) return ws.close(4403, 'Board deleted');
    ws.off('message', hold);
    room.join(ws, a, queue);
    // Membership or link access changed after we resolved this socket's role.
    if ((accessEpochs.get(a.boardId) ?? 0) !== epoch) await room.refreshAccess();
  } catch (err) {
    logError('realtime: could not open a board socket', err);
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Could not open the board');
  } finally {
    ws.off('message', hold);
    admitting.delete(entry);
  }
}

/** A session ended (logout): its board sockets close with 4401 in every room. */
export function endSessionSockets(sessionKey: string): void {
  for (const room of rooms.values()) room.endSession(sessionKey);
  for (const p of admitting) if (p.sessionKey === sessionKey) p.ws.close(4401, 'Signed out');
}

/** Re-resolves the role of everyone connected to the board; resolves once applied. */
export async function refreshRoomAccess(boardId: string): Promise<void> {
  accessEpochs.set(boardId, (accessEpochs.get(boardId) ?? 0) + 1);
  await rooms.get(boardId)?.refreshAccess();
}

/** Current full state of a board doc (live doc if loaded — waiting for it to load — else the persisted state). */
export async function snapshotBoardDoc(boardId: string): Promise<Uint8Array | null> {
  const room = rooms.get(boardId);
  if (room && !room.destroyed) {
    try {
      await room.ready;
      if (!room.destroyed) return Y.encodeStateAsUpdate(room.doc);
    } catch {
      /* failed to load: read the stored state below */
    }
  }
  return repo.loadState(boardId);
}

/** Stores the initial content of a brand-new board (e.g. a duplicate). */
export async function initBoardDoc(boardId: string, state: Uint8Array): Promise<void> {
  await repo.saveState(boardId, state, Date.now());
}

/**
 * The board is being deleted: disconnects everyone (4403), drops the in-memory doc and waits for
 * any save in flight. The stored state is removed with the board row (ON DELETE CASCADE).
 */
export async function closeBoardDoc(boardId: string): Promise<void> {
  const room = rooms.get(boardId);
  if (!room) return;
  dropRoom(room, 4403, 'Board deleted');
  await room.flush(); // queued behind the running save; persists nothing more (destroyed)
}

/** Saves every loaded doc (graceful shutdown). */
export async function flushAllRooms(): Promise<void> {
  await Promise.all([...rooms.values()].map((r) => r.flush()));
}

export function loadedRoomCount(): number {
  return rooms.size;
}

/** Loaded docs with changes not yet persisted (or a save in flight). */
export function pendingPersistCount(): number {
  let n = 0;
  for (const r of rooms.values()) if (r.hasPendingWrites) n++;
  return n;
}
