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
// - While loaded, a room whose board keeps changing takes an automatic version (snapshot) every
//   `snapshotEveryMs`: a board open all day gets versions without anyone leaving (KAI-82). Every
//   instance holding the board may try; the database lets one take each (docStore.snapshotIfDue).
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
//
// Board layers (layers.ts): next to the doc, a room holds the board's layer docs ('editors',
// 'u:<userId>'), loaded with it, relayed between instances and saved exactly like the doc (peer
// 'layer-update', layer parts in sync-request/-reply, an append-only log per layer). A layer
// update is sent to a socket only if that socket may read the layer at that moment. A reveal is a
// change made by the instance whose socket asked for it: that instance publishes and saves it.
//
// Facilitator controls (facilitation.ts): a socket's `role` is its EFFECTIVE role: its access
// (`access`) as limited by the board's facilitation session, re-computed whenever that session
// changes and sent to the client with the limits. Owner/editor updates are applied in one
// transaction with the facilitation guards, which undo what the socket may not change; the socket
// is then sent the correction. When the facilitator has been gone `facilitatorGraceMs` (no socket
// here and no presence from another instance), the room ends the session.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import {
  FACILITATION_COLLECTION,
  VOTING_COLLECTION,
  FACILITATION_KEY,
  WS_CLOSE_BOARD_REMOVED,
  WS_MESSAGE_LAYER,
  WS_MESSAGE_LAYER_OP,
  WS_MESSAGE_ROLE,
  Y_KEPT_ON_RESTORE,
  type Role,
  type RoleMessage,
  type SessionLimits,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logError } from '../../platform/log';
import { isShared, publish, subscribe, subscribedInstances, type Subscription } from '../../platform/pubsub';
import { getUser, noteSessionActivity } from '../auth/index';
import { getBoardAccess, touchBoard } from '../boards/index';
import { sanitizeAwarenessUpdate, withoutClients, type AwarenessIdentity } from './awareness';
import { elementChanges, ELEMENTS, emitBoardChange, hasBoardChangeListeners } from './changes';
import { commentPeople, COMMENTS_COLLECTION, emitCommentMessages, hasCommentListeners, messageEvents } from './comments';
import * as store from './docStore';
import { effectiveAccess, guardSession, readFacilitation, revertForbiddenAdds, sameEffective } from './facilitation';
import { guardVotes } from './votingRules';
import { decideUpdate } from './filter';
import * as layerStore from './layerStore';
import {
  applyLayerOp,
  EDITORS_LAYER,
  isLayerName,
  isPrivateLayer,
  mayRunLayerOp,
  mayWriteLayer,
  parseLayerOp,
  privateLayerOf,
  privateLayerOwner,
  readableLayer,
  wireNameFor,
} from './layers';
import { peerMessages, persistDuration, persistFailures } from './metrics';
import { boardChannel, CONTROL_CHANNEL, decodeControl, decodePeer, encodeControl, encodePeer, INSTANCE_ID, type ControlMessage, type PeerMessage } from './peers';
import { restoreInto } from './restore';
import { applyChange, viewOf, type AppliedChange, type BoardChange, type BoardReader, type BoardView } from './view';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

const SAVE_DEBOUNCE_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const SAVE_RETRY_MS = 5000;
/** Retry after an automatic snapshot failed (database down). */
const SNAPSHOT_RETRY_MS = 60_000;
const RESYNC_MIN_INTERVAL_MS = 2000;
/** How long a socket's identity (name, color) is reused before re-reading the profile. */
const IDENTITY_TTL_MS = 5000;
/** Bytes a socket may send before it has joined (auth + doc load); more closes it. */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
/** An element removed from one doc this recently is not "added" when it lands in another (a move). */
const MOVE_WINDOW_MS = 30_000;

/** Origin of the persisted state applied on load: not a change, so neither broadcast nor saved. */
const LOAD_ORIGIN = Symbol('load');
/** Origin of changes and presence relayed from other instances. */
const REMOTE_ORIGIN = Symbol('remote');
/** Origin of changes this instance makes itself (a reveal): published and saved like a socket's. */
const SERVER_ORIGIN = Symbol('server');
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
  /** Set for guests: the only author name their comment messages may carry. */
  authorName?: string;
  /** Accounts: the names their comment messages may carry (current and previous, KAI-187). */
  authorNames?: string[];
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
  /** EFFECTIVE role: `access` as limited by the facilitation session (see the header). */
  role: Role;
  /** The role the socket's user has on the board. */
  access: Role;
  /** What the facilitation session limits for this socket (null: nothing). */
  limits: SessionLimits | null;
  /** Guests: the author name their comments must carry (commentRules.ts). */
  authorName: string | undefined;
  /**
   * The names a comment message of theirs may carry (commentRules.ts, KAI-187): a guest's one name;
   * an account's profile name at admission plus every name it had since (refreshes, renames).
   */
  authorNames: Set<string>;
  identity: { value: AwarenessIdentity; at: number; loading: boolean };
  /** Awareness client ids announced over this socket (removed on close). */
  awarenessIds: Set<number>;
  lastResync: number;
  /** While a layer op of this socket is being applied: its later messages, held in order. */
  held: Uint8Array[] | null;
}

