// Built-in select tool: click / shift-click / marquee / move with snapping / resize / rotate /
// double-click to edit. Pointer down → up runs inside one gesture (one undo step).
import type { BoardElement } from '@freero/shared';
import type { Point, Rect, ToolDefinition, ToolPointerEvent } from '../api';
import type { EngineCore } from '../runtime/core';
import {
  boundsOf,
  distance,
  elementAABB,
  rectCenter,
  rectContainsPoint,
  rectContainsRect,
  rectFromPoints,
  rectsIntersect,
  snapAngle,
  worldToLocal,
  expandRect,
} from '../geometry/geometry';
import { snapMove, snapResize } from '../geometry/snap';
import {
  angleFromCenter,
  handleEdges,
  handleUnit,
  isCorner,
  resizeBox,
  rotateBoxAround,
  scaleBoxAround,
  type Box,
  type Handle,
} from '../geometry/transform';
import { translateElement } from '../editor/clipboard';
import { viewportRect } from '../camera/camera';
import { MousePointer2 } from 'lucide-react';

const DRAG_THRESHOLD_PX = 3;
const SNAP_PX = 6;
const MAX_SNAP_CANDIDATES = 400;

type State =
  | { kind: 'idle' }
  | {
      kind: 'pending';
      startScreen: Point;
      start: Point;
      hitId: string;
      ids: string[];
      wasSelected: boolean;
      shift: boolean;
      alt: boolean;
    }
  | {
      kind: 'translate';
      start: Point;
      snapshot: BoardElement[];
      bounds: Rect;
      others: Rect[];
    }
  | { kind: 'marquee'; start: Point; base: string[] }
  | {
      kind: 'resize';
      handle: Handle;
      grab: Point;
      single: boolean;
      startBox: Box;
      snapshot: BoardElement[];
      others: Rect[];
    }
  | { kind: 'rotate'; pivot: Point; startAngle: number; snapshot: BoardElement[]; single: boolean };

