// The ONLY module family allowed to import yjs / y-websocket / y-protocols / lib0 [W5].
// Owns the Y.Doc, the network provider, awareness and the undo manager. Everything else in
// the engine talks to board data through this class.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import {
  WS_MESSAGE_ROLE,
  Y_ELEMENTS,
  Y_SETTINGS,
  type BoardElement,
  type BoardSettings,
  type PresenceState,
  type Role,
} from '@freero/shared';
import { compareRenderOrder } from '../geometry/spatial';

/** Transaction origin for every local write; the undo manager tracks only this. */
export const LOCAL_ORIGIN = { source: 'freero-local' };
/** Local writes that must never become an undo step (re-measuring text after fonts load). */
export const SILENT_ORIGIN = { source: 'freero-silent' };

export type ConnectionStatus = 'local' | 'connecting' | 'connected' | 'disconnected' | 'denied';

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
  captureTimeout?: number;
}

type Listener = () => void;

export class BoardStore {
  readonly doc = new Y.Doc();
  readonly elements: Y.Map<BoardElement>;
  readonly settings: Y.Map<unknown>;
  readonly awareness: Awareness;
  readonly undoManager: Y.UndoManager;
  readonly provider: WebsocketProvider | null = null;

  status: ConnectionStatus;
  synced = false;
  serverRole: Role | null = null;

  private elementListeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();
  private settingsListeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private roleListeners = new Set<Listener>();
  private undoListeners = new Set<Listener>();
  private localChangeListeners = new Set<Listener>();
  private foreignKeyListeners = new Set<(ids: string[]) => void>();
  private sorted: BoardElement[] | null = null;
  private byType = new Map<string, BoardElement[]>();
  private version = 0;
  private gestureDepth = 0;
  /** Undo stack length when the outermost gesture began (see cancelGesture). */
  private gestureBase = 0;
  private baseCaptureTimeout: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private opts: BoardStoreOptions) {
    this.elements = this.doc.getMap<BoardElement>(Y_ELEMENTS);
    this.settings = this.doc.getMap<unknown>(Y_SETTINGS);
    this.baseCaptureTimeout = opts.captureTimeout ?? 600;
    this.undoManager = new Y.UndoManager([this.elements, this.settings], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: this.baseCaptureTimeout,
    });
    this.undoManager.on('stack-item-added', () => this.emit(this.undoListeners));
    this.undoManager.on('stack-item-popped', () => this.emit(this.undoListeners));
    this.undoManager.on('stack-cleared', () => this.emit(this.undoListeners));

    this.elements.observe((ev) => {
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
    });
    this.settings.observe(() => this.emit(this.settingsListeners));

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
      provider.on('status', ({ status }: { status: string }) => {
        if (this.status === 'denied') return;
        this.status = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
        this.emit(this.statusListeners);
      });
      provider.on('sync', (isSynced: boolean) => {
        this.synced = isSynced;
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
      if (opts.persistLocal) this.loadLocal();
    }
  }

  // ---------------------------------------------------------------- local persistence (sandbox)
  private localKey() {
    return `freero:local-board:${this.opts.boardId}`;
  }

  private loadLocal() {
    try {
      const raw = localStorage.getItem(this.localKey());
      if (raw) {
        const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        Y.applyUpdate(this.doc, bytes, 'load');
      }
    } catch {
      // corrupt or unavailable storage: start empty
    }
    this.doc.on('update', () => {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => this.saveLocal(), 400);
    });
  }

  private saveLocal() {
    if (this.destroyed && !this.persistTimer) return;
    try {
      const bytes = Y.encodeStateAsUpdate(this.doc);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(this.localKey(), btoa(s));
    } catch {
      // quota exceeded: the sandbox just stops persisting
    }
  }

  // ---------------------------------------------------------------- elements
  getElement(id: string): BoardElement | undefined {
    return this.elements.get(id);
  }

  /** All elements in render order (frames first, then z). Cached until the next change. */
  getOrdered(): BoardElement[] {
    if (!this.sorted) {
      const arr = Array.from(this.elements.values());
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
    for (const el of this.elements.values()) if (el.z > m) m = el.z;
    return m;
  }

  minZ(): number {
    let m = 0;
    for (const el of this.elements.values()) if (el.z < m) m = el.z;
    return m;
  }

  transact(fn: () => void): void {
    // Outside a gesture every write is its own undo step (lock, duplicate, nudge…), however
    // quickly they follow each other; inside a gesture everything merges.
    if (this.gestureDepth === 0) this.undoManager.stopCapturing();
    this.doc.transact(fn, LOCAL_ORIGIN);
  }

  /** Writes that never become an undo step (still synced). Not for user actions. */
  transactSilently(fn: () => void): void {
    this.doc.transact(fn, SILENT_ORIGIN);
  }

  // Writes drop the ordered caches right away (not only when the transaction ends), so reads
  // inside a transaction — getOrdered(), followers, feature code in editor.transact — see them.
  setElement(el: BoardElement): void {
    this.elements.set(el.id, el);
    this.sorted = null;
    this.byType.clear();
  }

  deleteElement(id: string): void {
    this.elements.delete(id);
    this.sorted = null;
    this.byType.clear();
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

  /** [additive] Local writes to this collection become part of the undo history (FeatureManifest.undoable). */
  trackUndo(name: string): void {
    this.undoManager.addToScope(this.doc.getMap(name));
  }

  // ---------------------------------------------------------------- undo
  undo() {
    this.endAllGestures();
    this.undoManager.undo();
  }

  redo() {
    this.endAllGestures();
    this.undoManager.redo();
  }

  canUndo() {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo() {
    return this.undoManager.redoStack.length > 0;
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
      this.undoManager.stopCapturing();
      this.undoManager.captureTimeout = Number.POSITIVE_INFINITY;
      this.gestureBase = this.undoManager.undoStack.length;
    }
    this.gestureDepth++;
  }

  /**
   * Ends the outermost gesture by reverting its writes and dropping its undo step, as if it never
   * happened (Escape mid-drag). A gesture's writes all merge into one stack item, so that is one
   * undo plus forgetting the resulting redo entry. Nested: just ends that level.
   */
  cancelGesture(): void {
    if (this.gestureDepth === 0) return;
    if (this.gestureDepth > 1) return this.endGesture();
    this.gestureDepth = 0;
    this.undoManager.captureTimeout = this.baseCaptureTimeout;
    this.undoManager.stopCapturing();
    if (this.undoManager.undoStack.length > this.gestureBase) {
      this.undoManager.undo();
      this.undoManager.redoStack.pop();
      this.emit(this.undoListeners);
    }
  }

  endGesture(): void {
    if (this.gestureDepth === 0) return;
    this.gestureDepth--;
    if (this.gestureDepth === 0) {
      this.undoManager.captureTimeout = this.baseCaptureTimeout;
      this.undoManager.stopCapturing();
    }
  }

  inGesture(): boolean {
    return this.gestureDepth > 0;
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