/** One layer doc of a room (see "Board layers" above). */
interface Layer {
  doc: Y.Doc;
  /** Changes made through this instance since the last successful save, in order. */
  unsaved: Uint8Array[];
  /** Applied changes made on other instances (saved before unloading if their instance did not). */
  sawRemote: boolean;
}

/** [WS_MESSAGE_LAYER][layer wire name][sync message written by `write`]. */
function layerMessage(wire: string, write: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, WS_MESSAGE_LAYER);
  encoding.writeVarString(e, wire);
  write(e);
  return encoding.toUint8Array(e);
}

const canEdit = (role: Role | null) => role === 'owner' || role === 'editor';

export function encodeRoleMessage(role: Role, limits?: SessionLimits | null): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, WS_MESSAGE_ROLE);
  const msg: RoleMessage = limits ? { type: 'role', role, limits } : { type: 'role', role };
  encoding.writeVarString(e, JSON.stringify(msg));
  return encoding.toUint8Array(e);
}

function syncUpdateMessage(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  syncProtocol.writeUpdate(e, update);
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
  /** The board's layer docs by storage name. */
  readonly layers = new Map<string, Layer>();
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
  /** When the doc last changed (any instance's change), and up to when a snapshot covers it. */
  private lastChangeAt = 0;
  private snapshotCovers = 0;
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** Running while the facilitation session's facilitator is gone (see checkFacilitator). */
  private facilitatorTimer: NodeJS.Timeout | null = null;
  /** Element ids removed from one of this room's docs lately, by when (see MOVE_WINDOW_MS). */
  private removedAt = new Map<string, number>();

  constructor(readonly id: string) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      this.noteChange();
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
        if (added.length || removed.length) this.checkFacilitator();
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

    // Comment messages written through OUR sockets (comments.ts): attributed to the socket's user.
    const comments = this.doc.getMap<unknown>(COMMENTS_COLLECTION);
    comments.observe((event, tr) => {
      const conn = tr.origin instanceof WebSocket ? this.conns.get(tr.origin) : undefined;
      if (!conn || !hasCommentListeners()) return;
      emitCommentMessages(messageEvents(this.id, comments, event.changes.keys, conn.userId));
    });

    // Element changes made through OUR sockets (changes.ts): the activity feed's trusted source.
    const elements = this.doc.getMap<unknown>(ELEMENTS);
    elements.observe((event, tr) => {
      this.noteRemoved(event.changes.keys);
      this.reportChanges('shared', elements, event.changes.keys, tr.origin);
    });

    // The facilitation session (facilitation.ts): limits every socket's role, any instance's change.
    this.doc.getMap<unknown>(FACILITATION_COLLECTION).observe(() => this.applyFacilitation());
    // The vote budget (votingRules.ts): created up front so the guard sees an update's changes.
    this.doc.getMap<unknown>(VOTING_COLLECTION);

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
    const [loaded, layers] = await Promise.all([store.loadDoc(this.id), layerStore.loadLayers(this.id)]);
    if (this.destroyed) return;
    if (loaded.state) Y.applyUpdate(this.doc, loaded.state, LOAD_ORIGIN);
    this.logRows = loaded.logRows;
    this.logBytes = loaded.logBytes;
    for (const l of layers) if (l.state) Y.applyUpdate(this.layer(l.layer).doc, l.state, LOAD_ORIGIN);
  }

  /** The layer stored under `name`, created empty on first use. */
  layer(name: string): Layer {
    let layer = this.layers.get(name);
    if (layer) return layer;
    const created: Layer = { doc: new Y.Doc(), unsaved: [], sawRemote: false };
    created.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      // Re-checked per socket at send time: roles change (refreshAccess) while the layer lives.
      for (const c of this.conns.values()) {
        const wire = c.ws !== origin ? wireNameFor(name, c) : null;
        if (wire) send(c.ws, layerMessage(wire, (e) => syncProtocol.writeUpdate(e, update)));
      }
      if (origin === REMOTE_ORIGIN) {
        created.sawRemote = true;
        return;
      }
      this.toPeers({ type: 'layer-update', layer: name, update });
      created.unsaved.push(update);
      this.markDirty();
    });
    // Hidden frames' contents: reported for owners/editors only (changes.ts). Private layers never.
    const els = created.doc.getMap<unknown>(ELEMENTS);
    els.observe((event, tr) => {
      this.noteRemoved(event.changes.keys);
      if (name === EDITORS_LAYER) this.reportChanges('editors', els, event.changes.keys, tr.origin);
    });
    this.layers.set(name, created);
    return created;
  }

  private reportChanges(
    layer: 'shared' | 'editors',
    elements: Y.Map<unknown>,
    keys: Map<string, { action: 'add' | 'update' | 'delete'; oldValue: unknown }>,
    origin: unknown,
  ): void {
    const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
    if (!conn || !hasBoardChangeListeners()) return;
    const { changes, frameTitles } = elementChanges(layer, elements, this.doc.getMap<unknown>(ELEMENTS), keys);
    emitBoardChange({ boardId: this.id, actorId: conn.userId, actorName: conn.identity.value.name, layer, changes, frameTitles });
  }

  /** A layer sync message from a socket: answered only for layers it may read. */
  private onLayerMessage(conn: Conn, decoder: decoding.Decoder): void {
    const wire = decoding.readVarString(decoder);
    const name = readableLayer(wire, conn);
    if (!name) return;
    const { doc } = this.layer(name);
    const syncType = decoding.readVarUint(decoder);
    if (syncType === syncProtocol.messageYjsSyncStep1) {
      // Answer with what the client lacks, then ask for what we lack (its offline edits).
      send(conn.ws, layerMessage(wire, (e) => syncProtocol.readSyncStep1(decoder, e, doc)));
      send(conn.ws, layerMessage(wire, (e) => syncProtocol.writeSyncStep1(e, doc)));
    } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
      const update = decoding.readVarUint8Array(decoder);
      if (!mayWriteLayer(name, conn)) return;
      // Guards as for the shared doc (onUpdate): sealed ballots keep to the vote's budget too.
      const addTypes = conn.limits?.addTypes;
      const before = Y.encodeStateVector(doc);
      let fixed = false;
      doc.getMap<unknown>(VOTING_COLLECTION);
      doc.transact((tr) => {
        Y.applyUpdate(doc, update);
        fixed = guardVotes(tr, doc, this.doc, conn.userId);
        if (addTypes) fixed = revertForbiddenAdds(tr, doc.getMap<unknown>(ELEMENTS), new Set(addTypes), (id) => this.existsElsewhere(doc, id)) > 0 || fixed;
      }, conn.ws);
      if (fixed) send(conn.ws, layerMessage(wire, (e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc, before))));
    }
  }

  // ---------------------------------------------------------------- facilitation (facilitation.ts)

  private noteRemoved(keys: Map<string, { action: string }>): void {
    const now = Date.now();
    for (const [id, { action }] of keys) if (action === 'delete') this.removedAt.set(id, now);
    if (this.removedAt.size > 2000)
      for (const [id, at] of this.removedAt) if (now - at > MOVE_WINDOW_MS) this.removedAt.delete(id);
  }

  /** Is element `id` in one of this room's docs other than `doc`, or was it removed from one lately? */
  private existsElsewhere(doc: Y.Doc, id: string): boolean {
    const at = this.removedAt.get(id);
    if (at !== undefined && Date.now() - at <= MOVE_WINDOW_MS) return true;
    if (doc !== this.doc && this.doc.getMap<unknown>(ELEMENTS).has(id)) return true;
    for (const l of this.layers.values()) if (l.doc !== doc && l.doc.getMap<unknown>(ELEMENTS).has(id)) return true;
    return false;
  }

  /** Re-derives every socket's effective role after the session changed. */
  private applyFacilitation(): void {
    if (this.destroyed) return;
    const session = readFacilitation(this.doc);
    for (const conn of this.conns.values()) this.setEffective(conn, session);
    this.checkFacilitator();
  }

  /** Recomputes a socket's effective role and limits; tells the client when they changed. */
  private setEffective(conn: Conn, session = readFacilitation(this.doc)): void {
    const next = effectiveAccess(conn.access, conn.userId, session);
    if (sameEffective(next, { role: conn.role, limits: conn.limits })) return;
    const couldWrite = conn.role !== 'viewer';
    const couldEdit = canEdit(conn.role);
    conn.role = next.role;
    conn.limits = next.limits;
    send(conn.ws, encodeRoleMessage(next.role, next.limits));
    // Newly writable: ask the client for anything it has that we do not (writes dropped while the
    // board was locked included: they land now instead of leaving its doc diverged for good).
    if ((!couldWrite && next.role !== 'viewer') || (!couldEdit && canEdit(next.role))) this.sendSyncStep1(conn);
    if (!couldEdit && canEdit(next.role))
      for (const [name, l] of this.layers) {
        const wire = wireNameFor(name, conn);
        if (wire) send(conn.ws, layerMessage(wire, (e) => syncProtocol.writeSyncStep1(e, l.doc)));
      }
  }

  /** Is the session's facilitator here (a socket on this instance, or presence from another)? */
  private facilitatorPresent(by: string): boolean {
    for (const c of this.conns.values()) if (c.userId === by) return true;
    for (const state of this.awareness.getStates().values()) if ((state as { user?: { id?: string } } | null)?.user?.id === by) return true;
    return false;
  }

  /** Starts / stops the countdown that ends a session whose facilitator left. */
  private checkFacilitator(): void {
    const session = readFacilitation(this.doc);
    if (!session || this.destroyed || this.facilitatorPresent(session.by)) {
      if (this.facilitatorTimer) clearTimeout(this.facilitatorTimer);
      this.facilitatorTimer = null;
      return;
    }
    if (this.facilitatorTimer) return;
    this.facilitatorTimer = setTimeout(() => {
      this.facilitatorTimer = null;
      const now = readFacilitation(this.doc);
      if (this.destroyed || !now || now.by !== session.by || now.startedAt !== session.startedAt || this.facilitatorPresent(now.by)) return;
      this.doc.transact(() => this.doc.getMap<unknown>(FACILITATION_COLLECTION).delete(FACILITATION_KEY), SERVER_ORIGIN);
    }, getConfig().facilitatorGraceMs);
    this.facilitatorTimer.unref();
  }

  /**
   * Reveal / discard (owners and editors). Only the private layers of people who may still edit
   * the board take part, which takes a database read: the socket's later messages are held
   * meanwhile, so the op lands in order with them (e.g. a vote's end after its ballots).
   */
  private onLayerOp(conn: Conn, decoder: decoding.Decoder): void {
    const op = parseLayerOp(decoding.readVarString(decoder));
    if (!op || !mayRunLayerOp(conn)) return;
    const names = op.mine ? [privateLayerOf(conn.userId)] : [...this.layers.keys()].filter(isPrivateLayer);
    conn.held = [];
    void Promise.all(names.map(async (n) => ((await getBoardAccess(this.id, privateLayerOwner(n)!)).role)))
      .then((roles) => {
        if (this.destroyed || !this.conns.has(conn.ws) || !mayRunLayerOp(conn)) return;
        const docs = new Map<string, Y.Doc>();
        names.forEach((n, i) => {
          const l = this.layers.get(n);
          if (l && canEdit(roles[i])) docs.set(n, l.doc);
        });
        applyLayerOp(op, this.doc, docs, SERVER_ORIGIN);
      })
      .catch((err) => logError(`realtime: could not apply a layer op on board ${this.id}`, err))
      .finally(() => {
        const held = conn.held ?? [];
        conn.held = null;
        for (const msg of held) this.receive(conn, msg);
      });
  }

  /** Every message of a socket goes through here (held while one of its layer ops is pending). */
  private receive(conn: Conn, data: Uint8Array): void {
    if (conn.held) conn.held.push(data);
    else this.onMessage(conn, data);
  }

  private toPeers(msg: PeerMessage): void {
    if (this.destroyed || !isShared()) return;
    peerMessages.inc({ direction: 'out' });
    publish(boardChannel(this.id), encodePeer(msg));
  }

  /** Asks the other instances holding this board for what we lack and for their presence. */
  private requestPeerSync(): void {
    const layers = [...this.layers].map(([layer, l]) => ({ layer, data: Y.encodeStateVector(l.doc) }));
    this.toPeers({ type: 'sync-request', stateVector: Y.encodeStateVector(this.doc), layers });
  }

  /** Layer parts from another instance (updates), applied as remote changes. */
  private applyPeerLayers(parts: Array<{ layer: string; data: Uint8Array }> | undefined): void {
    for (const { layer, data } of parts ?? []) if (isLayerName(layer)) Y.applyUpdate(this.layer(layer).doc, data, REMOTE_ORIGIN);
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
            () => this.answerPeer(from, msg.stateVector, msg.layers ?? []),
            () => {},
          );
          break;
        case 'sync-reply':
          if (msg.to !== INSTANCE_ID) return;
          Y.applyUpdate(this.doc, msg.update, REMOTE_ORIGIN);
          this.applyPeerLayers(msg.layers);
          if (msg.awareness) this.applyPeerAwareness(msg.awareness);
          for (const w of [...this.replyWaiters]) w(from);
          break;
        case 'layer-update':
          this.applyPeerLayers([{ layer: msg.layer, data: msg.update }]);
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

  private answerPeer(to: string, stateVector: Uint8Array, layerVectors: Array<{ layer: string; data: Uint8Array }>): void {
    if (this.destroyed) return;
    const theirs = new Map(layerVectors.map((l) => [l.layer, l.data]));
    // Every layer we hold, as far as they lack it (all of it for a layer they don't have yet).
    const layers = [...this.layers].map(([layer, l]) => ({ layer, data: Y.encodeStateAsUpdate(l.doc, theirs.get(layer)) }));
    const ids: number[] = [];
    const states = this.awareness.getStates();
    for (const c of this.conns.values()) for (const id of c.awarenessIds) if (states.has(id)) ids.push(id);
    this.toPeers({
      type: 'sync-reply',
      to,
      update: Y.encodeStateAsUpdate(this.doc, stateVector),
      awareness: ids.length ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids) : null,
      layers,
    });
  }

  /**
   * Appends what this doc holds and the database lacks (changes relayed from instances that may
   * have died before saving them). False if that could not be checked or saved.
   */
  async saveMissing(): Promise<boolean> {
    try {
      if (this.sawRemote) {
        const missing = await store.missingFromStore(this.id, this.doc);
        if (missing) await store.appendUpdates(this.id, [missing]);
      }
      for (const [name, l] of this.layers) {
        if (!l.sawRemote) continue;
        const missing = await layerStore.missingLayerFromStore(this.id, name, l.doc);
        if (missing) await layerStore.appendLayerUpdates(this.id, name, [missing]);
      }
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
    const eff = effectiveAccess(a.role, a.userId, readFacilitation(this.doc));
    const conn: Conn = {
      ws,
      userId: a.userId,
      sessionKey: a.sessionKey,
      role: eff.role,
      access: a.role,
      limits: eff.limits,
      authorName: a.authorName,
      authorNames: new Set(a.authorName !== undefined ? [a.authorName] : [a.identity.name, ...(a.authorNames ?? [])]),
      identity: { value: a.identity, at: Date.now(), loading: false },
      awarenessIds: new Set(),
      lastResync: 0,
      held: null,
    };
    this.conns.set(ws, conn);

    ws.on('message', (data) => this.receive(conn, toBytes(data)));
    ws.on('close', () => this.leave(conn));

    // 1) effective role, 2) sync step 1, 3) current awareness states, then what the client said.
    send(ws, encodeRoleMessage(conn.role, conn.limits));
    this.sendSyncStep1(conn);
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(ws, encoding.toUint8Array(e));
    }
    for (const msg of queued) this.receive(conn, msg);
    this.checkFacilitator();
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
        case WS_MESSAGE_LAYER:
          this.onLayerMessage(conn, decoder);
          break;
        case WS_MESSAGE_LAYER_OP:
          this.onLayerOp(conn, decoder);
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
    if (canEdit(conn.role)) {
      // With the facilitation guards in the same transaction: nobody else ever receives what they
      // undo, and the socket is sent the correction (facilitation.ts).
      const before = Y.encodeStateVector(this.doc);
      const addTypes = conn.limits?.addTypes;
      let fixed = false;
      this.doc.transact((tr) => {
        Y.applyUpdate(this.doc, update);
        fixed = guardSession(tr, this.doc, { userId: conn.userId, access: conn.access });
        fixed = guardVotes(tr, this.doc, this.doc, conn.userId) || fixed;
        if (addTypes) fixed = revertForbiddenAdds(tr, this.doc.getMap<unknown>(ELEMENTS), new Set(addTypes), (id) => this.existsElsewhere(this.doc, id)) > 0 || fixed;
      }, conn.ws);
      if (fixed) send(conn.ws, syncUpdateMessage(Y.encodeStateAsUpdate(this.doc, before)));
      if (syncType === syncProtocol.messageYjsUpdate) noteSessionActivity(conn.sessionKey);
      return;
    }
    if (decideUpdate(conn.role, this.doc, update, conn.userId, conn.authorNames) === 'apply') {
      Y.applyUpdate(this.doc, update, conn.ws);
      // Editing over the socket is activity: a workspace's idle limit must not sign out someone at work.
      if (syncType === syncProtocol.messageYjsUpdate) noteSessionActivity(conn.sessionKey);
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
          if (u) setIdentity(conn, { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl });
        })
        .catch((err) => logError(`realtime: could not refresh the profile of ${conn.userId}`, err))
        .finally(() => {
          id.at = Date.now();
          id.loading = false;
        });
    }
    return id.value;
  }

  /** The user's profile changed (a rename): their sockets here use it from now on. */
  profileChanged(userId: string, identity: AwarenessIdentity): void {
    for (const conn of this.conns.values()) if (conn.userId === userId) setIdentity(conn, identity);
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
    this.checkFacilitator();
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
      } else if (role !== conn.access) {
        conn.access = role;
        this.setEffective(conn);
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
    // Layers: each its own log row; a failed one keeps its changes (and everything after it).
    const layerSaves = [...this.layers].filter(([, l]) => l.unsaved.length).map(([name, l]) => ({ name, l, updates: l.unsaved.splice(0) }));
    try {
      if (!appended) {
        this.logBytes += await store.appendUpdates(this.id, updates, now);
        this.logRows++;
        appended = true;
        // Only shared changes are board activity: private drafts never bump "edited".
        await touchBoard(this.id, now);
      }
      while (layerSaves.length) {
        const { name, updates: u } = layerSaves[0];
        await layerStore.appendLayerUpdates(this.id, name, u, now);
        layerSaves.shift();
      }
      timer();
      if (this.logRows >= store.COMPACT_AFTER_ROWS || this.logBytes >= store.COMPACT_AFTER_BYTES) await this.compact();
    } catch (err) {
      if (!appended) this.unsaved.unshift(...updates); // keep them, before anything newer, for the retry
      for (const { l, updates: u } of layerSaves) l.unsaved.unshift(...u);
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

  /** The doc changed: make sure an automatic snapshot will follow (see autoSnapshot). */
  private noteChange(): void {
    this.lastChangeAt = Date.now();
    if (!this.snapshotTimer && !this.destroyed) this.scheduleSnapshot(store.snapshotEveryMs());
  }

  private scheduleSnapshot(delayMs: number): void {
    this.snapshotTimer = setTimeout(() => void this.autoSnapshot(), delayMs);
    this.snapshotTimer.unref();
  }

  /**
   * Keeps the live board as an automatic version when it changed since the newest snapshot and that
   * one is at least `snapshotEveryMs` old. The first comes one period after the first change (an
   * edit right after a version is rarely worth one of its own); then one per period while changes
   * keep coming, none while nothing changes. Another instance (or a compaction) having taken one
   * meanwhile counts: its snapshot was of the same live board.
   */
  private async autoSnapshot(): Promise<void> {
    this.snapshotTimer = null;
    if (this.destroyed || this.lastChangeAt <= this.snapshotCovers) return;
    const now = Date.now();
    let retryMs: number | null = null;
    try {
      this.snapshotCovers = (await store.snapshotIfDue(this.id, Y.encodeStateAsUpdate(this.doc), now)).newestAt;
    } catch (err) {
      if (err instanceof store.BoardGoneError) return;
      logError(`realtime: could not keep an automatic version of board ${this.id}`, err);
      retryMs = SNAPSHOT_RETRY_MS;
    }
    if (this.destroyed || this.snapshotTimer || this.lastChangeAt <= this.snapshotCovers) return;
    this.scheduleSnapshot(retryMs ?? Math.max(0, this.snapshotCovers + store.snapshotEveryMs() - Date.now()));
  }

  scheduleUnload(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => void unloadRoom(this), getConfig().docIdleMs);
    this.unloadTimer.unref();
  }

  destroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    if (this.facilitatorTimer) clearTimeout(this.facilitatorTimer);
    this.destroyed = true;
    this.subscription?.close();
    this.awareness.destroy();
    this.doc.destroy();
    for (const l of this.layers.values()) l.doc.destroy();
  }

  /** Did this room apply changes another instance made (to the doc or any layer)? */
  get sawAnyRemote(): boolean {
    return this.sawRemote || [...this.layers.values()].some((l) => l.sawRemote);
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
  if (room.hasPendingWrites || (room.sawAnyRemote && !(await room.saveMissing()))) {
    room.scheduleUnload(); // a save failed or another one is running: try again later
    return;
  }
  if (!idle()) return; // someone joined while we were checking the database
  rooms.delete(room.id);
  room.destroy();
  // Leave a single compact base behind, so the next load reads one row (not in the room's queue:
  // it no longer exists; a new room loading meanwhile reads base + log consistently either way).
  track(store.compactDoc(room.id));
  // Layers too; an empty one, or a private one whose owner was removed from the board, is deleted.
  for (const name of room.layers.keys()) track(compactLayerChecked(room.id, name));
}

