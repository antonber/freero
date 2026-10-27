// One in-memory Y.Doc + Awareness per open board, speaking the y-websocket protocol.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WS_MESSAGE_ROLE, type Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logError } from '../../platform/log';
import { getBoardAccess, touchBoard } from '../boards/index';
import { decideUpdate } from './filter';
import * as repo from './repo';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

const SAVE_DEBOUNCE_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const RESYNC_MIN_INTERVAL_MS = 2000;

interface Conn {
  ws: WebSocket;
  userId: string;
  role: Role;
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
  private dirty = false;
  private firstDirtyAt = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private unloadTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    readonly id: string,
    state: Uint8Array | null,
  ) {
    if (state) Y.applyUpdate(this.doc, state);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
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
  }

  join(ws: WebSocket, userId: string, role: Role): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
    const conn: Conn = { ws, userId, role, awarenessIds: new Set(), lastResync: 0 };
    this.conns.set(ws, conn);

    ws.on('message', (data) => this.onMessage(conn, toBytes(data)));
    ws.on('close', () => this.leave(conn));
    ws.on('error', () => ws.terminate());

    // 1) effective role, 2) sync step 1, 3) current awareness states.
    send(ws, encodeRoleMessage(role));
    this.sendSyncStep1(conn);
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(ws, encoding.toUint8Array(e));
    }
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
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn.ws);
          break;
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
    if (decideUpdate(conn.role, this.doc, update) === 'apply') {
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

  leave(conn: Conn): void {
    if (!this.conns.delete(conn.ws)) return;
    if (conn.awarenessIds.size > 0)
      awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
    if (this.conns.size === 0) {
      this.flush();
      this.scheduleUnload();
    }
  }

  /** Re-resolves every connection's role (after membership / link access changes). */
  refreshAccess(): void {
    for (const conn of [...this.conns.values()]) {
      const { role } = getBoardAccess(this.id, conn.userId);
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
    }
  }

  private markDirty(): void {
    if (this.destroyed) return;
    const now = Date.now();
    if (!this.dirty) this.firstDirtyAt = now;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, this.firstDirtyAt + SAVE_MAX_WAIT_MS - now));
    this.saveTimer = setTimeout(() => this.flush(), delay);
    this.saveTimer.unref();
  }

  /** Persists the full doc state if it changed, and bumps the board's updatedAt. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty || this.destroyed) return;
    this.dirty = false;
    try {
      const now = Date.now();
      repo.saveState(this.id, Y.encodeStateAsUpdate(this.doc), now);
      touchBoard(this.id, now);
    } catch (err) {
      this.dirty = true;
      logError(`realtime: failed to persist board ${this.id}`, err);
    }
  }

  private scheduleUnload(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => {
      if (this.conns.size === 0) unloadRoom(this.id);
    }, getConfig().docIdleMs);
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

function getRoom(boardId: string): Room {
  let room = rooms.get(boardId);
  if (!room) {
    room = new Room(boardId, repo.loadState(boardId));
    rooms.set(boardId, room);
  }
  return room;
}

function unloadRoom(boardId: string): void {
  const room = rooms.get(boardId);
  if (!room) return;
  room.flush();
  room.destroy();
  rooms.delete(boardId);
}

export function joinRoom(boardId: string, ws: WebSocket, userId: string, role: Role): void {
  getRoom(boardId).join(ws, userId, role);
}

export function refreshRoomAccess(boardId: string): void {
  rooms.get(boardId)?.refreshAccess();
}

/** Current full state of a board doc (live doc if loaded, else the persisted state). */
export function currentState(boardId: string): Uint8Array | null {
  const room = rooms.get(boardId);
  return room ? Y.encodeStateAsUpdate(room.doc) : repo.loadState(boardId);
}

export function copyState(fromBoardId: string, toBoardId: string): void {
  const state = currentState(fromBoardId);
  if (state) repo.saveState(toBoardId, state, Date.now());
}

/** Disconnects everyone, drops the in-memory doc and deletes the persisted state. */
export function destroyBoardDoc(boardId: string): void {
  const room = rooms.get(boardId);
  if (room) {
    for (const c of room.conns.values()) c.ws.close(4403, 'Board deleted');
    room.conns.clear();
    room.destroy();
    rooms.delete(boardId);
  }
  repo.deleteState(boardId);
}

export function flushAllRooms(): void {
  for (const room of rooms.values()) room.flush();
}

export function loadedRoomCount(): number {
  return rooms.size;
}
