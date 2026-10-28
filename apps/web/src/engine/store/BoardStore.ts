// The ONLY module family allowed to import yjs / y-websocket / y-protocols / lib0 [W5].
// Owns the Y.Docs (the shared board doc and the layer docs), the network provider, awareness and
// the undo history. Everything else in the engine talks to board data through this class.
//
// Board layers (see ARCHITECTURE.md "Board layers"): besides the shared doc, every client holds
// two layer docs the server syncs only to some connections — 'private' (this user only:
// private-mode drafts, sealed ballots) and 'editors' (owners/editors only: hidden frames'
// contents). Their `elements` maps are read as ONE board together with the shared doc's; a write
// goes to the element's current layer, or where `placement` puts it (new elements, or an element
// that must move, e.g. into a hidden frame).
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import {
  BOARD_LAYERS,
  WS_MESSAGE_LAYER,
  WS_MESSAGE_LAYER_OP,
  WS_MESSAGE_ROLE,
  Y_ELEMENTS,
  Y_SETTINGS,
  type BoardElement,
  type BoardLayer,
  type BoardSettings,
  type LayerOp,
  type PresenceState,
  type Role,
} from '@freero/shared';
import type { ElementLayer } from '../api';
import { compareRenderOrder } from '../geometry/spatial';
import { UndoHistory } from './undo';

/** Transaction origin for every local write; the undo manager tracks only this. */
export const LOCAL_ORIGIN = { source: 'freero-local' };
/** Local writes that must never become an undo step (re-measuring text after fonts load). */
export const SILENT_ORIGIN = { source: 'freero-silent' };
/** Layer updates received from the server (never sent back). */
const LAYER_REMOTE_ORIGIN = { source: 'freero-layer-remote' };

export type ConnectionStatus = 'local' | 'connecting' | 'connected' | 'disconnected' | 'denied';
/** Decides the layer an element is written to, given where it is now (null = new). */
export type Placement = (el: BoardElement, current: ElementLayer | null) => ElementLayer;

export const DEFAULT_SETTINGS: BoardSettings = { background: '#F3F2F8', grid: 'dots', gridSize: 24, snapToGrid: false };

/** A stored grid size another client wrote: a sane positive number, else the default. */
function validGridSize(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 4 && v <= 512 ? v : null;
}

export interface BoardStoreOptions {
  boardId: string;
  /** Empty string = local-only (no network). */
  syncUrl: string;
  /** Persist local-only boards in localStorage (dev sandbox). */
  persistLocal?: boolean;
  /** Local-only boards: start from this full state (a read-only version preview). */
  initialState?: Uint8Array;
  captureTimeout?: number;
}

type Listener = () => void;

interface LayerDoc {
  doc: Y.Doc;
  elements: Y.Map<BoardElement>;
  undo: Y.UndoManager;
  dispose(): void;
}

export class BoardStore {
  readonly doc = new Y.Doc();
  readonly elements: Y.Map<BoardElement>;
  readonly settings: Y.Map<unknown>;
  readonly awareness: Awareness;
  /** Undo manager of the shared doc (layer docs have their own; `history` combines them). */
  readonly undoManager: Y.UndoManager;
  readonly provider: WebsocketProvider | null = null;
  readonly layers: Record<BoardLayer, LayerDoc>;

  status: ConnectionStatus;
  synced = false;
  serverRole: Role | null = null;

