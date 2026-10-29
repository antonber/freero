// One collaborative document of an OBJECT other than the board being edited (KAI-162, KAI-152):
// a doc's document — on its own page, inside a board item, or as a live embed. One Yjs doc per
// object, its own WebSocket (`<syncUrl>/<id>`, admitted by the server with the reader's access to
// THAT object) and its own undo history (the editor's), so nothing here ever touches the board's
// store: undo on a board never undoes a doc edit, and the other way round.
//
// Like BoardStore, this is the only place that holds the Yjs types; the doc editor (engine/docs)
// gets them packed as BlockNote's collaboration options and reads/writes comments through methods.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import { DOC_FRAGMENT, WS_CLOSE_BOARD_REMOVED, WS_MESSAGE_ROLE, type Role, type RoleMessage } from '@freero/shared';
import type { ConnectionStatus } from './BoardStore';

/** Transaction origin of this client's comment writes (never the editor's own origin). */
const COMMENT_ORIGIN = { source: 'freero-doc-comments' };

export interface ObjectDocStoreOptions {
  /** The object's id (the room name). */
  id: string;
  /** Full ws URL prefix (`…/ws/docs`); empty: local-only (a version preview from `initialState`). */
  syncUrl: string;
  initialState?: Uint8Array;
}

/** Who is in the document right now (awareness), except this tab. */
export interface DocPeer {
  clientId: number;
  user: { id?: string; name: string; color: string; avatarUrl?: string | null };
}

export class ObjectDocStore {
  readonly doc = new Y.Doc();
  readonly fragment: Y.XmlFragment;
  private readonly comments: Y.Map<unknown>;
  readonly awareness: Awareness;
  readonly provider: WebsocketProvider | null = null;
  status: ConnectionStatus;
  synced = false;
  /** The role the server gave this socket (null until it said). */
  serverRole: Role | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private destroyed = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly opts: ObjectDocStoreOptions) {
    this.fragment = this.doc.getXmlFragment(DOC_FRAGMENT);
    this.comments = this.doc.getMap<unknown>('comments');
    this.comments.observe(() => this.emit());
    if (opts.syncUrl) {
      this.status = 'connecting';
      const provider = new WebsocketProvider(opts.syncUrl, opts.id, this.doc, { connect: false });
      (this as { provider: WebsocketProvider | null }).provider = provider;
      // Connect on the next task (React StrictMode mounts twice in dev: no socket for the first).
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        if (!this.destroyed) provider.connect();
      }, 0);
      this.awareness = provider.awareness;
      provider.messageHandlers[WS_MESSAGE_ROLE] = (_encoder, decoder) => {
        try {
          const msg = JSON.parse(decoding.readVarString(decoder)) as RoleMessage;
          if (msg && msg.type === 'role') {
            this.serverRole = msg.role;
            this.emit();
          }
        } catch {
          // a malformed role message changes nothing
        }
      };
      provider.on('status', ({ status }: { status: string }) => {
        if (this.status === 'denied' || this.status === 'removed') return;
        this.status = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
        this.emit();
      });
      provider.on('sync', (isSynced: boolean) => {
        this.synced = isSynced;
        this.emit();
      });
      provider.on('connection-close', (event: CloseEvent | null) => {
        if (event && (event.code === 4401 || event.code === 4403 || event.code === WS_CLOSE_BOARD_REMOVED)) {
          // No access (or no longer): read-only from now on, nothing written could reach the server.
          this.status = event.code === WS_CLOSE_BOARD_REMOVED ? 'removed' : 'denied';
          this.serverRole = 'viewer';
          provider.shouldConnect = false;
          provider.disconnect();
          this.emit();
        }
      });
      provider.awareness.on('change', () => this.emit());
    } else {
      this.status = 'local';
      this.synced = true;
      this.awareness = new Awareness(this.doc);
      if (opts.initialState) Y.applyUpdate(this.doc, opts.initialState, 'load');
    }
  }

  /** BlockNote's collaboration options for this document (engine/docs passes them through). */
  collaboration(user: { name: string; color: string }) {
    return { fragment: this.fragment, user, provider: { awareness: this.awareness } };
  }

  /** Changes on every status, role, presence or comment change (useSyncExternalStore). */
  getVersion = (): number => this.version;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emitQueued = false;
  /**
   * Tells subscribers on the next microtask, once per burst: the editor sets this tab's presence
   * while React renders it, and a subscriber must never be updated during another's render.
   */
  private emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.version++;
      for (const fn of [...this.listeners]) fn();
    });
  }

  /** The comment records (CommentRecord per key, as on boards). */
  commentEntries(): Array<[string, unknown]> {
    return [...this.comments.entries()];
  }

  /** Writes comment records in one transaction (null deletes). The server checks commenters' writes. */
  writeComments(entries: Record<string, unknown>): void {
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(entries)) {
        if (v === null) this.comments.delete(k);
        else this.comments.set(k, v);
      }
    }, COMMENT_ORIGIN);
  }

  /** Others in the document now (one entry per tab), with the name and color the server stamped. */
  peers(): DocPeer[] {
    const out: DocPeer[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      const user = (state as { user?: DocPeer['user'] } | null)?.user;
      if (user && typeof user.name === 'string') out.push({ clientId, user });
    }
    return out;
  }

  /** The document's full state (e.g. to keep as a file). */
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.listeners.clear();
    this.provider?.destroy();
    if (!this.provider) this.awareness.destroy();
    this.doc.destroy();
  }
}