export function createSelectTool(core: EngineCore): ToolDefinition {
  let state: State = { kind: 'idle' };
  const ed = () => core.editor;
  const def = (el: BoardElement) => core.editor.getDefinition(el.type);
  /** [additive] The text part of `el` under world point `p` (ElementDefinition.textPartAt), or null. */
  const partAt = (el: BoardElement, p: Point): string | null => {
    const reg = core.registry.elements.get(el.type);
    if (!reg?.def.textPartAt) return null;
    return reg.def.textPartAt(el as never, worldToLocal(el, p), { editor: core.scoped(reg.feature), zoom: core.editor.getCamera().zoom });
  };
  /** Edits the text part under `p`, else the element's textField. False when there is nothing to edit. */
  const editAt = (el: BoardElement, p: Point): boolean => {
    const part = partAt(el, p);
    if (part) ed().startEditing(el.id, { part });
    else if (def(el)?.textField) ed().startEditing(el.id);
    else return false;
    return true;
  };
  const ui = core.ui;

  const zoom = () => ui.getState().camera.zoom;

  /** Rects of nearby, non-moving elements for snapping (visible area only, capped). */
  function snapCandidates(exclude: Set<string>): Rect[] {
    const { camera, viewport } = ui.getState();
    const view = expandRect(viewportRect(camera, viewport), 100 / camera.zoom);
    const out: Rect[] = [];
    for (const el of ed().getVisibleElements()) {
      if (exclude.has(el.id)) continue;
      const r = elementAABB(el);
      if (!rectsIntersect(r, view)) continue;
      out.push(r);
      if (out.length >= MAX_SNAP_CANDIDATES) break;
    }
    return out;
  }

  /**
   * Grid step to snap to, or undefined: the board's snap-to-grid setting, inverted while Ctrl/⌘
   * is held during the drag (a temporary "snap to grid" / "snap freely").
   */
  function gridStep(e: ToolPointerEvent): number | undefined {
    const s = core.store.getSettings();
    return s.snapToGrid !== e.metaKey ? s.gridSize : undefined;
  }

  function movableSelection(): BoardElement[] {
    const ids = ed().withChildren(ed().getSelection());
    return ids.map((id) => ed().getElement(id)!).filter((el) => el && !el.locked);
  }

  function beginTranslate(start: Point, alt: boolean) {
    if (!ed().can('editor')) return (state = { kind: 'idle' });
    if (alt) {
      const sel = ed().getSelection().filter((id) => !ed().getElement(id)?.locked);
      if (sel.length) ed().duplicate(sel, { x: 0, y: 0 });
    }
    const snapshot = movableSelection();
    if (!snapshot.length) return (state = { kind: 'idle' });
    const bounds = boundsOf(snapshot)!;
    state = {
      kind: 'translate',
      start,
      snapshot,
      bounds,
      others: snapCandidates(new Set(snapshot.map((e) => e.id))),
    };
    ui.setState({ transforming: 'translate', hoverId: null });
  }

  /** After a move: elements dropped into a container join it; dragged out, they leave. */
  function updateMembership(movedIds: string[]) {
    const moved = new Set(movedIds);
    const patches: Array<{ id: string; patch: { frameId: string | null } }> = [];
    for (const id of movedIds) {
      const el = ed().getElement(id);
      if (!el || def(el)?.container) continue;
      if (el.frameId && moved.has(el.frameId)) continue; // travels with its frame
      const frame = ed().containerAt(rectCenter(elementAABB(el)), moved);
      const fid = frame?.id ?? null;
      if ((el.frameId ?? null) !== fid) patches.push({ id, patch: { frameId: fid } });
    }
    if (patches.length) ed().updateMany(patches);
  }

  /** After a container resize: adopt elements now inside it, release ones now outside. */
  function updateContainerChildren(containerId: string) {
    const frame = ed().getElement(containerId);
    if (!frame) return;
    const r = elementAABB(frame);
    const patches: Array<{ id: string; patch: { frameId: string | null } }> = [];
    for (const el of ed().getElements()) {
      if (el.id === containerId || def(el)?.container) continue;
      const inside = rectContainsPoint(r, rectCenter(elementAABB(el)));
      if (el.frameId === containerId && !inside) patches.push({ id: el.id, patch: { frameId: null } });
      else if (!el.frameId && inside) patches.push({ id: el.id, patch: { frameId: containerId } });
    }
    if (patches.length) ed().updateMany(patches);
  }

  function selectionBox(els: BoardElement[]): { box: Box; single: boolean } | null {
    if (els.length === 1) {
      const e = els[0];
      return { box: { x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation || 0 }, single: true };
    }
    const b = boundsOf(els);
    return b ? { box: { ...b, rotation: 0 }, single: false } : null;
  }

  function beginResize(handle: Handle, point: Point) {
    const sel = ed()
      .getSelection()
      .map((id) => ed().getElement(id)!)
      .filter(Boolean);
    if (!sel.length || sel.some((e) => e.locked)) return;
    const sb = selectionBox(sel);
    if (!sb) return;
    const u = handleUnit(handle);
    const local = worldToLocal(sb.box, point);
    const grab = { x: local.x - u.x * sb.box.w, y: local.y - u.y * sb.box.h };
    const scaled = sb.single ? sel : ed().withChildren(sel.map((e) => e.id)).map((id) => ed().getElement(id)!);
    state = {
      kind: 'resize',
      handle,
      grab,
      single: sb.single,
      startBox: sb.box,
      snapshot: scaled,
      others: snapCandidates(new Set(scaled.map((e) => e.id))),
    };
    ui.setState({ transforming: 'resize', hoverId: null });
  }

  function beginRotate(point: Point) {
    const sel = ed()
      .getSelection()
      .map((id) => ed().getElement(id)!)
      .filter((e) => e && !e.locked && def(e)?.rotatable !== false);
    if (!sel.length) return;
    const single = sel.length === 1;
    const pivot = single ? rectCenter(sel[0]) : rectCenter(boundsOf(sel)!);
    state = { kind: 'rotate', pivot, startAngle: angleFromCenter(pivot, point), snapshot: sel, single };
    ui.setState({ transforming: 'rotate', hoverId: null });
  }

  function applyTranslate(s: Extract<State, { kind: 'translate' }>, e: ToolPointerEvent) {
    let dx = e.point.x - s.start.x;
    let dy = e.point.y - s.start.y;
    let guides: ReturnType<typeof snapMove>['guides'] = [];
    let gaps: ReturnType<typeof snapMove>['gaps'] = [];
    if (!e.altKey) {
      const moved = { ...s.bounds, x: s.bounds.x + dx, y: s.bounds.y + dy };
      const snap = snapMove(moved, s.others, SNAP_PX / zoom(), { grid: gridStep(e) });
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
      gaps = snap.gaps;
    }
    dx = Math.round(dx * 100) / 100;
    dy = Math.round(dy * 100) / 100;
    ed().updateMany(
      s.snapshot.map((el) => {
        const t = translateElement(el, dx, dy);
        const patch: Record<string, unknown> = { x: t.x, y: t.y };
        if (el.type === 'connector') {
          const c = t as Extract<BoardElement, { type: 'connector' }>;
          patch.start = c.start;
          patch.end = c.end;
          if (c.waypoints) patch.waypoints = c.waypoints;
        }
        return { id: el.id, patch };
      }),
    );
    const moved = new Set(s.snapshot.map((x) => x.id));
    const anyContainer = s.snapshot.some((el) => def(el)?.container);
    const drop = anyContainer ? null : ed().containerAt(e.point, moved);
    ui.setState({ guides, gaps, dropTargetId: drop?.id ?? null });
  }

  function applyResize(s: Extract<State, { kind: 'resize' }>, e: ToolPointerEvent) {
    const corner = isCorner(s.handle);
    if (s.single) {
      const el = s.snapshot[0];
      const d = def(el);
      const mode = d?.resize ?? 'free';
      const min = d?.minSize ?? { w: 8, h: 8 };
      const keepAspect = mode === 'aspect' || (mode === 'scale' && corner) || (e.shiftKey && mode === 'free');
      const widthOnly = mode === 'width-only' || (mode === 'scale' && !corner);
      const r = resizeBox(s.startBox, s.handle, e.point, s.grab, { keepAspect, minW: min.w, minH: min.h, widthOnly });
      let box = r.box;
      let guides: ReturnType<typeof snapResize>['guides'] = [];
      if (!e.altKey && !keepAspect && !(el.rotation % 360)) {
        const snapped = snapResize(box, handleEdges(s.handle), s.others, SNAP_PX / zoom(), { grid: gridStep(e) });
        if (snapped.rect.w >= min.w && snapped.rect.h >= min.h) {
          box = { ...snapped.rect, rotation: box.rotation };
          guides = snapped.guides;
        }
      }
      const patch: Record<string, unknown> = { x: box.x, y: box.y, w: box.w, h: widthOnly ? el.h : box.h };
      const fs = (el as { fontSize?: unknown }).fontSize;
      if (mode === 'scale' && corner && typeof fs === 'number') patch.fontSize = Math.round(fs * r.sx * 10) / 10;
      ed().update(el.id, patch);
      ui.setState({
        guides,
        hint: { text: `${Math.round(box.w)} × ${Math.round(widthOnly ? el.h : box.h)}`, x: e.screen.x, y: e.screen.y },
      });
      return;
    }
    // Group: uniform scale around the opposite corner.
    const r = resizeBox(s.startBox, s.handle, e.point, s.grab, { keepAspect: true, minW: 16, minH: 16 });
    const sf = r.sx;
    const anchorU = handleUnit(s.handle);
    const anchor = {
      x: s.startBox.x + (1 - anchorU.x) * s.startBox.w,
      y: s.startBox.y + (1 - anchorU.y) * s.startBox.h,
    };
    ed().updateMany(
      s.snapshot.map((el) => {
        const mode = def(el)?.resize ?? 'free';
        const b = scaleBoxAround(el, anchor, sf, mode === 'none');
        const patch: Record<string, unknown> = { x: b.x, y: b.y, w: b.w, h: b.h };
        const fs = (el as { fontSize?: unknown }).fontSize;
        if (mode === 'scale' && typeof fs === 'number') patch.fontSize = Math.round(fs * sf * 10) / 10;
        if (el.type === 'connector') {
          const sc = (p: Point) => ({ x: anchor.x + (p.x - anchor.x) * sf, y: anchor.y + (p.y - anchor.y) * sf });
          patch.start = { ...el.start, ...sc(el.start) };
          patch.end = { ...el.end, ...sc(el.end) };
        }
        return { id: el.id, patch };
      }),
    );
    ui.setState({ hint: { text: `${Math.round(sf * 100)}%`, x: e.screen.x, y: e.screen.y } });
  }

  function applyRotate(s: Extract<State, { kind: 'rotate' }>, e: ToolPointerEvent) {
    let delta = angleFromCenter(s.pivot, e.point) - s.startAngle;
    let shown: number;
    if (s.single) {
      const base = s.snapshot[0].rotation || 0;
      let target = base + delta;
      if (e.shiftKey) target = snapAngle(target, 15);
      else {
        const nearest = snapAngle(target, 90);
        const diff = Math.abs(((target - nearest + 540) % 360) - 180);
        if (diff < 3) target = nearest;
      }
      delta = target - base;
      shown = ((Math.round(target) % 360) + 360) % 360;
    } else {
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      shown = ((Math.round(delta) % 360) + 360) % 360;
    }
    ed().updateMany(
      s.snapshot.map((el) => {
        const b = rotateBoxAround(el, s.pivot, delta);
        return { id: el.id, patch: { x: b.x, y: b.y, rotation: Math.round(b.rotation * 100) / 100 } };
      }),
    );
    ui.setState({ hint: { text: `${shown}°`, x: e.screen.x, y: e.screen.y } });
  }

  /** Double-click on a resize handle: the definition fits the element back to its content. */
  function fitToContent(handle: Handle) {
    const sel = ed().getSelection();
    const el = sel.length === 1 ? ed().getElement(sel[0]) : undefined;
    if (!el || el.locked) return;
    const patch = def(el)?.fitToContent?.(el as never, handle);
    if (patch) ed().update(el.id, patch);
  }

  function finish() {
    state = { kind: 'idle' };
    ui.setState({ transforming: null, guides: [], gaps: [], marquee: null, hint: null, dropTargetId: null });

  }

  return {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    shortcut: 'v',
    order: 0,
    placement: 'main',
    minRole: 'viewer',

    onPointerDown(e) {
      if (e.button !== 0) return;
      const handle = core.interaction.handle;
      const canEdit = ed().can('editor');
      if (handle && canEdit) {
        if (handle === 'rotate') beginRotate(e.point);
        else if (core.interaction.clickCount >= 2) fitToContent(handle as Handle);
        else beginResize(handle as Handle, e.point);
        return;
      }
      const target = e.target;
      // Double-click on empty canvas, or on a frame's empty area: "write here" (ToolDefinition.onCanvasDoubleClick).
      if (core.interaction.clickCount >= 2 && canEdit && (!target || (def(target)?.container && !def(target)?.textField))) {
        const writer = core.registry.tools.find((t) => t.def.onCanvasDoubleClick && ed().can(t.def.minRole ?? 'editor'));
        if (writer) {
          state = { kind: 'idle' };
          writer.def.onCanvasDoubleClick!(core.scoped(writer.feature), e.point);
          return;
        }
      }
      if (target) {
        const sel = ed().getSelection();
        if (core.interaction.clickCount >= 2) {
          // Double-click: dive into a group, or edit text.
          if (target.groupId && sel.length > 1 && sel.includes(target.id)) {
            ed().select([target.id]);
          } else if (canEdit && !editAt(target, e.point) && !target.locked) {
            // [additive] No text there: the type's own double-click (image → crop mode).
            const reg = core.registry.elements.get(target.type);
            reg?.def.onDoubleClick?.(target as never, { editor: core.scoped(reg.feature), point: e.point });
          }
          state = { kind: 'idle' };
          return;
        }
        // A click on a member of the current multi-selection that's a group "dives" only on dbl-click.
        const ids = sel.length === 1 && sel[0] === target.id ? [target.id] : ed().expandGroups([target.id]);
        const wasSelected = ids.every((id) => sel.includes(id));
        if (e.shiftKey) ed().select(ids, 'toggle');
        else if (!wasSelected) ed().select(ids);
        state = {
          kind: 'pending',
          startScreen: e.screen,
          start: e.point,
          hitId: target.id,
          ids,
          wasSelected,
          shift: e.shiftKey,
          alt: e.altKey,
        };
        return;
      }
      const base = e.shiftKey ? ed().getSelection() : [];
      if (!e.shiftKey) ed().clearSelection();
      state = { kind: 'marquee', start: e.point, base };
      ui.setState({ transforming: 'marquee' });
    },

    onPointerMove(e) {
      switch (state.kind) {
        case 'idle': {
          const id = e.buttons === 0 ? (e.target?.id ?? null) : null;
          if (ui.getState().hoverId !== id) ui.setState({ hoverId: id });
          return;
        }
        case 'pending': {
          if (distance(e.screen, state.startScreen) < DRAG_THRESHOLD_PX) return;
          const { start, alt, ids } = state;
          // Shift-click that just deselected the target: no drag.
          if (!ids.every((id) => ed().getSelection().includes(id))) return;
          beginTranslate(start, alt);
          const next = state as State;
          if (next.kind === 'translate') applyTranslate(next, e);
          return;
        }
        case 'translate':
          return applyTranslate(state, e);
        case 'marquee': {
          const rect = rectFromPoints(state.start, e.point);
          // Intersect semantics, except containers (frames) must be fully enclosed.
          const hits = ed()
            .elementsInRect(rect, 'intersect')
            .filter((el) => !def(el)?.container || rectContainsRect(rect, elementAABB(el)));
          const ids = ed().expandGroups(hits.map((h) => h.id));
          ed().select([...new Set([...state.base, ...ids])]);
          ui.setState({ marquee: rect });
          return;
        }
        case 'resize':
          return applyResize(state, e);
        case 'rotate':
          return applyRotate(state, e);
      }
    },

    onPointerUp() {
      const s = state;
      if (s.kind === 'pending') {
        const sel = ed().getSelection();
        if (s.wasSelected && !s.shift) {
          if (sel.length > s.ids.length) ed().select(s.ids);
          else if (sel.length === 1 && sel[0] === s.hitId) {
            const el = ed().getElement(s.hitId);
            // Click on an already-selected text element enters editing (the part under the pointer).
            if (el && !el.locked && ed().can('editor')) editAt(el, s.start);
          }
        }
      } else if (s.kind === 'translate') {
        updateMembership(s.snapshot.map((el) => el.id));
      } else if (s.kind === 'resize' && s.single) {
        const el = ed().getElement(s.snapshot[0].id);
        if (el && def(el)?.container) updateContainerChildren(el.id);
      }
      finish();
    },

    onCancel() {
      const s = state;
      // Escape mid-drag: revert everything the gesture wrote (incl. an Alt-drag duplicate) and
      // leave no undo step behind.
      if (s.kind === 'translate' || s.kind === 'resize' || s.kind === 'rotate') ed().cancelGesture();
      finish();
    },

    onDeactivate() {
      ui.setState({ hoverId: null });
    },
  };
}
