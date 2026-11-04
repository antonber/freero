// World layer: one transformed container; each element is a memoized view that subscribes to
// its own element. The list itself only re-renders when the set/order of visible ids changes.
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { EyeOff } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { useCore, RenderModeContext, ScopeContext } from '../context';
import { useElement } from '../hooks';
import { quantizeZoom, viewportRect } from '../camera/camera';
import { elementAABB, expandRect, rectContainsRect, rectsIntersect } from '../geometry/geometry';
import type { ChildPresentation, DecorationDefinition, Insets, Rect } from '../api';
import type { EngineCore } from '../runtime/core';
import type { UiState } from '../state/uiStore';
import { drawsLowDetail } from './detail';
import { LowDetailLayer } from './LowDetailLayer';
import { personalViews } from '../runtime/personalViews';

export function cameraTransform(cam: { x: number; y: number; zoom: number }): string {
  return `translate(${-cam.x * cam.zoom}px, ${-cam.y * cam.zoom}px) scale(${cam.zoom})`;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Computes visible ids with a padded cull rect that only moves when the view leaves it; returns
 * them with that rect (what low detail's canvas covers at most).
 */
function useVisibleIds(): { ids: string[]; cull: Rect } {
  const core = useCore();
  const [state, setState] = useState<{ ids: string[]; cull: Rect }>({ ids: [], cull: { x: 0, y: 0, w: 0, h: 0 } });
  useEffect(() => {
    const { store, ui } = core;
    let cullRect: Rect | null = null;
    let cullZoom = 0;
    let prev: string[] = [];
    let disposed = false;
    const compute = (forceList: boolean) => {
      const { camera, viewport, editingId } = ui.getState();
      const view = viewportRect(camera, viewport);
      let moved = false;
      if (
        !cullRect ||
        !rectContainsRect(cullRect, view) ||
        camera.zoom / cullZoom > 1.6 ||
        cullZoom / camera.zoom > 1.6
      ) {
        cullRect = expandRect(view, Math.max(view.w, view.h) * 0.4);
        cullZoom = camera.zoom;
        moved = true;
      }
      if (!moved && !forceList) return;
      // Only the item being edited is kept drawn wherever it is (its text editor holds the focus).
      // Selected items mount like any other (#182): their outlines, the keyboard and the toolbar
      // work from the doc, so selecting everything and zooming in mounts only what is near the view.
      const next: string[] = [];
      for (const el of core.editor.getVisibleElements()) {
        if (el.id === editingId || rectsIntersect(elementAABB(el), cullRect)) next.push(el.id);
      }
      const changed = !sameIds(next, prev);
      if (changed) prev = next;
      if (changed || moved) setState({ ids: prev, cull: cullRect });
    };
    // Element changes are coalesced per task (microtask), so a just-created element mounts in
    // the same frame — e.g. its text editor can take focus before the next keystroke.
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) compute(true);
      });
    };
    compute(true);
    const offStore = store.subscribeElements(schedule);
    // My own view settings can fold items away for me alone (hidesMember with getPersonalView).
    const offMine = core.emitter.on('personal-views', schedule);
    const offUi = ui.subscribe((s, p) => {
      // `dragging`: items folded into a container stay drawn while dragged, and fold when dropped.
      if (s.editingId !== p.editingId || s.viewHidden !== p.viewHidden || s.dragging !== p.dragging) compute(true);

      else if (s.camera !== p.camera || s.viewport !== p.viewport) compute(false);
    });
    return () => {
      offStore();
      offMine();
      offUi();
      disposed = true;
    };
  }, [core]);
  return state;
}

