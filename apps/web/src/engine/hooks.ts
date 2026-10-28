// Reactive hooks for features and engine chrome. All re-render minimally:
// useElement(id) only re-renders when that element's object changes.
import { useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { BoardElement, BoardSettings, ElementType, PresenceState, Role, SessionLimits } from '@freero/shared';
import type { Camera, Collection, Editor, FollowTarget, Point, Rect } from './api';
import { RenderModeContext, ScopeContext, useCore } from './context';
import type { UiState } from './state/uiStore';
import { toolGhostAt } from './interaction/toolDispatch';
import type { TextFormatState } from './text/session';

/**
 * [additive] True while rendering offscreen for an image export / thumbnail: element and
 * decoration components leave out on-screen-only affordances (link badges, hover controls).
 */
export function useIsExporting(): boolean {
  return useContext(RenderModeContext) === 'export';
}

/** The Editor, scoped to the feature whose component calls it. */
export function useEditor(): Editor {
  const core = useCore();
  const scope = useContext(ScopeContext);
  return core.scoped(scope);
}

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(useCore().ui, selector);
}

export function useElement<T extends BoardElement = BoardElement>(id: string | null | undefined): T | undefined {
  const { store } = useCore();
  const subscribe = useCallback((cb: () => void) => (id ? store.subscribeElement(id, cb) : () => undefined), [store, id]);
  const get = useCallback(() => (id ? (store.getElement(id) as T | undefined) : undefined), [store, id]);
  return useSyncExternalStore(subscribe, get);
}

/** All elements in render order, or only those of `type`. Re-renders on any element change. */
export function useElements(type?: ElementType): BoardElement[] {
  const { store } = useCore();
  const subscribe = useCallback((cb: () => void) => store.subscribeElements(cb), [store]);
  const get = useCallback(() => (type ? store.getOrderedOfType(type) : store.getOrdered()), [store, type]);
  return useSyncExternalStore(subscribe, get);
}

/**
 * [additive] A value derived from all elements (in render order) that re-renders the caller only
 * when `isEqual` says it changed — e.g. the boxes a connector routes around, without redrawing
 * every connector on every edit elsewhere. `select` runs after every element change: keep it
 * cheap (memoize per elements array). Pass a new `select` (useCallback deps) when its inputs change.
 */
export function useElementsQuery<T>(select: (elements: BoardElement[]) => T, isEqual: (a: T, b: T) => boolean): T {
  const { store } = useCore();
  const cache = useRef<{ src: BoardElement[]; select: (elements: BoardElement[]) => T; value: T } | null>(null);
  const subscribe = useCallback((cb: () => void) => store.subscribeElements(cb), [store]);
  const get = () => {
    const src = store.getOrdered();
    const c = cache.current;
    if (c && c.src === src && c.select === select) return c.value;
    const next = select(src);
    const value = c && isEqual(c.value, next) ? c.value : next;
    cache.current = { src, select, value };
    return value;
  };
  return useSyncExternalStore(subscribe, get);
}

/** [additive] Screen rect (viewport px) of the contextual format toolbar, or null while it's hidden. */
export function useFormatToolbarRect(): Rect | null {
  return useUi((s) => s.formatToolbarRect);
}

export function useSelection(): string[] {
  return useUi((s) => s.selection);
}

/** Selected elements (re-renders when the selection or a selected element changes). */
export function useSelectedElements(): BoardElement[] {
  const core = useCore();
  const selection = useSelection();
  const cache = useRef<BoardElement[]>([]);
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = selection.map((id) => core.store.subscribeElement(id, cb));
      return () => offs.forEach((o) => o());
    },
    [core, selection],
  );
  const get = useCallback(() => {
    const next = selection.map((id) => core.store.getElement(id)).filter((e): e is BoardElement => !!e);
    const prev = cache.current;
    if (prev.length === next.length && prev.every((e, i) => e === next[i])) return prev;
    cache.current = next;
    return next;
  }, [core, selection]);
  return useSyncExternalStore(subscribe, get);
}

export function useCamera(): Camera {
  return useUi((s) => s.camera);
}

export function useToolId(): string {
  return useUi((s) => s.toolId);
}

const EMPTY = Object.freeze({});
export function useToolOptions<T = Record<string, unknown>>(toolId: string): T {
  return useUi((s) => (s.toolOptions[toolId] ?? EMPTY) as T);
}