async function compactLayerChecked(boardId: string, layer: string): Promise<void> {
  const owner = privateLayerOwner(layer);
  const keep = !owner || (await getBoardAccess(boardId, owner)).role !== null;
  await layerStore.compactLayer(boardId, layer, keep);
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

/** A socket's account as it is now; the name joins those its comments may carry (KAI-187). */
function setIdentity(conn: Conn, identity: AwarenessIdentity): void {
  conn.identity.value = identity;
  conn.identity.at = Date.now();
  if (conn.authorName === undefined) conn.authorNames.add(identity.name);
}

async function profileChangedHere(userId: string): Promise<void> {
  if (![...rooms.values()].some((r) => [...r.conns.values()].some((c) => c.userId === userId))) return;
  const u = await getUser(userId);
  if (!u) return;
  for (const room of rooms.values()) room.profileChanged(userId, { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl });
}

/**
 * A user changed their profile (auth.onProfileChanged): their board sockets on every instance take
 * the new name and colour at once — presence shows it, and comments written under the new name
 * are accepted (commentRules.ts) — instead of within IDENTITY_TTL_MS. Resolves once applied here.
 */
export async function profileChanged(userId: string): Promise<void> {
  toAllInstances({ type: 'refresh-profile', userId });
  await profileChangedHere(userId);
}

function toAllInstances(msg: ControlMessage): void {
  if (!isShared()) return;
  peerMessages.inc({ direction: 'out' });
  publish(CONTROL_CHANNEL, encodeControl(msg));
}

/**
 * A session ended: its board sockets on THIS instance close with 4401 in every room. auth calls it
 * on every instance (onSessionEnd: its own broadcast and its periodic re-check, KAI-146).
 */
export function endSessionSockets(sessionKey: string): void {
  for (const room of rooms.values()) room.endSession(sessionKey);
  for (const p of admitting) if (p.sessionKey === sessionKey) p.ws.close(4401, 'Signed out');
}

/** The sessions behind this instance's board sockets, joined or being admitted (auth re-checks them). */
export function* liveSessionKeys(): Iterable<string> {
  for (const room of rooms.values()) for (const conn of room.conns.values()) yield conn.sessionKey;
  for (const p of admitting) if (p.sessionKey) yield p.sessionKey;
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
        // Sent only by instances of an older release (auth announces ended sessions now).
        if (msg.type === 'end-session') endSessionSockets(msg.sessionKey);
        else if (msg.type === 'refresh-profile') void profileChangedHere(msg.userId).catch((err) => logError('realtime: could not refresh a profile', err));
        else if (msg.type === 'refresh-access') void refreshAccessHere(msg.boardId);
        else void closeBoardHere(msg.boardId, msg.type === 'remove-board' ? 'removed' : 'deleted');
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

const layerDocs = (room: Room): Map<string, Y.Doc> => new Map([...room.layers].map(([name, l]) => [name, l.doc]));

/**
 * The board as `reader` sees it right now (live, caught up with the other instances): the
 * shared doc plus the layers that reader may read (view.ts). The caller checked access.
 */
export async function readBoardView(boardId: string, reader: BoardReader): Promise<BoardView> {
  return withLiveRoom(boardId, (room) => viewOf(room.doc, layerDocs(room), reader));
}

/**
 * Changes board content on a request, as `actor` (an owner or editor; the caller checked):
 * `plan` sees the live board as the actor does and returns the change, which is applied right
 * away — nothing can land in between — as one transaction per doc, published to every instance
 * and saved before this resolves. Collaborators see one remote change (they cannot undo it with
 * Ctrl+Z, like any change someone else makes). Returns the plan's result next to what changed.
 */
export async function changeBoard<T extends { change: BoardChange }>(
  boardId: string,
  actor: BoardReader,
  plan: (view: BoardView) => T,
): Promise<T & { applied: AppliedChange }> {
  return withLiveRoom(boardId, async (room) => {
    // Hidden frames' contents go to the editors layer (view.ts): have it, even on a board without one yet.
    room.layer(EDITORS_LAYER);
    const docs = layerDocs(room);
    const planned = plan(viewOf(room.doc, docs, actor));
    if (room.destroyed) throw new BoardClosedError(boardId);
    const comments = room.doc.getMap<unknown>(COMMENTS_COLLECTION);
    const commentKeys = Object.keys(planned.change.collections?.[COMMENTS_COLLECTION] ?? {});
    const before = new Map(commentKeys.map((k) => [k, { action: comments.has(k) ? ('update' as const) : ('add' as const), oldValue: comments.get(k) }]));
    const applied = applyChange(room.doc, docs, planned.change, actor, SERVER_ORIGIN);
    // A comment written on a request is the actor's, like one from their socket (mentions, replies).
    if (before.size && hasCommentListeners()) emitCommentMessages(messageEvents(room.id, comments, before, actor.userId));
    await room.flush();
    return { ...planned, applied };
  });
}

/** Current state of one layer of a board (live if loaded, else stored), like snapshotBoardDoc. */
export async function snapshotBoardLayer(boardId: string, layer: string): Promise<Uint8Array | null> {
  const room = rooms.get(boardId);
  if (room && !room.destroyed) {
    try {
      await room.ready;
      const l = room.layers.get(layer);
      if (!room.destroyed) return l ? Y.encodeStateAsUpdate(l.doc) : null;
    } catch {
      /* failed to load: read the stored state below */
    }
  }
  return layerStore.loadLayer(boardId, layer);
}

/** Every layer of a board (live if loaded, else stored): moving a board to the trash keeps them. */
export async function snapshotBoardLayers(boardId: string): Promise<Array<{ layer: string; state: Uint8Array }>> {
  const room = rooms.get(boardId);
  if (room && !room.destroyed) {
    try {
      await room.ready;
      if (!room.destroyed) return [...room.layers].map(([layer, l]) => ({ layer, state: Y.encodeStateAsUpdate(l.doc) }));
    } catch {
      /* failed to load: read the stored state below */
    }
  }
  return (await layerStore.loadLayers(boardId)).flatMap((l) => (l.state ? [{ layer: l.layer, state: l.state }] : []));
}

/** Stores the initial content of a layer of a brand-new (or just trashed) board. */
export async function initBoardLayer(boardId: string, layer: string, state: Uint8Array): Promise<void> {
  await layerStore.saveInitialLayer(boardId, layer, state);
}

/** Stores the initial content of a brand-new board (e.g. a duplicate). */
export async function initBoardDoc(boardId: string, state: Uint8Array): Promise<void> {
  await store.saveInitialState(boardId, state);
}

/**
 * The board is being deleted: disconnects everyone (4403), drops the in-memory doc and waits for
 * any save in flight. The stored state is removed with the board row (ON DELETE CASCADE).
 * `why: 'removed'`: an operator took it down — the sockets close with WS_CLOSE_BOARD_REMOVED, so
 * clients say "removed for review" instead of "no access".
 */
export async function closeBoardDoc(boardId: string, why: 'deleted' | 'removed' = 'deleted'): Promise<void> {
  toAllInstances({ type: why === 'removed' ? 'remove-board' : 'close-board', boardId });
  await closeBoardHere(boardId, why);
}

async function closeBoardHere(boardId: string, why: 'deleted' | 'removed'): Promise<void> {
  const room = rooms.get(boardId);
  if (!room) return;
  rooms.delete(boardId);
  if (why === 'removed') room.closeAll(WS_CLOSE_BOARD_REMOVED, 'Board removed for review');
  else room.closeAll(4403, 'Board deleted');
  // Save what this instance's sockets changed and nobody saved yet, then drop the doc: a trashed
  // board keeps those edits (each instance saves its own); for a deleted board the save finds no
  // board and is dropped. Queued behind any save in flight, so nothing lands after this returns.
  await room.flush();
  if (!room.destroyed) room.destroy();
}

/**
 * Replaces the author name and color on every comment message `userId` wrote on the board (an
 * account purge shows them as "Deleted user"). Goes through the board's live room, caught up with
 * the other instances holding it (withLiveRoom): a comment another instance has not saved yet is
 * renamed too, and connected clients everywhere get the change live. Resolves once it is saved.
 * Running it twice changes nothing the second time; a board closed meanwhile is skipped.
 */
export async function renameCommentAuthor(boardId: string, userId: string, name: string, color: string): Promise<void> {
  try {
    await withLiveRoom(boardId, async (room) => {
      const comments = room.doc.getMap<Record<string, unknown>>(COMMENTS_COLLECTION);
      room.doc.transact(() => {
        for (const [key, value] of comments.entries()) {
          if (!key.startsWith('m:') || value?.authorId !== userId) continue;
          if (value.authorName !== name || value.authorColor !== color) comments.set(key, { ...value, authorName: name, authorColor: color });
        }
      });
      await room.flush();
    });
  } catch (err) {
    if (!(err instanceof BoardClosedError)) throw err;
  }
}

/** User ids that appear in the board's comments (authors, @mentions), from the live doc if loaded. */
export async function commentPeopleOf(boardId: string): Promise<Set<string>> {
  const state = await snapshotBoardDoc(boardId);
  if (!state) return new Set();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return commentPeople(doc.getMap<unknown>(COMMENTS_COLLECTION));
  } finally {
    doc.destroy();
  }
}

/** Saves every loaded doc (graceful shutdown). */
export async function flushAllRooms(): Promise<void> {
  await Promise.all([...rooms.values()].map((r) => r.flush()));
  await Promise.all([...background]);
}

export function loadedRoomCount(): number {
  return rooms.size;
}

/** The live state of every doc loaded on this instance, layers included (edits not saved yet too). */
export function* loadedDocStates(): Generator<Uint8Array> {
  for (const r of rooms.values()) {
    if (r.destroyed) continue;
    yield Y.encodeStateAsUpdate(r.doc);
    for (const l of r.layers.values()) yield Y.encodeStateAsUpdate(l.doc);
  }
}

/** Loaded docs with changes not yet persisted (or a save in flight). */
export function pendingPersistCount(): number {
  let n = 0;
  for (const r of rooms.values()) if (r.hasPendingWrites) n++;
  return n;
}
