// Test support for features (exported from '@engine'): several real engine sessions of ONE
// board — real Yjs docs, real Editors with the single-writer and role guards — that exchange
// updates only when told to. Writes made between two sync() calls are concurrent, exactly like
// two people typing at the same moment, so a test can prove they converge without losing any.
//
//   const board = createTestBoard({ users: ['ann', 'bob'], features: [manifest] });
//   const [ann, bob] = board.editors('comments');
//   ann.runCommand(…); bob.runCommand(…);   // concurrent
//   board.sync();                           // both replicas now agree
import { createElement, type ReactElement } from 'react';
import type { Role, SuggestionRecord } from '@freero/shared';
import type { Editor, ElementsSnapshot, FeatureBundle, FeatureManifest, Host, HostUser, SavedTemplateInfo } from './api';
import { unavailableVersionHistory } from './api';
import { ElementPreview, ElementView, WorldElements, WorldViewProvider } from './canvas/WorldLayer';
import { EngineContext } from './context';
import { createCore, type EngineCore } from './runtime/core';
import { serverPropose, syncStores } from './store/replicas';

import { t as tr } from './messages';
export interface TestBoardOptions {
  /** One replica per user (an id, or a full user). */
  users: Array<string | HostUser>;
  /** Features loaded in every replica (manifests are enough for collection owners). */
  features?: Array<FeatureManifest | FeatureBundle>;
  /** Role of every replica (default 'owner'). */
  role?: Role;
  /** [additive] Role of each replica by its index (overrides `role`): a commenter next to an owner. */
  roles?: Role[];
  /**
   * [additive] Replicas (by index) whose server says they may take part as participants
   * (RoleMessage.participant): commenters voting, picking and drafting their own.
   */
  participants?: number[];
  /** Clock used for Host.serverNow (default Date.now). */
  now?: () => number;
  /** [additive] The board's title as the replicas open it (default 'Test'); renameBoard changes it. */
  title?: string;
  /** [additive] The board's id (default 'test-board'): two test boards with different ids are two boards (pasting from one into the other). */
  boardId?: string;
  /** What Host.listMembers returns (default: the replica's own user). */
  members?: HostUser[];
}

export interface TestBoard {
  /** Each replica's editor, scoped to `scope` (a feature name; default 'engine'). */
  editors(scope?: string): Editor[];
  /** Delivers every pending change to every replica (one network round). */
  sync(): void;
  /** [additive] Suggestions arriving from the server (KAI-169): records land in every editor's editors layer. */
  propose(records: SuggestionRecord[]): void;
  /**
   * [additive] Element `id` as replica `user` (its index) draws it on the canvas: its feature's
   * component inside that replica's engine, selected while it is in that replica's selection.
   * Render it (react-dom) to test what an element shows and does, hooks and all.
   */
  element(user: number, id: string): ReactElement;
  /**
   * [additive, #131] Element `id` as replica `user`'s image exports and thumbnails draw it: its
   * component in export mode at the canvas's current zoom, never selected or edited.
   */
  exported(user: number, id: string): ReactElement;
  /**
   * [additive, #131] Replica `user`'s world layer as its canvas draws it at its camera (viewport
   * 1000 × 800): every visible item, culled and in low detail as on screen.
   */
  world(user: number): ReactElement;
  destroy(): void;
}

const toBundle = (f: FeatureManifest | FeatureBundle): FeatureBundle =>
  'manifest' in f ? f : { manifest: f, elements: [], tools: [], formats: [], panels: [], commands: [] };

