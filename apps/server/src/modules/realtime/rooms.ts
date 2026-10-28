// One in-memory Y.Doc + Awareness per open board, speaking the y-websocket protocol.
//
// Everything that touches the database is async, so the order of events matters:
// - A socket is admitted in steps (authenticate, check access, load the doc). Its messages are
//   queued from the first moment and replayed once it joins: y-websocket clients send sync step 1
//   right on open, and a dropped one leaves the client never synced.
// - A room exists (in `rooms`) from its first admission and loads its doc once; every socket
//   arriving meanwhile waits for that same load (never a second, empty doc).
// - Saves of one room run one after another, each appending only the changes made since the
//   previous one to the board's update log (docStore.ts); a failed save keeps them for the retry.
// - A room is unloaded only when nobody is in it, joining it, or saving it (a socket that joins
//   during the final save keeps the room alive instead of loading a stale copy).
// - Deleting a board waits for in-flight saves, so none lands after the delete.
// - The log is compacted into the stored base when it grows long and after a room unloads.
//
// Across instances (platform/pubsub.ts: Redis when REDIS_URL is set; peers.ts has the messages):
// several instances may hold the same board, each with its own sockets. Each publishes the changes
// and presence of ITS sockets on the board's channel and applies the others' (REMOTE_ORIGIN:
// relayed to its sockets, never re-published, never saved - the instance whose socket made a
// change saves it). A room subscribes before it loads and then asks the others for anything the
// database did not have yet (their unsaved changes) and for their sockets' presence; it asks again
// whenever its subscription comes back after a Redis outage. Before unloading, a room that applied
// other instances' changes appends whatever the database still lacks (their instance may have died
// before saving). Access changes, board deletion and logouts are broadcast on a control channel.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WS_MESSAGE_ROLE, Y_KEPT_ON_RESTORE, type Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logError } from '../../platform/log';
import { isShared, publish, subscribe, subscribedInstances, type Subscription } from '../../platform/pubsub';
import { getUser } from '../auth/index';
import { getBoardAccess, touchBoard } from '../boards/index';
import { sanitizeAwarenessUpdate, withoutClients, type AwarenessIdentity } from './awareness';
import * as store from './docStore';
import { decideUpdate } from './filter';
import { peerMessages, persistDuration, persistFailures } from './metrics';
import { boardChannel, CONTROL_CHANNEL, decodeControl, decodePeer, encodeControl, encodePeer, INSTANCE_ID, type ControlMessage, type PeerMessage } from './peers';
import { restoreInto } from './restore';

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
/** Origin of changes and presence relayed from other instances. */
const REMOTE_ORIGIN = Symbol('remote');
/** Origin of a version restore: a change made by this instance (relayed, published, saved). */
const RESTORE_ORIGIN = Symbol('restore');
/** How long to wait for the other instances holding a board to send what we lack. */
const PEER_CATCH_UP_TIMEOUT_MS = 2000;

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
  /** Changes made through this room's sockets since the last successful save, in order. */
  private unsaved: Uint8Array[] = [];
  /** Rows in the board's log that this room knows of (loaded + appended); compaction trigger. */
  private logRows = 0;
  private logBytes = 0;
  private firstDirtyAt = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private unloadTimer: NodeJS.Timeout | null = null;
  /** Tail of this room's save queue (never rejects). */
  private saving: Promise<void> = Promise.resolve();
  private pendingSaves = 0;
  private refreshing: Promise<void> = Promise.resolve();
  private subscription: Subscription | null = null;
  /** Called with the sender of every sync-reply addressed to us (see catchUpWithPeers). */
  private replyWaiters = new Set<(from: string) => void>();
  /** Applied changes made on other instances (see unloadRoom). */
  sawRemote = false;

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
      if (origin === REMOTE_ORIGIN) {
        this.sawRemote = true;
        return;
      }
      this.toPeers({ type: 'update', update });
      this.unsaved.push(update);
      this.markDirty();
    });

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
        if (conn) {
          // `updated`, too: a client id seen before (on another instance, or before a reconnect).
          for (const id of [...added, ...updated]) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(e, update);
        const msg = encoding.toUint8Array(e);
        // Sent to everyone, including the origin: y-websocket clients rely on the echo of their
        // periodic awareness renewal to know the connection is alive.
        for (const c of this.conns.values()) send(c.ws, msg);
        // Our sockets' presence (and its removal when they leave). Not other instances' (theirs to
        // send), nor states that timed out here (every instance times them out on its own).
        if (origin !== REMOTE_ORIGIN && origin !== 'timeout') this.toPeers({ type: 'awareness', update });
      },
    );

    this.ready = this.open();
  }

  private async open(): Promise<void> {
    const sub = subscribe(boardChannel(this.id), {
      message: (data) => this.onPeerMessage(data),
      resubscribed: () => this.requestPeerSync(),
    });
    this.subscription = sub;
    if (this.destroyed) sub.close();
    // Subscribed first, so nothing published from here on is missed; bounded, so a Redis outage
    // delays opening a board by at most a moment (we ask again once the subscription is up).
    await sub.ready;
    await this.load();
    this.requestPeerSync();
  }

  private async load(): Promise<void> {
    const loaded = await store.loadDoc(this.id);
    if (loaded.state && !this.destroyed) Y.applyUpdate(this.doc, loaded.state, LOAD_ORIGIN);
    this.logRows = loaded.logRows;
    this.logBytes = loaded.logBytes;
  }

  private toPeers(msg: PeerMessage): void {
    if (this.destroyed || !isShared()) return;
    peerMessages.inc({ direction: 'out' });
    publish(boardChannel(this.id), encodePeer(msg));
  }

  /** Asks the other instances holding this board for what we lack and for their presence. */
  private requestPeerSync(): void {
    this.toPeers({ type: 'sync-request', stateVector: Y.encodeStateVector(this.doc) });
  }

  private onPeerMessage(data: Uint8Array): void {
    if (this.destroyed) return;
    try {
      const { from, msg } = decodePeer(data);
      if (from === INSTANCE_ID) return; // our own, echoed back
      peerMessages.inc({ direction: 'in' });
      switch (msg.type) {
        case 'update':
          Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
          break;
        case 'awareness':
          this.applyPeerAwareness(msg.update);
          break;
        case 'sync-request':
          // Answer from the loaded doc (a request can arrive while we are still loading).
          this.ready.then(
            () => this.answerPeer(from, msg.stateVector),
            () => {},
          );
          break;
        case 'sync-reply':
          if (msg.to !== INSTANCE_ID) return;
          Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
          if (msg.awareness) this.applyPeerAwareness(msg.awareness);
          for (const w of [...this.replyWaiters]) w(from);
          break;
      }
    } catch (err) {
      logError(`realtime: bad message from another instance on board ${this.id}`, err);
    }
  }

  /**
   * Resolves once every other instance holding this board has sent what this doc lacks (their
   * changes not saved yet), or after PEER_CATCH_UP_TIMEOUT_MS. For reads and writes made on behalf
   * of a request rather than a socket (duplicate, trash, naming or restoring a version), which may
   * land on an instance that just opened the board. How many answers to expect: the instances
   * subscribed to the board's channel, minus this one.
   */
  async catchUpWithPeers(): Promise<void> {
    if (this.destroyed || !isShared()) return;
    const others = (await subscribedInstances(boardChannel(this.id)).catch(() => Number.POSITIVE_INFINITY)) - 1;
    if (others <= 0 || this.destroyed) return;
    await new Promise<void>((resolve) => {
      const heard = new Set<string>();
      const done = () => {
        clearTimeout(timer);
        this.replyWaiters.delete(waiter);
        resolve();
      };
      const waiter = (from: string) => {
        heard.add(from);
        if (heard.size >= others) done();
      };
      const timer = setTimeout(done, PEER_CATCH_UP_TIMEOUT_MS);
      this.replyWaiters.add(waiter);
      this.requestPeerSync();
    });
  }

  /**
   * Makes the live doc's content equal to `version` (restore.ts) as one change of this instance:
   * sent to every socket here, published to the other instances, saved like a socket's edit.
   */
  restore(version: Uint8Array): number {
    let changed = 0;
    this.doc.transact(() => (changed = restoreInto(this.doc, version, Y_KEPT_ON_RESTORE)), RESTORE_ORIGIN);
    return changed;
  }

  private applyPeerAwareness(update: Uint8Array): void {
    const ours = withoutClients(update, (id) => {
      for (const c of this.conns.values()) if (c.awarenessIds.has(id)) return true;
      return false;
    });
    if (ours) awarenessProtocol.applyAwarenessUpdate(this.awareness, ours, REMOTE_ORIGIN);
  }

  private answerPeer(to: string, stateVector: Uint8Array): void {
    if (this.destroyed) return;
    const ids: number[] = [];
    const states = this.awareness.getStates();
    for (const c of this.conns.values()) for (const id of c.awarenessIds) if (states.has(id)) ids.push(id);
    this.toPeers({
      type: 'sync-reply',
      to,
      update: Y.encodeStateAsUpdate(this.doc, stateVector),
      awareness: ids.length ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids) : null,
    });
  }

  /**
   * Appends what this doc holds and the database lacks (changes relayed from instances that may
   * have died before saving them). False if that could not be checked or saved.
   */
  async saveMissing(): Promise<boolean> {
    try {
      const missing = await store.missingFromStore(this.id, this.doc);
      if (missing) await store.appendUpdates(this.id, [missing]);
      return true;
    } catch (err) {
      if (err instanceof store.BoardGoneError) return true;
      logError(`realtime: could not save other instances' changes to board ${this.id}`, err);
      return false;
    }
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
   * Appends the changes made since the last save to the board's log and bumps its updatedAt.
   * Queued behind any save already running; resolves when this one is done (never rejects).
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
    const updates = this.unsaved;
    this.unsaved = [];
    let appended = updates.length === 0;
    try {
      if (!appended) {
        this.logBytes += await store.appendUpdates(this.id, updates, now);
        this.logRows++;
        appended = true;
      }
      await touchBoard(this.id, now);
      timer();
      if (this.logRows >= store.COMPACT_AFTER_ROWS || this.logBytes >= store.COMPACT_AFTER_BYTES) await this.compact();
    } catch (err) {
      if (!appended) this.unsaved.unshift(...updates); // keep them, before anything newer, for the retry
      if (this.destroyed) return;
      if (err instanceof store.BoardGoneError) {
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

  /** Folds the board's log into its stored base (in this room's save queue). */
  private async compact(): Promise<void> {
    try {
      await store.compactDoc(this.id); // 'skipped' = another instance just compacted: also fine
      this.logRows = 0;
      this.logBytes = 0;
    } catch (err) {
      if (!(err instanceof store.BoardGoneError)) logError(`realtime: could not compact board ${this.id}`, err);
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
    this.subscription?.close();
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
  if (room.hasPendingWrites || (room.sawRemote && !(await room.saveMissing()))) {
    room.scheduleUnload(); // a save failed or another one is running: try again later
    return;
  }
  if (!idle()) return; // someone joined while we were checking the database
  rooms.delete(room.id);
  room.destroy();
  // Leave a single compact base behind, so the next load reads one row (not in the room's queue:
  // it no longer exists; a new room loading meanwhile reads base + log consistently either way).
  track(store.compactDoc(room.id));
}

/** Compactions running outside a room; shutdown waits for them before the database closes. */
const background = new Set<Promise<unknown>>();
function track(p: Promise<unknown>): void {
  const done = p.catch((err) => {
    if (!(err instanceof store.BoardGoneError)) logError('realtime: could not compact a board document', err);
  });
  background.add(done);
  void done.finally(() => background.delete(done));
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

function toAllInstances(msg: ControlMessage): void {
  if (!isShared()) return;
  peerMessages.inc({ direction: 'out' });
  publish(CONTROL_CHANNEL, encodeControl(msg));
}

function endSessionHere(sessionKey: string): void {
  for (const room of rooms.values()) room.endSession(sessionKey);
  for (const p of admitting) if (p.sessionKey === sessionKey) p.ws.close(4401, 'Signed out');
}

/** A session ended (logout): its board sockets close with 4401 in every room, on every instance. */
export function endSessionSockets(sessionKey: string): void {
  endSessionHere(sessionKey);
  toAllInstances({ type: 'end-session', sessionKey });
}

async function refreshAccessHere(boardId: string): Promise<void> {
  accessEpochs.set(boardId, (accessEpochs.get(boardId) ?? 0) + 1);
  await rooms.get(boardId)?.refreshAccess();
}

/**
 * Re-resolves the role of everyone connected to the board; resolves once applied on this
 * instance (other instances apply it moments later).
 */
export async function refreshRoomAccess(boardId: string): Promise<void> {
  toAllInstances({ type: 'refresh-access', boardId });
  await refreshAccessHere(boardId);
}

/** Starts applying other instances' control messages; returns the stop function. */
export function listenToOtherInstances(): () => void {
  const sub = subscribe(CONTROL_CHANNEL, {
    message(data) {
      try {
        const { from, msg } = decodeControl(data);
        if (from === INSTANCE_ID) return;
        peerMessages.inc({ direction: 'in' });
        if (msg.type === 'end-session') endSessionHere(msg.sessionKey);
        else if (msg.type === 'refresh-access') void refreshAccessHere(msg.boardId);
        else void closeBoardHere(msg.boardId);
      } catch (err) {
        logError('realtime: bad control message from another instance', err);
      }
    },
  });
  return sub.close;
}

/** The board was closed (deleted, trashed) while a request was using its doc. */
export class BoardClosedError extends Error {}

/**
 * Runs `fn` with the board's room loaded on THIS instance and caught up with the other instances
 * holding it (their unsaved changes), without any socket: the room stays loaded meanwhile and
 * unloads as usual afterwards.
 */
async function withLiveRoom<T>(boardId: string, fn: (room: Room) => T | Promise<T>): Promise<T> {
  const room = getRoom(boardId);
  room.pendingJoins++;
  try {
    await room.ready;
    await room.catchUpWithPeers();
    if (room.destroyed) throw new BoardClosedError(boardId);
    return await fn(room);
  } finally {
    room.pendingJoins--;
    if (!room.destroyed && room.conns.size === 0 && room.pendingJoins === 0) room.scheduleUnload();
  }
}

/**
 * The board's current full state, as collaborators see it right now: the live doc, including
 * changes other instances have not saved yet (KAI-73) — not just what the database holds.
 * Null when the board has no content.
 */
export async function snapshotBoardDoc(boardId: string): Promise<Uint8Array | null> {
  return withLiveRoom(boardId, (room) => (room.doc.store.clients.size ? Y.encodeStateAsUpdate(room.doc) : null));
}

/**
 * Restores a version of the board (`version`: a full state): applied to the live doc as a new
 * change, so everyone connected, on every instance, converges on it, and saved before this
 * resolves. `before(state)` runs first with the board as it is right before (caught up with the
 * other instances) — e.g. to keep it as a version; if it throws, nothing is restored.
 */
export async function restoreBoardDoc(boardId: string, version: Uint8Array, before: (state: Uint8Array) => Promise<void>): Promise<void> {
  await withLiveRoom(boardId, async (room) => {
    await before(Y.encodeStateAsUpdate(room.doc));
    if (room.destroyed) throw new BoardClosedError(boardId);
    room.restore(version);
    await room.flush();
  });
}

/** Stores the initial content of a brand-new board (e.g. a duplicate). */
export async function initBoardDoc(boardId: string, state: Uint8Array): Promise<void> {
  await store.saveInitialState(boardId, state);
}

/**
 * The board is being deleted: disconnects everyone (4403), drops the in-memory doc and waits for
 * any save in flight. The stored state is removed with the board row (ON DELETE CASCADE).
 */
export async function closeBoardDoc(boardId: string): Promise<void> {
  toAllInstances({ type: 'close-board', boardId });
  await closeBoardHere(boardId);
}

async function closeBoardHere(boardId: string): Promise<void> {
  const room = rooms.get(boardId);
  if (!room) return;
  rooms.delete(boardId);
  room.closeAll(4403, 'Board deleted');
  // Save what this instance's sockets changed and nobody saved yet, then drop the doc: a trashed
  // board keeps those edits (each instance saves its own); for a deleted board the save finds no
  // board and is dropped. Queued behind any save in flight, so nothing lands after this returns.
  await room.flush();
  if (!room.destroyed) room.destroy();
}

/** Saves every loaded doc (graceful shutdown). */
export async function flushAllRooms(): Promise<void> {
  await Promise.all([...rooms.values()].map((r) => r.flush()));
  await Promise.all([...background]);
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
