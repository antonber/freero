// World layer: one transformed container; each element is a memoized view that subscribes to
// its own element. The list itself only re-renders when the set/order of visible ids changes.
import { memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { EyeOff } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { useCore, RenderModeContext, ScopeContext } from '../context';
import { useElement } from '../hooks';
import { quantizeZoom, viewportRect } from '../camera/camera';
import { elementAABB, expandRect, rectContainsRect, rectsIntersect } from '../geometry/geometry';
import type { ChildPresentation, DecorationDefinition, Insets, Rect } from '../api';
import { personalViews } from '../runtime/personalViews';

export function cameraTransform(cam: { x: number; y: number; zoom: number }): string {
  return `translate(${-cam.x * cam.zoom}px, ${-cam.y * cam.zoom}px) scale(${cam.zoom})`;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Computes visible ids with a padded cull rect that only moves when the view leaves it. */
function useVisibleIds(): string[] {
  const core = useCore();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const { store, ui } = core;
    let cullRect: Rect | null = null;
    let cullZoom = 0;
    let prev: string[] = [];
    let disposed = false;
    const compute = (forceList: boolean) => {
      const { camera, viewport, selection, editingId } = ui.getState();
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
      const keep = new Set(selection);
      if (editingId) keep.add(editingId);
      const next: string[] = [];
      for (const el of core.editor.getVisibleElements()) {
        if (keep.has(el.id) || rectsIntersect(elementAABB(el), cullRect)) next.push(el.id);
      }
      if (!sameIds(next, prev)) {
        prev = next;
        setIds(next);
      }
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
      if (s.selection !== p.selection || s.editingId !== p.editingId || s.viewHidden !== p.viewHidden || s.dragging !== p.dragging) compute(true);

      else if (s.camera !== p.camera || s.viewport !== p.viewport) compute(false);
    });
    return () => {
      offStore();
      offMine();
      offUi();
      disposed = true;
    };
  }, [core]);
  return ids;
}

export function WorldElements() {
  const ids = useVisibleIds();
  return (
    <>
      {ids.map((id) => (
        <ElementView key={id} id={id} />
      ))}
    </>
  );
}

export const ElementView = memo(function ElementView({ id }: { id: string }) {
  const core = useCore();
  const el = useElement(id);
  const selected = useStore(core.ui, (s) => s.selection.includes(id));
  const editing = useStore(core.ui, (s) => s.editingId === id);
  const zoom = useStore(core.ui, (s) => quantizeZoom(s.camera.zoom));
  // [additive] While items are dragged over its container: where it is drawn to make room, and
  // whether it slides there (ElementDefinition.dragPreview). Display only, never written.
  const shownAt = useStore(core.ui, (s) => s.dragPreview?.moves.get(id) ?? null);
  const sliding = useStore(core.ui, (s) => !!s.dragPreview?.members.has(id));
  // [additive, #117] Outside the item this viewer focuses on (Editor.setFocus): faded and inert.
  const focusId = useStore(core.ui, (s) => s.focusId);
  const unfocused = useMemo(() => !!focusId && !!el && !core.editor.inFocus(el), [core, focusId, el]);
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
  /** [additive] Outside this viewer's focus (Editor.setFocus): drawn faded. */
  unfocused?: boolean;
}) {
  const core = useCore();
  const { element: el } = props;
  const reg = core.registry.elements.get(el.type);
  const at = props.shownAt ?? el;
  const transform = `translate(${at.x}px, ${at.y}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`;
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
      className={`fr-el${props.editing ? ' fr-el--editing' : ''}${isPrivate ? ' fr-el--private' : ''}${props.preview ? ' fr-el--preview fr-paper' : ''}${props.sliding ? ' fr-el--sliding' : ''}${props.unfocused ? ' fr-el--unfocused' : ''}`}
      data-id={props.preview ? undefined : el.id}
      data-type={el.type}
      style={{ ...reg?.def.wrapperStyle?.(el as never), width: el.w, height: el.h, transform }}
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