export function WorldElements() {
  const core = useCore();
  const { ids, cull } = useVisibleIds();
  // Into low detail at once (#183): the new, zoomed-out view is never mounted in full first.
  const lowDetail = useStore(core.ui, (s) => s.lowDetail);
  const zoom = useStore(core.ui, (s) => quantizeZoom(s.camera.zoom));
  // Out of it a frame's worth at a time, nearest the pointer first (#184).
  const leavingNow = useLeavingLowDetail(core, lowDetail, ids, zoom);
  const leaving = leavingNow?.still ?? null;
  const editingId = useStore(core.ui, (s) => s.editingId);
  const preview = useStore(core.ui, (s) => s.dragPreview);
  // [additive, #131] Zoomed out: runs of items that paint in low detail go on canvases between the
  // items drawn in full, so render order is kept (canvas/LowDetailLayer.tsx).
  const parts = useMemo(
    () => (lowDetail || leaving ? lowDetailRuns(core, ids, zoom, editingId, preview?.moves ?? null, lowDetail ? null : leaving) : null),
    [core, ids, lowDetail, leaving, zoom, editingId, preview],
  );
  return (
    <WorldViewProvider>
      {parts
        ? parts.flatMap((p) =>
            typeof p === 'string'
              ? [<ElementView key={p} id={p} />]
              : [
                  <LowDetailLayer key={`low:${p.ids[0]}`} ids={p.painted ?? p.ids} cull={cull} zoom={leavingNow?.zoom ?? zoom} />,
                  // Leaving low detail: what this run's canvas no longer paints is drawn in full
                  // right after it (for a few frames, above the run's other items).
                  ...(p.painted ? p.ids.filter((id) => !leaving?.has(id)).map((id) => <ElementView key={id} id={id} />) : []),
                ],
          )
        : ids.map((id) => <ElementView key={id} id={id} />)}
    </WorldViewProvider>
  );
}

/** Leaving low detail: items mounted in the first frame, and the bounds the batch adapts within. */
const LEAVE_BATCH = { first: 60, min: 40, max: 400 } as const;
/** The frame time batches aim at (ms): each is sized by how long the last frame took. */
const LEAVE_FRAME_MS = 20;

/**
 * [#184] Leaving low detail mounts every item in view: instead of all at once, the items the
 * canvas painted keep being painted and mount a frame's worth at a time, nearest the pointer (or
 * the middle of the view) first, each batch sized by how long the last frame took. Returns the
 * items still painted (null once none is, or while in low detail) and the zoom low detail was left
 * at: the canvases keep that resolution meanwhile, so leaving repaints none of them in full.
 * Derived during the render that leaves low detail, so no frame mounts them all.
 */