export function createTestBoard(opts: TestBoardOptions): TestBoard {
  const bundles = (opts.features ?? []).map(toBundle);
  // Saved templates live "on the server": shared by the replicas, each user sees their own.
  const templates: Array<SavedTemplateInfo & { content: ElementsSnapshot }> = [];
  let templateSeq = 0;
  // Personal view settings live "on the server" too: per user, so a user's replicas share them.
  const personal = new Map<string, Map<string, { itemId: string; viewId: string; settings: Record<string, unknown> }>>();
  const cores: EngineCore[] = opts.users.map((u, index) => {
    const user: HostUser = typeof u === 'string' ? { id: u, name: u, color: '#5b3ff0', avatarUrl: null } : u;
    const host: Host = {
      user,
      board: { id: opts.boardId ?? 'test-board', title: opts.title ?? tr('test'), role: opts.roles?.[index] ?? opts.role ?? 'owner' },
      syncUrl: '',
      personalViews: {
        list: async () =>
          [...(personal.get(user.id) ?? new Map<string, { itemId: string; viewId: string; settings: Record<string, unknown> }>()).values()].map((v) => structuredClone(v)),
        async save(itemId, viewId, settings) {
          const mine = personal.get(user.id) ?? new Map();
          personal.set(user.id, mine);
          if (settings) mine.set(`${itemId}/${viewId}`, { itemId, viewId, settings: structuredClone(settings) });
          else mine.delete(`${itemId}/${viewId}`);
        },
      },
      uploadImage: async () => ({ url: '' }),
      uploadFile: async () => ({ url: '' }),
      async renameBoard(title) {
        host.board.title = title;
      },
      saveThumbnail: async () => undefined,
      openShareDialog: () => undefined,
      navigate: () => undefined,
      notify: () => undefined,
      serverNow: opts.now ?? (() => Date.now()),
      listMembers: async () => opts.members ?? [user],
      lookupUsers: async (ids) => (opts.members ?? [user]).filter((m) => ids.includes(m.id)),
      inviteMember: async () => Promise.reject(new Error('No invites in tests')),
      unfurl: async () => Promise.reject(new Error('No link previews in tests')),
      listTemplates: async () => templates.filter((t) => t.ownerId === user.id).map(({ content: _c, ...info }) => info).reverse(),
      async loadTemplate(id) {
        const t = templates.find((x) => x.id === id && x.ownerId === user.id);
        if (!t) throw new Error('Template not found');
        return structuredClone(t.content); // a server round trip: never the saved objects themselves
      },
      async saveTemplate({ name, description, thumbnail, content }) {
        const t = {
          id: `tpl-${++templateSeq}`,
          name,
          description,
          thumbnail,
          ownerId: user.id,
          elementCount: content.elements.length,
          createdAt: Date.now(),
          content: structuredClone(content),
        };
        templates.push(t);
        const { content: _c, ...info } = t;
        return info;
      },
      async deleteTemplate(id) {
        const i = templates.findIndex((x) => x.id === id && x.ownerId === user.id);
        if (i < 0) throw new Error('Template not found');
        templates.splice(i, 1);
      },
      shareTemplate: async () => Promise.reject(new Error('No teams in tests')),
      versions: unavailableVersionHistory(tr('noVersionHistoryInTests')),
      importImage: async () => Promise.reject(new Error('No server in tests')),
      fetchImage: async () => Promise.reject(new Error('No server in tests')),
      report: async () => Promise.reject(new Error('No server in tests')),
    };
    const core = createCore(host, bundles);
    core.ui.setState({ viewport: { width: 1000, height: 800 }, camera: { x: 0, y: 0, zoom: 1 } });
    if (opts.participants?.includes(index)) {
      core.store.serverParticipant = true;
      core.ui.setState({ participant: true });
    }
    return core;
  });
  return {
    editors: (scope = 'engine') => cores.map((c) => c.scoped(scope)),
    sync: () =>
      syncStores(
        cores.map((c) => c.store),
        cores.filter((c) => c.editor.can('editor')).map((c) => c.store),
      ),
    propose: (records) => serverPropose(cores.filter((c) => c.editor.can('editor')).map((c) => c.store), records),
    element: (user, id) => createElement(EngineContext.Provider, { value: cores[user] }, createElement(WorldViewProvider, null, createElement(ElementView, { id }))),
    exported: (user, id) => {
      const el = cores[user].store.getElement(id);
      return createElement(EngineContext.Provider, { value: cores[user] }, el ? createElement(ElementPreview, { element: el }) : null);
    },
    world: (user) => createElement(EngineContext.Provider, { value: cores[user] }, createElement(WorldElements)),
    destroy: () => cores.forEach((c) => c.destroy()),
  };
}
