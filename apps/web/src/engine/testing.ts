// Test support for features (exported from '@engine'): several real engine sessions of ONE
// board — real Yjs docs, real Editors with the single-writer and role guards — that exchange
// updates only when told to. Writes made between two sync() calls are concurrent, exactly like
// two people typing at the same moment, so a test can prove they converge without losing any.
//
//   const board = createTestBoard({ users: ['ann', 'bob'], features: [manifest] });
//   const [ann, bob] = board.editors('comments');
//   ann.runCommand(…); bob.runCommand(…);   // concurrent
//   board.sync();                           // both replicas now agree
import type { Role } from '@freero/shared';
import type { Editor, FeatureBundle, FeatureManifest, Host, HostUser } from './api';
import { createCore, type EngineCore } from './runtime/core';
import { syncStores } from './store/replicas';

export interface TestBoardOptions {
  /** One replica per user (an id, or a full user). */
  users: Array<string | HostUser>;
  /** Features loaded in every replica (manifests are enough for collection owners). */
  features?: Array<FeatureManifest | FeatureBundle>;
  /** Role of every replica (default 'owner'). */
  role?: Role;
  /** Clock used for Host.serverNow (default Date.now). */
  now?: () => number;
  /** What Host.listMembers returns (default: the replica's own user). */
  members?: HostUser[];
}

export interface TestBoard {
  /** Each replica's editor, scoped to `scope` (a feature name; default 'engine'). */
  editors(scope?: string): Editor[];
  /** Delivers every pending change to every replica (one network round). */
  sync(): void;
  destroy(): void;
}

const toBundle = (f: FeatureManifest | FeatureBundle): FeatureBundle =>
  'manifest' in f ? f : { manifest: f, elements: [], tools: [], formats: [], panels: [], commands: [] };

export function createTestBoard(opts: TestBoardOptions): TestBoard {
  const bundles = (opts.features ?? []).map(toBundle);
  const cores: EngineCore[] = opts.users.map((u) => {
    const user: HostUser = typeof u === 'string' ? { id: u, name: u, color: '#5b3ff0', avatarUrl: null } : u;
    const host: Host = {
      user,
      board: { id: 'test-board', title: 'Test', role: opts.role ?? 'owner' },
      syncUrl: '',
      uploadImage: async () => ({ url: '' }),
      uploadFile: async () => ({ url: '' }),
      renameBoard: async () => undefined,
      saveThumbnail: async () => undefined,
      openShareDialog: () => undefined,
      navigate: () => undefined,
      notify: () => undefined,
      serverNow: opts.now ?? (() => Date.now()),
      listMembers: async () => opts.members ?? [user],
      unfurl: async () => Promise.reject(new Error('No link previews in tests')),
    };
    const core = createCore(host, bundles);
    core.ui.setState({ viewport: { width: 1000, height: 800 }, camera: { x: 0, y: 0, zoom: 1 } });
    return core;
  });
  return {
    editors: (scope = 'engine') => cores.map((c) => c.scoped(scope)),
    sync: () => syncStores(cores.map((c) => c.store)),
    destroy: () => cores.forEach((c) => c.destroy()),
  };
}
