// EngineCore: everything one mounted board session needs, wired together once.
// Created by <BoardEngine>, destroyed on unmount. Engine-private.
import type { Role } from '@freero/shared';
import type { Editor, EditorEvent, FeatureBundle, Host, Point } from '../api';
import { BoardStore } from '../store/BoardStore';
import { createPointerStore, createUiStore, type PointerState, type UiStore } from '../state/uiStore';
import type { StoreApi } from 'zustand/vanilla';
import { buildRegistry, type Registry } from './registry';
import type { ClipboardMemory } from '../editor/clipboard';
import type { TextSession } from '../text/session';
import { EditorImpl } from '../editor/EditorImpl';
import { createBuiltinTools } from '../interaction/builtinTools';
import { createEngineCommands } from '../editor/engineCommands';
import { loadToolOptions, saveToolOptions } from './persist';

export interface ExportOptions {
  ids?: string[];
  rect?: { x: number; y: number; w: number; h: number };
  format: 'png' | 'svg' | 'jpeg';
  scale?: number;
  background?: string | null;
  padding?: number;
  skipFonts?: boolean;
}

export class Emitter {
  private map = new Map<EditorEvent, Set<() => void>>();
  on(ev: EditorEvent, cb: () => void): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }
  emit(ev: EditorEvent) {
    const set = this.map.get(ev);
    if (set) for (const cb of [...set]) cb();
  }
}

export interface EngineCore {
  hostRef: { current: Host };
  store: BoardStore;
  ui: UiStore;
  registry: Registry;
  /** Unscoped ('engine') editor. */
  editor: EditorImpl;
  scoped(scope: string): Editor;
  emitter: Emitter;
  dom: { viewport: HTMLDivElement | null; world: HTMLDivElement | null };
  /** Active rich-text editing session (set by the shared text editor while mounted). */
  text: TextSession | null;
  /** Last known pointer position over the canvas. */
  pointer: StoreApi<PointerState>;
  /** Transient info from the pointer router to the select tool. */
  interaction: { handle: string | null; clickCount: number; cancel: (() => void) | null };
  clipboard: { memory: ClipboardMemory | null; copyIds: string[] | null };
  /** Offscreen renderer, installed by <BoardEngine>. */
  renderExport: ((opts: ExportOptions) => Promise<string>) | null;
  destroy(): void;
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

export function createCore(host: Host, bundles: FeatureBundle[], opts: { persistLocal?: boolean } = {}): EngineCore {
  const store = new BoardStore({ boardId: host.board.id, syncUrl: host.syncUrl, persistLocal: opts.persistLocal });
  const ui = createUiStore({ role: host.board.role });
  const scopedCache = new Map<string, Editor>();
  const disposers: Array<() => void> = [];

  const core = {
    hostRef: { current: host },
    store,
    ui,
    registry: null as unknown as Registry,
    editor: null as unknown as EditorImpl,
    emitter: new Emitter(),
    dom: { viewport: null, world: null },
    text: null,
    pointer: createPointerStore(),
    interaction: { handle: null, clickCount: 1, cancel: null },
    clipboard: { memory: null, copyIds: null },
    renderExport: null,
    scoped(scope: string): Editor {
      if (scope === 'engine') return core.editor;
      let ed = scopedCache.get(scope);
      if (!ed) {
        ed = Object.create(core.editor, { scope: { value: scope, enumerable: true } }) as Editor;
        scopedCache.set(scope, ed);
      }
      return ed;
    },
    destroy() {
      for (const d of disposers) d();
      store.destroy();
    },
  } as EngineCore;

  core.editor = new EditorImpl(core, 'engine');
  try {
    core.registry = buildRegistry(bundles, { tools: createBuiltinTools(core), commands: createEngineCommands(core) });
  } catch (err) {
    store.destroy();
    throw err;
  }

  // ---- restore per-user tool options (e.g. last sticky color)
  ui.setState({ toolOptions: loadToolOptions(), connection: store.status, synced: store.synced });

  // ---- store → ui/events
  disposers.push(
    store.subscribeElements(() => {
      const { selection, editingId, hoverId } = ui.getState();
      if (selection.length && selection.some((id) => !store.getElement(id)))
        ui.setState({ selection: selection.filter((id) => store.getElement(id)) });
      if (editingId && !store.getElement(editingId)) core.editor.stopEditing();
      if (hoverId && !store.getElement(hoverId)) ui.setState({ hoverId: null });
      core.emitter.emit('elements');
    }),
    store.subscribeStatus(() => {
      ui.setState({ connection: store.status, synced: store.synced });
      core.emitter.emit('connection');
    }),
    store.subscribeRole(() => {
      const role = store.serverRole ?? core.hostRef.current.board.role;
      ui.setState({ role });
      // Live role change (e.g. promoted/demoted over REST): drop anything the new role can't do.
      if (ROLE_RANK[role] < ROLE_RANK.editor) {
        if (ui.getState().editingId) core.editor.stopEditing();
        const tool = core.registry.toolsById.get(ui.getState().toolId);
        if (tool && ROLE_RANK[role] < ROLE_RANK[tool.def.minRole ?? 'editor']) core.editor.setTool('select');
        // Local undo history can't be replayed by a read-only role.
        store.undoManager.clear();
      }
      core.emitter.emit('connection');
    }),
    store.subscribePresence(() => {
      ui.setState((s) => ({ presenceVersion: s.presenceVersion + 1 }));
      core.emitter.emit('presence');
    }),
    store.subscribeUndo(() => ui.setState((s) => ({ undoVersion: s.undoVersion + 1 }))),
    store.subscribeSettings(() => ui.setState((s) => ({ settingsVersion: s.settingsVersion + 1 }))),
  );

  // ---- ui → events + presence
  let viewportTimer: ReturnType<typeof setTimeout> | null = null;
  const publishViewport = () => {
    viewportTimer = null;
    const { camera, viewport } = ui.getState();
    store.setPresence({ viewport: { ...camera, width: viewport.width, height: viewport.height } });
  };
  disposers.push(
    ui.subscribe((s, prev) => {
      if (s.selection !== prev.selection) {
        core.emitter.emit('selection');
        store.setPresence({ selection: s.selection });
      }
      if (s.camera !== prev.camera || s.viewport !== prev.viewport) {
        core.emitter.emit('camera');
        if (!viewportTimer) viewportTimer = setTimeout(publishViewport, 200);
      }
      if (s.toolId !== prev.toolId) core.emitter.emit('tool');
      if (s.editingId !== prev.editingId) {
        core.emitter.emit('editing');
        store.setPresence({ editingId: s.editingId });
      }
      if (s.toolOptions !== prev.toolOptions) saveToolOptions(s.toolOptions);
    }),
    () => {
      if (viewportTimer) clearTimeout(viewportTimer);
    },
  );

  const u = host.user;
  store.setPresence({
    user: { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl },
    cursor: null,
    selection: [],
    viewport: null,
    ext: {},
    editingId: null,
  });

  return core;
}