/** Entries of a feature collection; re-renders when it changes. */
export function useCollection<T>(name: string): Array<[string, T]> {
  const editor = useEditor();
  const coll = useMemo(() => editor.collection<T>(name), [editor, name]);
  return useCollectionEntries(coll);
}

/** [additive] Entries of this user's private copy of a collection (Editor.privateCollection). */
export function usePrivateCollection<T>(name: string): Array<[string, T]> {
  const editor = useEditor();
  const coll = useMemo(() => editor.privateCollection<T>(name), [editor, name]);
  return useCollectionEntries(coll);
}

function useCollectionEntries<T>(coll: Collection<T>): Array<[string, T]> {
  const cache = useRef<{ version: number; value: Array<[string, T]> }>({ version: -1, value: [] });
  const version = useRef(0);
  const subscribe = useCallback(
    (cb: () => void) =>
      coll.observe(() => {
        version.current++;
        cb();
      }),
    [coll],
  );
  const get = useCallback(() => {
    if (cache.current.version !== version.current) cache.current = { version: version.current, value: coll.entries() };
    return cache.current.value;
  }, [coll]);
  return useSyncExternalStore(subscribe, get);
}

export function usePeers(): Array<PresenceState & { clientId: number }> {
  const core = useCore();
  const v = useUi((s) => s.presenceVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => core.store.getPeers(), [core, v]);
}

export function useRole(): Role {
  return useUi((s) => s.role);
}

export function useEditingId(): string | null {
  return useUi((s) => s.editingId);
}

/** [additive] Part being edited (Editor.startEditing `part`) of the element being edited, or null. */
export function useEditingPart(): string | null {
  return useUi((s) => (s.editingId ? s.editingPart : null));
}

export function useDock(): string | null {
  return useUi((s) => s.dock);
}

// ---- additive hooks (see ARCHITECTURE.md "Engine contract additions")

/** World-space pointer position while it is over the canvas (for tool Preview components). */
export function usePointer(): Point | null {
  const core = useCore();
  return useStore(core.pointer, (s) => (s.inside ? s.world : null));
}

/**
 * [additive] For a creation tool's hover ghost: top-left of a `size` box centered on the pointer,
 * exactly where a click with the active tool would create it — grid snapping included (board
 * setting, the tool's `snapToGrid`, Ctrl/⌘ inverts, Alt disables). Null off the canvas.
 */
export function useToolGhost(size: { w: number; h: number }): Point | null {
  const core = useCore();
  // Re-render on what the placement depends on: pointer + modifiers, grid settings, active tool.
  useStore(core.pointer);
  useUi((s) => s.settingsVersion);
  useUi((s) => s.toolId);
  return toolGhostAt(core, size);
}

/** Rich-text format state at the caret / of the selection; refreshes as the caret moves. */
export function useTextFormatState(): TextFormatState {
  const core = useCore();
  const v = useUi((s) => s.textStateVersion);
  const sel = useUi((s) => s.selection);
  const editing = useUi((s) => s.editingId);
  const elVersion = useSyncExternalStore(
    useCallback((cb: () => void) => core.store.subscribeElements(cb), [core]),
    () => core.store.getVersion(),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => core.editor.getTextFormatState(), [core, v, sel, editing, elVersion]);
}

export function useSettings(): BoardSettings {
  const core = useCore();
  const v = useUi((s) => s.settingsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => core.store.getSettings(), [core, v]);
}

/** True while the board chrome is hidden (presentation mode); see Editor.setChromeHidden. */
export function useChromeHidden(): boolean {
  return useUi((s) => s.chromeHidden);
}

export function useCanEdit(): boolean {
  const role = useRole();
  return role === 'editor' || role === 'owner';
}

/** [additive] Whose view this client follows (Editor.follow), or null. */
export function useFollowing(): FollowTarget | null {
  return useUi((s) => s.following);
}

/** [additive] A facilitator's limits for this user (Editor.getLimits), null when none. */
export function useLimits(): SessionLimits | null {
  return useUi((s) => s.limits);
}

/** [additive] Other people's cursors hidden for this viewer (Editor.setCursorsHidden). */
export function useCursorsHidden(): boolean {
  return useUi((s) => s.cursorsHidden);
}

/** [additive] Ids hidden for this viewer only (Editor.setViewHidden); re-renders when they change. */
export function useViewHidden(): ReadonlySet<string> {
  return useUi((s) => s.viewHidden);
}