  private history: UndoHistory;
  private placement: Placement = (_el, current) => current ?? 'shared';
  private pendingOps: LayerOp[] = [];
  private elementListeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();
  private settingsListeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private roleListeners = new Set<Listener>();
  private undoListeners = new Set<Listener>();
  private localChangeListeners = new Set<Listener>();
  private foreignKeyListeners = new Set<(ids: string[]) => void>();
  private layerCollectionListeners = new Set<Listener>();
  private sorted: BoardElement[] | null = null;
  private byType = new Map<string, BoardElement[]>();
  private version = 0;
  private gestureDepth = 0;
  private baseCaptureTimeout: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private opts: BoardStoreOptions) {
    this.elements = this.doc.getMap<BoardElement>(Y_ELEMENTS);
    this.settings = this.doc.getMap<unknown>(Y_SETTINGS);
    this.baseCaptureTimeout = opts.captureTimeout ?? 600;
    this.history = new UndoHistory(() => this.emit(this.undoListeners));
    this.undoManager = new Y.UndoManager([this.elements, this.settings], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: this.baseCaptureTimeout,
    });
    this.history.add(this.undoManager);
    this.elements.observe((ev) => this.onElementsEvent(ev));
    this.settings.observe(() => this.emit(this.settingsListeners));
    this.layers = { private: this.createLayer('private'), editors: this.createLayer('editors') };

    if (opts.syncUrl) {
      this.status = 'connecting';
      // Connect on the next task, not in the constructor: a store created and destroyed in the
      // same tick (React StrictMode's dev double mount) then never opens a socket, instead of
      // closing one mid-handshake (a console warning on every board load in dev).
      const provider = new WebsocketProvider(opts.syncUrl, opts.boardId, this.doc, { connect: false });
      (this as { provider: WebsocketProvider | null }).provider = provider;
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (!this.destroyed) provider.connect();
      }, 0);
      this.awareness = provider.awareness;
      provider.messageHandlers[WS_MESSAGE_ROLE] = (_encoder, decoder) => {
        try {
          const msg = JSON.parse(decoding.readVarString(decoder));
          if (msg && msg.type === 'role') {
            this.serverRole = msg.role as Role;
            this.emit(this.roleListeners);
          }
        } catch {
          // ignore malformed role message
        }
      };
      // A layer's sync message: apply it to that layer doc; answer (step 1 -> step 2) in the
      // same envelope.
      provider.messageHandlers[WS_MESSAGE_LAYER] = (encoder, decoder) => {
        const wire = decoding.readVarString(decoder) as BoardLayer;
        const layer = BOARD_LAYERS.includes(wire) ? this.layers[wire] : null;
        if (!layer) return;
        const reply = encoding.createEncoder();
        syncProtocol.readSyncMessage(decoder, reply, layer.doc, LAYER_REMOTE_ORIGIN);
        if (encoding.length(reply) > 0) {
          encoding.writeVarUint(encoder, WS_MESSAGE_LAYER);
          encoding.writeVarString(encoder, wire);
          encoding.writeUint8Array(encoder, encoding.toUint8Array(reply));
        }
      };
      provider.on('status', ({ status }: { status: string }) => {
        if (status === 'connected') for (const name of BOARD_LAYERS) this.requestLayerSync(name);
        if (this.status === 'denied') return;
        this.status = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
        this.emit(this.statusListeners);
      });
      provider.on('sync', (isSynced: boolean) => {
        this.synced = isSynced;
        if (isSynced) this.flushLayerOps();
        this.emit(this.statusListeners);
      });
      provider.on('connection-close', (event: CloseEvent | null) => {
        if (event && (event.code === 4401 || event.code === 4403)) {
          this.status = 'denied';
          provider.shouldConnect = false;
          provider.disconnect();
          this.emit(this.statusListeners);
          // [QA collab] Access is gone: nothing written from now on can ever reach the server, so
          // the UI drops to read-only instead of offering tools whose writes are silently lost.
          this.serverRole = 'viewer';
          this.emit(this.roleListeners);
        }
      });
    } else {
      this.status = 'local';
      this.synced = true;
      this.awareness = new Awareness(this.doc);
      if (opts.initialState) Y.applyUpdate(this.doc, opts.initialState, 'load');
      else if (opts.persistLocal) this.loadLocal();
    }
  }

  // ---------------------------------------------------------------- layers
  private createLayer(name: BoardLayer): LayerDoc {
    const doc = new Y.Doc();
    const elements = doc.getMap<BoardElement>(Y_ELEMENTS);
    const undo = new Y.UndoManager([elements], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: this.baseCaptureTimeout });
    this.history.add(undo);
    const onElements = (ev: Y.YMapEvent<BoardElement>) => this.onElementsEvent(ev);
    elements.observe(onElements);
    const onAny = () => this.emit(this.layerCollectionListeners);
    doc.on('afterTransaction', onAny);
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === LAYER_REMOTE_ORIGIN) return;
      this.sendLayer(name, (e) => syncProtocol.writeUpdate(e, update));
    };
    doc.on('update', onUpdate);
    return {
      doc,
      elements,
      undo,
      dispose: () => {
        elements.unobserve(onElements);
        doc.off('afterTransaction', onAny);
        doc.off('update', onUpdate);
        this.history.remove(undo);
        undo.destroy();
        doc.destroy();
      },
    };
  }

  private sendLayer(name: BoardLayer, write: (e: encoding.Encoder) => void): void {
    const p = this.provider;
    if (!p || !p.wsconnected || !p.ws) return; // reconciled by the step-1 exchange on reconnect
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE_LAYER);
    encoding.writeVarString(e, name);
    write(e);
    p.ws.send(encoding.toUint8Array(e));
  }

  /** Asks the server for a layer (it answers only if this socket may read it). */
  requestLayerSync(name: BoardLayer): void {
    this.sendLayer(name, (e) => syncProtocol.writeSyncStep1(e, this.layers[name].doc));
  }

  /**
   * Forgets a layer's local copy (this user lost access to it): a fresh empty doc replaces it,
   * so nothing stale stays on screen and nothing is ever sent back as deletions.
   */
  resetLayer(name: BoardLayer): void {
    const old = this.layers[name];
    const ids = [...old.elements.keys()];
    old.dispose();
    this.layers[name] = this.createLayer(name);
    this.sorted = null;
    this.byType.clear();
    this.version++;
    for (const id of ids) {
      const set = this.elementListeners.get(id);
      if (set) for (const l of [...set]) l();
    }
    this.emit(this.anyListeners);
    this.emit(this.layerCollectionListeners);
  }

  /** Runs a reveal/discard on the server (in order with this socket's updates); offline: queued. */
  runLayerOp(op: LayerOp): void {
    if (!this.provider) return this.applyLayerOpLocally(op);
    this.pendingOps.push(op);
    if (this.synced) this.flushLayerOps();
  }

  private flushLayerOps(): void {
    const p = this.provider;
    if (!p || !p.wsconnected || !p.ws) return;
    for (const op of this.pendingOps.splice(0)) {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE_LAYER_OP);
      encoding.writeVarString(e, JSON.stringify(op));
      p.ws.send(encoding.toUint8Array(e));
    }
  }

  /** Offline sandbox: this user's private layer is everyone's. Not undoable, like a server write. */
  private applyLayerOpLocally(op: LayerOp): void {
    const from = this.layers.private.doc.getMap<unknown>(op.collection);
    const entries = [...from.entries()].filter(([k]) => k.startsWith(op.prefix ?? ''));
    if (!entries.length) return;
    if (op.type === 'reveal') {
      const to = this.doc.getMap<unknown>(op.collection);
      this.doc.transact(() => {
        for (const [k, v] of entries) to.set(k, v);
      }, SILENT_ORIGIN);
    }
    this.layers.private.doc.transact(() => {
      for (const [k] of entries) from.delete(k);
    }, SILENT_ORIGIN);
  }

  setPlacement(p: Placement): void {
    this.placement = p;
  }

  private onElementsEvent(ev: Y.YMapEvent<BoardElement>): void {
    this.sorted = null;
    this.byType.clear();
    this.version++;
    for (const key of ev.keysChanged) {
      const set = this.elementListeners.get(key);
      if (set) for (const l of [...set]) l();
    }
    this.emit(this.anyListeners);
    const origin = ev.transaction.origin;
    if (origin === LOCAL_ORIGIN) this.emit(this.localChangeListeners);
    else if (origin !== SILENT_ORIGIN && this.foreignKeyListeners.size) {
      const ids = [...ev.keysChanged];
      for (const l of [...this.foreignKeyListeners]) l(ids);
    }
  }

  private mapOf(layer: ElementLayer): Y.Map<BoardElement> {
    return layer === 'shared' ? this.elements : this.layers[layer].elements;
  }

  // ---------------------------------------------------------------- local persistence (sandbox)
  private localKey(layer?: BoardLayer) {
    return `freero:local-board:${this.opts.boardId}${layer ? `:${layer}` : ''}`;
  }

  private loadLocal() {
    const docs: Array<[Y.Doc, BoardLayer | undefined]> = [[this.doc, undefined], ...BOARD_LAYERS.map((l) => [this.layers[l].doc, l] as [Y.Doc, BoardLayer])];
    for (const [doc, layer] of docs) {
      try {
        const raw = localStorage.getItem(this.localKey(layer));
        if (raw) {
          const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
          Y.applyUpdate(doc, bytes, 'load');
        }
      } catch {
        // corrupt or unavailable storage: start empty
      }
      doc.on('update', () => {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => this.saveLocal(), 400);
      });
    }
  }

  private saveLocal() {
    if (this.destroyed && !this.persistTimer) return;
    const docs: Array<[Y.Doc, BoardLayer | undefined]> = [[this.doc, undefined], ...BOARD_LAYERS.map((l) => [this.layers[l].doc, l] as [Y.Doc, BoardLayer])];
    for (const [doc, layer] of docs) {
      try {
        const bytes = Y.encodeStateAsUpdate(doc);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        localStorage.setItem(this.localKey(layer), btoa(s));
      } catch {
        // quota exceeded: the sandbox just stops persisting
      }
    }
  }

  // ---------------------------------------------------------------- elements
  getElement(id: string): BoardElement | undefined {
    return this.elements.get(id) ?? this.layers.private.elements.get(id) ?? this.layers.editors.elements.get(id);
  }

  /** The doc an element lives in (the shared one wins if a copy is briefly in two). */
  layerOf(id: string): ElementLayer | null {
    if (this.elements.has(id)) return 'shared';
    if (this.layers.private.elements.has(id)) return 'private';
    if (this.layers.editors.elements.has(id)) return 'editors';
    return null;
  }

  /** All elements in render order (frames first, then z). Cached until the next change. */
  getOrdered(): BoardElement[] {
    if (!this.sorted) {
      const arr = Array.from(this.elements.values());
      const seen = new Set<string>();
      for (const name of BOARD_LAYERS)
        for (const [id, el] of this.layers[name].elements) {
          if (this.elements.has(id) || seen.has(id)) continue;
          seen.add(id);
          arr.push(el);
        }
      arr.sort(compareRenderOrder);
      this.sorted = arr;
    }
    return this.sorted;
  }

  getOrderedOfType(type: string): BoardElement[] {
    let arr = this.byType.get(type);
    if (!arr) {
      arr = this.getOrdered().filter((e) => e.type === type);
      this.byType.set(type, arr);
    }
    return arr;
  }

  getVersion(): number {
    return this.version;
  }

  /** Highest z currently used (for "on top" inserts). */
  maxZ(): number {
    let m = 0;
    for (const el of this.getOrdered()) if (el.z > m) m = el.z;
    return m;
  }

  minZ(): number {
    let m = 0;
    for (const el of this.getOrdered()) if (el.z < m) m = el.z;
    return m;
  }

  /** Runs `fn` as one transaction on every doc it may write (the shared doc and the layers). */
  private transactAll(fn: () => void, origin: object): void {
    const { private: p, editors: e } = this.layers;
    this.doc.transact(() => p.doc.transact(() => e.doc.transact(fn, origin), origin), origin);
  }

  transact(fn: () => void): void {
    // Outside a gesture every write is its own undo step (lock, duplicate, nudge…), however
    // quickly they follow each other; inside a gesture everything merges. Nested in an open
    // transaction (Editor.transact, transactDerived) it joins that one's step.
    if (this.gestureDepth === 0 && !this.doc._transaction) this.history.stopCapturing();
    this.history.beginStep();
    try {
      this.transactAll(fn, LOCAL_ORIGIN);
    } finally {
      this.history.endStep();
    }
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * True when the element's current value was written by another replica whose Yjs client id
   * (in the doc the element lives in) is higher than this replica's: a tie-break every client
   * computes the same way from the same merged state.
   */
  writtenByHigherClient(id: string): boolean {
    const layer = this.layerOf(id);
    if (!layer) return false;
    const map = this.mapOf(layer);
    const writer = map._map.get(id)?.id.client;
    return writer !== undefined && writer > map.doc!.clientID;
  }

  /** Writes that never become an undo step (still synced). Not for user actions. */
  transactSilently(fn: () => void): void {
    this.transactAll(fn, SILENT_ORIGIN);
  }

  /**
   * Local writes that follow from earlier local ones without being a user action (text
   * re-measured once web fonts load). Never a step of their own, but never untracked either:
   * Yjs never undoes a map key over a newer untracked value, so a silent write to an element in
   * the undo history would make every undo / redo of that element do nothing. They join the
   * last undo step (undoing it reverts both); with no history they're silent. Returns false and
   * writes nothing while redo steps exist (a tracked write would discard them): call again
   * after the next local change.
   */
  transactDerived(fn: () => void): boolean {
    const um = this.undoManager;
    if (um.redoStack.length) return false;
    if (!um.undoStack.length) {
      this.transactSilently(fn);
      return true;
    }
    // Make the UndoManager append to its last stack item (it does while "capturing").
    um.lastChange = Date.now();
    this.doc.transact(fn, LOCAL_ORIGIN);
    if (this.gestureDepth === 0) um.stopCapturing();
    return true;
  }

  // Writes drop the ordered caches right away (not only when the transaction ends), so reads
  // inside a transaction — getOrdered(), followers, feature code in editor.transact — see them.
  /** Writes `el` where `placement` says (moving it out of its current layer if that differs). */
  setElement(el: BoardElement): void {
    const current = this.layerOf(el.id);
    this.writeElement(el, current, this.placement(el, current));
  }

  /** Writes `el` into `layer`, removing any copy elsewhere (layer moves, cleanup). */
  moveElement(el: BoardElement, layer: ElementLayer): void {
    this.writeElement(el, this.layerOf(el.id), layer);
    for (const name of BOARD_LAYERS) if (name !== layer && this.layers[name].elements.has(el.id)) this.layers[name].elements.delete(el.id);
  }

  private writeElement(el: BoardElement, current: ElementLayer | null, target: ElementLayer): void {
    if (current && current !== target) this.mapOf(current).delete(el.id);
    this.mapOf(target).set(el.id, el);
    this.sorted = null;
    this.byType.clear();
  }

  deleteElement(id: string): void {
    for (const layer of ['shared', ...BOARD_LAYERS] as ElementLayer[]) {
      const map = this.mapOf(layer);
      if (map.has(id)) map.delete(id);
    }
    this.sorted = null;
    this.byType.clear();
  }

  /** Ids present in the shared doc AND a layer (a concurrent move); the layer copy is stale. */
  duplicatedInLayers(): Array<{ id: string; layer: BoardLayer }> {
    const out: Array<{ id: string; layer: BoardLayer }> = [];
    for (const name of BOARD_LAYERS) for (const id of this.layers[name].elements.keys()) if (this.elements.has(id)) out.push({ id, layer: name });
    return out;
  }

  /** Deletes a layer's stale copy of an element that lives in the shared doc. */
  dropLayerCopy(id: string, layer: BoardLayer): void {
    this.layers[layer].elements.delete(id);
  }

  subscribeElement(id: string, l: Listener): () => void {
    let set = this.elementListeners.get(id);
    if (!set) this.elementListeners.set(id, (set = new Set()));
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) this.elementListeners.delete(id);
    };
  }

  subscribeElements(l: Listener): () => void {
    return this.on(this.anyListeners, l);
  }

  /** Element ids changed by anything but a local write (remote peers, undo/redo, load). */
  subscribeForeignKeys(l: (ids: string[]) => void): () => void {
    this.foreignKeyListeners.add(l);
    return () => this.foreignKeyListeners.delete(l);
  }

  /** Fires after local (undoable) element writes; used for thumbnail dirtiness. */
  subscribeLocalChanges(l: Listener): () => void {
    return this.on(this.localChangeListeners, l);
  }

  // ---------------------------------------------------------------- settings
  getSettings(): BoardSettings {
    return {
      background: (this.settings.get('background') as string) ?? DEFAULT_SETTINGS.background,
      grid: (this.settings.get('grid') as BoardSettings['grid']) ?? DEFAULT_SETTINGS.grid,
      gridSize: validGridSize(this.settings.get('gridSize')) ?? DEFAULT_SETTINGS.gridSize,
      snapToGrid: this.settings.get('snapToGrid') === true,
    };
  }

  updateSettings(patch: Partial<BoardSettings>): void {
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) this.settings.set(k, v);
    });
  }

  subscribeSettings(l: Listener): () => void {
    return this.on(this.settingsListeners, l);
  }

  // ---------------------------------------------------------------- collections
  /** Raw map for a feature collection. The ownership guard lives in store/collections.ts. */
  collectionMap<T>(name: string): Y.Map<T> {
    return this.doc.getMap<T>(name);
  }

  /**
   * Raw map for this user's PRIVATE copy of a collection (the private layer): read as is, never
   * seen by anyone else until revealed. Re-read on every call: the layer doc can be replaced.
   */
  privateCollectionMap<T>(name: string): Y.Map<T> {
    return this.layers.private.doc.getMap<T>(name);
  }

  /** Fires after any transaction on a layer doc (private collections changed, or the doc was reset). */
  subscribeLayerCollections(l: Listener): () => void {
    return this.on(this.layerCollectionListeners, l);
  }

  /** [additive] Local writes to this collection become part of the undo history (FeatureManifest.undoable). */
  trackUndo(name: string): void {
    this.undoManager.addToScope(this.doc.getMap(name));
  }

  // ---------------------------------------------------------------- undo
  undo() {
    this.endAllGestures();
    this.history.undo();
  }

  redo() {
    this.endAllGestures();
    this.history.redo();
  }

  canUndo() {
    return this.history.canUndo();
  }

  canRedo() {
    return this.history.canRedo();
  }

  /** Forgets the whole local undo history (all docs). */
  clearUndo(): void {
    this.history.clear();
  }

  subscribeUndo(l: Listener): () => void {
    return this.on(this.undoListeners, l);
  }

  /**
   * Starts a gesture: every local write until the matching endGesture() merges into ONE
   * undo step (drag, resize, rotate, drag-create, a text edit session). Nestable.
   */
  beginGesture(): void {
    if (this.gestureDepth === 0) {
      this.history.stopCapturing();
      this.history.setCaptureTimeout(Number.POSITIVE_INFINITY);
      this.history.beginStep();
    }
    this.gestureDepth++;
  }

  /**
   * Ends the outermost gesture by reverting its writes and dropping its undo step, as if it never
   * happened (Escape mid-drag). Nested: just ends that level.
   */
  cancelGesture(): void {
    if (this.gestureDepth === 0) return;
    if (this.gestureDepth > 1) return this.endGesture();
    this.gestureDepth = 0;
    this.history.setCaptureTimeout(this.baseCaptureTimeout);
    this.history.stopCapturing();
    this.history.cancelOpenStep();
  }

  endGesture(): void {
    if (this.gestureDepth === 0) return;
    this.gestureDepth--;
    if (this.gestureDepth === 0) {
      this.history.setCaptureTimeout(this.baseCaptureTimeout);
      this.history.stopCapturing();
      this.history.endStep();
    }
  }

  inGesture(): boolean {
    return this.gestureDepth > 0;
  }

  /** True while exactly one gesture level is open: its endGesture() closes the undo step. */
  isOutermostGesture(): boolean {
    return this.gestureDepth === 1;
  }

  private endAllGestures() {
    if (this.gestureDepth > 0) {
      this.gestureDepth = 1;
      this.endGesture();
    }
  }

  // ---------------------------------------------------------------- presence
  setPresence(patch: Partial<PresenceState>): void {
    const cur = (this.awareness.getLocalState() ?? {}) as Partial<PresenceState>;
    this.awareness.setLocalState({ ...cur, ...patch });
  }

  getLocalPresence(): Partial<PresenceState> {
    return (this.awareness.getLocalState() ?? {}) as Partial<PresenceState>;
  }

  getPeers(): Array<PresenceState & { clientId: number }> {
    const out: Array<PresenceState & { clientId: number }> = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID || !state || !(state as PresenceState).user) return;
      out.push({ ...(state as PresenceState), clientId });
    });
    return out;
  }

  subscribePresence(l: Listener): () => void {
    const h = () => l();
    this.awareness.on('change', h);
    return () => this.awareness.off('change', h);
  }

  // ---------------------------------------------------------------- connection
  subscribeStatus(l: Listener): () => void {
    return this.on(this.statusListeners, l);
  }

  subscribeRole(l: Listener): () => void {
    return this.on(this.roleListeners, l);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.saveLocal();
    }
    try {
      this.awareness.setLocalState(null);
    } catch {
      // ignore
    }
    this.provider?.destroy();
    this.undoManager.destroy();
    for (const name of BOARD_LAYERS) this.layers[name].dispose();
    if (!this.provider) this.awareness.destroy();
    this.doc.destroy();
  }

  // ---------------------------------------------------------------- helpers
  private on(set: Set<Listener>, l: Listener): () => void {
    set.add(l);
    return () => set.delete(l);
  }

  private emit(set: Set<Listener>) {
    for (const l of [...set]) l();
  }
}