function useLeavingLowDetail(core: EngineCore, lowDetail: boolean, ids: string[], zoom: number): { still: ReadonlySet<string>; zoom: number } | null {
  const [state, setState] = useState<{ low: boolean; queue: string[] | null; done: number; zoom: number }>(() => ({ low: lowDetail, queue: null, done: 0, zoom }));
  const lowZoom = useRef(zoom);
  let s = state;
  if (s.low !== lowDetail) {
    s = { low: lowDetail, queue: lowDetail ? null : nearestFirst(core, ids), done: 0, zoom: lowZoom.current };
    setState(s);
  }
  if (lowDetail) lowZoom.current = zoom;
  const { queue, done } = s;
  useEffect(() => {
    if (!queue) return;
    let batch: number = LEAVE_BATCH.first;
    let last = 0;
    let frame = 0;
    const step = (now: number) => {
      if (last) batch = Math.max(LEAVE_BATCH.min, Math.min(LEAVE_BATCH.max, batch * 2, (batch * LEAVE_FRAME_MS) / Math.max(1, now - last)));
      last = now;
      setState((p) => {
        if (p.queue !== queue) return p;
        const next = p.done + Math.round(batch);
        return next >= queue.length ? { ...p, queue: null, done: 0 } : { ...p, done: next };
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [queue]);
  return useMemo(() => (queue && done < queue.length ? { still: new Set(queue.slice(done)), zoom: s.zoom } : null), [queue, done, s.zoom]);
}

/** The items of `ids` a canvas can paint, nearest first to the pointer (or the middle of the view). */
function nearestFirst(core: EngineCore, ids: readonly string[]): string[] {
  const { camera, viewport } = core.ui.getState();
  const p = core.pointer.getState();
  const view = viewportRect(camera, viewport);
  const at = (p.inside && p.world) || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const out: Array<{ id: string; d: number }> = [];
  for (const id of ids) {
    const el = core.store.getElement(id);
    if (!el || !core.registry.elements.get(el.type)?.def.lowDetail) continue;
    const dx = el.x + el.w / 2 - at.x;
    const dy = el.y + el.h / 2 - at.y;
    out.push({ id, d: dx * dx + dy * dy });
  }
  return out.sort((a, b) => a.d - b.d).map((x) => x.id);
}

/** Items next to each other in render order that one canvas paints (`painted`: leaving low detail, those it still paints). */
interface LowDetailRun {
  ids: string[];
  painted?: string[];
}

/**
 * `ids` (render order) split into items drawn in full (their id) and runs of items painted in
 * low detail: those whose type paints itself (ElementDefinition.lowDetail), small on screen, not
 * edited, not making room for a drag and not in my private layer (its dashed mark is the item's
 * own DOM). `leaving` (#184): leaving low detail, only these are still painted, and the runs keep
 * the shape they had, so their canvases stay put while the rest mount.
 */
function lowDetailRuns(
  core: EngineCore,
  ids: string[],
  zoom: number,
  editingId: string | null,
  moves: ReadonlyMap<string, unknown> | null,
  leaving: ReadonlySet<string> | null,
): Array<string | LowDetailRun> {
  const out: Array<string | LowDetailRun> = [];
  let run: LowDetailRun | null = null;
  for (const id of ids) {
    const el = core.store.getElement(id);
    const low =
      !!el &&
      // Leaving: an item mounted already only joins a run that something still painted started.
      (!leaving || leaving.has(id) || !!run) &&
      !!core.registry.elements.get(el.type)?.def.lowDetail &&
      id !== editingId &&
      !moves?.has(id) &&
      drawsLowDetail(true, el.w, el.h, zoom) &&
      core.store.layerOf(id) !== 'private';
    if (low) {
      if (!run) out.push((run = leaving ? { ids: [], painted: [] } : { ids: [] }));
      run.ids.push(id);
      if (leaving?.has(id)) run.painted!.push(id);
    } else {
      run = null;
      out.push(id);
    }
  }
  return out;
}

/**
 * What every item of the world layer draws with: the quantized zoom and the item this viewer
 * focuses on. Read once here instead of by each item, so a camera move
 * costs the items nothing until one of these changes.
 */
interface WorldView {
  zoom: number;
  focusId: string | null;
  focusHide: boolean;
}
const WorldViewContext = createContext<WorldView>({ zoom: 1, focusId: null, focusHide: false });

export function WorldViewProvider({ children }: { children: ReactNode }) {
  const core = useCore();
  const zoom = useStore(core.ui, (s) => quantizeZoom(s.camera.zoom));
  const focusId = useStore(core.ui, (s) => s.focusId);
  const focusHide = useStore(core.ui, (s) => s.focusHide);
  const value = useMemo(() => ({ zoom, focusId, focusHide }), [zoom, focusId, focusHide]);
  return <WorldViewContext.Provider value={value}>{children}</WorldViewContext.Provider>;
}

/**
 * Each item's own view state (selected, edited, drawn elsewhere while a drag makes room) from ONE
 * subscription to the ui store: an item re-renders only when its own state changes. Selecting
 * everything is one pass over the selection, not a scan of it per item, and a camera move — a ui
 * change every frame — asks the items nothing.
 */
class ItemStates {
  private listeners = new Map<string, Set<() => void>>();
  private selection: readonly string[] = [];
  private selected: ReadonlySet<string> = new Set();
  private editingId: string | null = null;
  private moves: ReadonlyMap<string, { x: number; y: number }> | null = null;
  private members: ReadonlySet<string> | null = null;

  constructor(ui: EngineCore['ui']) {
    this.apply(ui.getState());
    ui.subscribe((s) => this.apply(s));
  }

  isSelected = (id: string) => this.selected.has(id);
  isEditing = (id: string) => this.editingId === id;
  shownAt = (id: string) => this.moves?.get(id) ?? null;
  isSliding = (id: string) => !!this.members?.has(id);

  subscribe(id: string, cb: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (!set.size) this.listeners.delete(id);
    };
  }

  private apply(s: UiState) {
    const changed = new Set<string>();
    if (s.selection !== this.selection) {
      const next = new Set(s.selection);
      for (const id of next) if (!this.selected.has(id)) changed.add(id);
      for (const id of this.selected) if (!next.has(id)) changed.add(id);
      this.selection = s.selection;
      this.selected = next;
    }
    if (s.editingId !== this.editingId) {
      if (this.editingId) changed.add(this.editingId);
      if (s.editingId) changed.add(s.editingId);
      this.editingId = s.editingId;
    }
    const moves = s.dragPreview?.moves ?? null;
    if (moves !== this.moves) {
      for (const [id, at] of moves ?? []) {
        const was = this.moves?.get(id);
        if (!was || was.x !== at.x || was.y !== at.y) changed.add(id);
      }
      for (const id of this.moves?.keys() ?? []) if (!moves?.has(id)) changed.add(id);
      this.moves = moves;
    }
    const members = s.dragPreview?.members ?? null;
    if (members !== this.members) {
      for (const id of members ?? []) if (!this.members?.has(id)) changed.add(id);
      for (const id of this.members ?? []) if (!members?.has(id)) changed.add(id);
      this.members = members;
    }
    for (const id of changed) for (const cb of this.listeners.get(id) ?? []) cb();
  }
}

const itemStatesOf = new WeakMap<EngineCore, ItemStates>();
function itemStates(core: EngineCore): ItemStates {
  let s = itemStatesOf.get(core);
  if (!s) itemStatesOf.set(core, (s = new ItemStates(core.ui)));
  return s;
}

export const ElementView = memo(function ElementView({ id }: { id: string }) {
  const core = useCore();
  const el = useElement(id);
  const items = itemStates(core);
  const subscribe = useCallback((cb: () => void) => items.subscribe(id, cb), [items, id]);
  const selected = useSyncExternalStore(subscribe, () => items.isSelected(id));
  const editing = useSyncExternalStore(subscribe, () => items.isEditing(id));
  // [additive] While items are dragged over its container: where it is drawn to make room, and
  // whether it slides there (ElementDefinition.dragPreview). Display only, never written.
  const shownAt = useSyncExternalStore(subscribe, () => items.shownAt(id));
  const sliding = useSyncExternalStore(subscribe, () => items.isSliding(id));
  const { zoom, focusId, focusHide } = useContext(WorldViewContext);
  // [additive, #117] Outside the item this viewer focuses on (Editor.setFocus): faded and inert.
  // [#135] or, with "hide the rest", not drawn at all.
  const unfocused = useMemo(() => (!!focusId && !!el && !core.editor.inFocus(el) ? (focusHide ? 'hidden' : 'faded') : null), [core, focusId, focusHide, el]);
  if (!el) return null;
  return <ElementFrame element={el} selected={selected} editing={editing} zoom={zoom} shownAt={shownAt} sliding={sliding} unfocused={unfocused} />;
});

/**
 * Positions an element and renders its definition's Component inside the feature's scope, then
 * any decorations (decoration.tsx of other features) inside the same wrapper, so they move,
 * rotate and export with it.
 */
export function ElementFrame(props: {
  element: BoardElement;
  selected: boolean;
  editing: boolean;
  zoom: number;
  preview?: boolean;
  /** Drawn here instead of at its own position (making room for a drag), see ElementView. */
  shownAt?: { x: number; y: number } | null;
  /** Slides (animated) between its own position and `shownAt`. */
  sliding?: boolean;
  /** [additive] Outside this viewer's focus (Editor.setFocus): drawn faded, or [#135] not at all. */
  unfocused?: 'faded' | 'hidden' | null;
}) {
  const core = useCore();
  const { element: el } = props;
  const reg = core.registry.elements.get(el.type);
  const at = props.shownAt ?? el;
  // Placed with left / top, turned with a transform only when rotated: a transform per item is a
  // paint property node per item, and Chrome's layerization of ten thousand of them took seconds
  // a frame on a 10,000-item board (docs/performance.md).
  const transform = el.rotation ? `rotate(${el.rotation}deg)` : undefined;
  const decorations = core.registry.decorations.filter((d) => d.def.appliesTo(el));
  // In this user's private layer (private mode): nobody else can see it until it is revealed.
  const isPrivate = useContext(RenderModeContext) !== 'export' && core.store.layerOf(el.id) === 'private';
  // Recomputed only when the element changes, so memoized element components keep bailing out.
  const reserved = useMemo(() => reservedInsets(core.registry.decorations.map((d) => d.def), el), [el, core.registry]);
  const presentation = usePresentation(el);
  let content: ReactNode;
  if (!reg) {
    content = <div className="fr-el-unknown">Unsupported item ({el.type})</div>;
  } else {
    const C = reg.def.Component;
    content = (
      <ScopeContext.Provider value={reg.feature}>
        <C element={el} selected={props.selected} editing={props.editing} zoom={props.zoom} reserved={reserved} presentation={presentation} />
      </ScopeContext.Provider>
    );
  }
  return (
    <div
      className={`fr-el${props.editing ? ' fr-el--editing' : ''}${isPrivate ? ' fr-el--private' : ''}${props.preview ? ' fr-el--preview fr-paper' : ''}${props.sliding ? ' fr-el--sliding' : ''}${props.unfocused === 'faded' ? ' fr-el--unfocused' : props.unfocused === 'hidden' ? ' fr-el--outside' : ''}`}
      data-id={props.preview ? undefined : el.id}
      data-type={el.type}
      style={{ ...reg?.def.wrapperStyle?.(el as never), left: at.x, top: at.y, width: el.w, height: el.h, transform }}
    >
      {content}
      {decorations.map(({ def, feature }) => (
        <ScopeContext.Provider key={def.id} value={feature}>
          <def.Component element={el} zoom={props.zoom} />
        </ScopeContext.Provider>
      ))}
      {isPrivate && (
        <span className="fr-el-private-chip" title="Only you can see this until it is revealed" style={{ transform: `scale(${1 / Math.max(props.zoom, 0.5)})` }}>
          <EyeOff size={11} strokeWidth={2.5} aria-hidden />
          Only you
        </span>
      )}
    </div>
  );
}

/**
 * [additive] An element drawn as it would look, without being on the board (suggestions,
 * KAI-169): its own component and decorations, never selected or edited, not hit-tested (the
 * world layer is geometric), no on-screen affordances (rendered like an export). World
 * coordinates: render it in a 'world-overlay' panel.
 */
export function ElementPreview({ element }: { element: BoardElement }) {
  const core = useCore();
  const zoom = useStore(core.ui, (s) => quantizeZoom(s.camera.zoom));
  return (
    <RenderModeContext.Provider value="export">
      <ElementFrame element={element} selected={false} editing={false} zoom={zoom} preview />
    </RenderModeContext.Provider>
  );
}

/**
 * [additive] How the element's container wants it shown (ElementDefinition.presentChild), with this
 * viewer's own view settings. Re-computed when the element, its container or those settings
 * change, and kept as the same object while it reads the same, so memoized element components
 * keep bailing out when the container changes something else (its height after a drop).
 */
function usePresentation(el: BoardElement): ChildPresentation | null {
  const core = useCore();
  const presents = core.registry.presents && !!el.frameId;
  const container = useElement(presents ? el.frameId : null);
  const mine = useStore(personalViews(core).state, (s) => (presents && el.frameId ? s[el.frameId] : undefined));
  const last = useRef<{ key: string; value: ChildPresentation | null }>({ key: '', value: null });
  return useMemo(() => {
    const reg = container && core.registry.elements.get(container.type);
    const value = reg?.def.presentChild ? reg.def.presentChild(container as never, el, { editor: core.scoped(reg.feature), personal: true }) : null;
    const key = value ? JSON.stringify(value) : '';
    if (key !== last.current.key) last.current = { key, value };
    return last.current.value;
    // `mine` is read through the editor inside presentChild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, container, el, mine]);
}

/** Per-side maximum of what the decorations applying to `el` reserve; undefined when none does. */
export function reservedInsets(decorations: readonly DecorationDefinition[], el: BoardElement): Insets | undefined {
  let out: Insets | undefined;
  for (const d of decorations) {
    const r = d.reserve && d.appliesTo(el) ? d.reserve(el) : undefined;
    if (!r) continue;
    out ??= { top: 0, right: 0, bottom: 0, left: 0 };
    out.top = Math.max(out.top, r.top ?? 0);
    out.right = Math.max(out.right, r.right ?? 0);
    out.bottom = Math.max(out.bottom, r.bottom ?? 0);
    out.left = Math.max(out.left, r.left ?? 0);
  }
  return out;
}

/** Applies the camera transform imperatively (no React render per frame). */
export function useWorldTransform(ref: React.RefObject<HTMLDivElement>) {
  const core = useCore();
  const applied = useRef('');
  useEffect(() => {
    const apply = () => {
      const t = cameraTransform(core.ui.getState().camera);
      if (ref.current && t !== applied.current) {
        ref.current.style.transform = t;
        applied.current = t;
      }
    };
    apply();
    return core.ui.subscribe((s, p) => {
      if (s.camera !== p.camera) apply();
      if (s.cameraMoving !== p.cameraMoving && ref.current) ref.current.classList.toggle('is-moving', s.cameraMoving);
    });
  }, [core, ref]);
}
