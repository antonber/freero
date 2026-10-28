// The board viewport: pointer routing (tools, pan, pinch), wheel navigation, drag-and-drop,
// context menu, and the world/screen layers.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Point, ToolPointerEvent } from '../api';
import { useCore, ScopeContext } from '../context';
import { Grid } from './Grid';
import { WorldElements, useWorldTransform } from './WorldLayer';
import { zoomAt } from '../camera/camera';
import { dispatchToolPointer, type ToolPointerHandler } from '../interaction/toolDispatch';
import { useSettings } from '../hooks';
import type { Registered } from '../runtime/registry';
import type { ToolDefinition } from '../api';
import './canvas.css';

const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 6;
const CURSOR_THROTTLE_MS = 50;

interface Gesture {
  pointerId: number;
  tool: Registered<ToolDefinition>;
  cancelled: boolean;
}

interface Pan {
  pointerId: number;
  start: Point;
  cam: { x: number; y: number; zoom: number };
}

export function Canvas(props: { worldOverlay?: ReactNode; screenOverlay?: ReactNode }) {
  const core = useCore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  useWorldTransform(worldRef);

  const toolId = useStore(core.ui, (s) => s.toolId);
  const spaceHeld = useStore(core.ui, (s) => s.spaceHeld);
  const panning = useStore(core.ui, (s) => s.transforming === 'pan');
  const toolCursor = core.registry.toolsById.get(toolId)?.def.cursor;
  const cursor = panning ? 'grabbing' : spaceHeld || toolId === 'hand' ? 'grab' : (toolCursor ?? 'default');

  // ---- size tracking
  useLayoutEffect(() => {
    const el = viewportRef.current!;
    core.dom.viewport = el;
    core.dom.world = worldRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const vp = core.ui.getState().viewport;
      if (vp.width !== r.width || vp.height !== r.height) core.ui.setState({ viewport: { width: r.width, height: r.height } });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      core.dom.viewport = null;
      core.dom.world = null;
    };
  }, [core]);

  // ---- pointer routing, wheel, pinch (native listeners for passive:false + capture control)
  useEffect(() => {
    const el = viewportRef.current!;
    const editor = core.editor;
    const ui = core.ui;
    let gesture: Gesture | null = null;
    let pan: Pan | null = null;
    let lastDown = { t: 0, x: 0, y: 0, count: 0 };
    let lastCursorSent = 0;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    const touches = new Map<number, Point>();
    let pinch: { d0: number; mid0: Point; cam: { x: number; y: number; zoom: number } } | null = null;

    const screenOf = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };


    const publishCursor = (world: Point | null) => {
      const now = performance.now();
      const send = () => {
        lastCursorSent = performance.now();
        cursorTimer = null;
        const p = core.pointer.getState();
        core.store.setPresence({ cursor: p.inside && p.world ? { x: Math.round(p.world.x), y: Math.round(p.world.y) } : null });
      };
      if (world === null) return send();
      if (now - lastCursorSent >= CURSOR_THROTTLE_MS) send();
      else if (!cursorTimer) cursorTimer = setTimeout(send, CURSOR_THROTTLE_MS - (now - lastCursorSent));
    };

    const toolEvent = (e: PointerEvent, screen: Point, world: Point, feature: string): ToolPointerEvent => {
      let hit: ToolPointerEvent['target'] | undefined;
      const ev = {
        editor: core.scoped(feature),
        point: world,
        screen,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey || e.ctrlKey,
        button: e.type === 'pointermove' ? -1 : e.button,
        buttons: e.buttons,
        pressure: e.pressure,
        pointerType: e.pointerType,
      } as ToolPointerEvent;
      // Hit-testing is lazy: only computed if the tool reads `target`.
      Object.defineProperty(ev, 'target', {
        enumerable: true,
        get: () => (hit === undefined ? (hit = editor.hitTest(world)) : hit),
      });
      return ev;
    };

    const dispatch = (tool: Registered<ToolDefinition>, kind: ToolPointerHandler, e: PointerEvent, screen: Point, world: Point) =>
      dispatchToolPointer(core, tool, kind, toolEvent(e, screen, world, tool.feature));

    const endGesture = () => {
      gesture = null;
      core.interaction.cancel = null;
      core.interaction.handle = null;
      editor.endGesture();
      if (ui.getState().transforming === 'tool') ui.setState({ transforming: null });
    };

    const startPan = (e: PointerEvent, screen: Point) => {
      pan = { pointerId: e.pointerId, start: screen, cam: editor.getCamera() };
      el.setPointerCapture(e.pointerId);
      ui.setState({ transforming: 'pan', hoverId: null });
    };

    /** Camera moves the user makes on the canvas (wheel, pan, pinch): 'camera-user', ends following. */
    const userCamera = (cam: { x: number; y: number; zoom: number }) => editor.asUser(() => editor.setCameraNow(cam));

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-fr-text-editor]') || t.closest('[data-fr-interactive]')) return;
      const screen = screenOf(e);
      const world = editor.screenToWorld(screen);
      if (ui.getState().contextMenu) ui.setState({ contextMenu: null });
      // A plain click on the canvas takes the camera back from whoever you follow.
      if (editor.getFollowing()) editor.follow(null);
      if (editor.getEditingId()) editor.stopEditing();
      else el.focus({ preventScroll: true });

      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, screen);
        if (touches.size === 2) {
          // Second finger: abandon the tool gesture, start pinch-zoom.
          if (gesture) core.interaction.cancel?.();
          const [a, b] = [...touches.values()];
          pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: editor.getCamera() };
          return;
        }
      }

      const now = performance.now();
      if (now - lastDown.t < DOUBLE_CLICK_MS && Math.hypot(screen.x - lastDown.x, screen.y - lastDown.y) < DOUBLE_CLICK_PX)
        lastDown = { t: now, x: screen.x, y: screen.y, count: lastDown.count + 1 };
      else lastDown = { t: now, x: screen.x, y: screen.y, count: 1 };
      core.interaction.clickCount = lastDown.count;

      const s = ui.getState();
      if (e.button === 1 || (e.button === 0 && (s.spaceHeld || s.toolId === 'hand'))) {
        e.preventDefault();
        startPan(e, screen);
        return;
      }
      if (e.button === 2) {
        const hit = editor.hitTest(world);
        if (hit && !s.selection.includes(hit.id)) editor.select(editor.expandGroups([hit.id]));
        else if (!hit) editor.clearSelection();
        return;
      }
      if (e.button !== 0 || gesture) return;
      const tool = core.registry.toolsById.get(s.toolId);
      if (!tool) return;
      core.interaction.handle = t.closest('[data-handle]')?.getAttribute('data-handle') ?? null;
      gesture = { pointerId: e.pointerId, tool, cancelled: false };
      editor.beginGesture();
      if (tool.def.id !== 'select') ui.setState({ transforming: 'tool' });
      core.interaction.cancel = () => {
        if (!gesture) return;
        gesture.cancelled = true;
        gesture.tool.def.onCancel?.(core.scoped(gesture.tool.feature));
        endGesture();
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events in tests
      }
      e.preventDefault();
      dispatch(tool, 'onPointerDown', e, screen, world);
    };

    const onPointerMove = (e: PointerEvent) => {
      const screen = screenOf(e);
      const world = editor.screenToWorld(screen);
      core.pointer.setState({ screen, world, inside: true });
      publishCursor(world);

      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, screen);
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const zoomed = zoomAt(pinch.cam, pinch.cam.zoom * (d / Math.max(1, pinch.d0)), pinch.mid0);
          userCamera({ ...zoomed, x: zoomed.x - (mid.x - pinch.mid0.x) / zoomed.zoom, y: zoomed.y - (mid.y - pinch.mid0.y) / zoomed.zoom });
          return;
        }
      }

      if (pan) {
        if (e.pointerId !== pan.pointerId) return;
        userCamera({
          x: pan.cam.x - (screen.x - pan.start.x) / pan.cam.zoom,
          y: pan.cam.y - (screen.y - pan.start.y) / pan.cam.zoom,
          zoom: pan.cam.zoom,
        });
        return;
      }
      if (gesture) {
        if (e.pointerId !== gesture.pointerId) return;
        dispatch(gesture.tool, 'onPointerMove', e, screen, world);
        return;
      }
      if (e.buttons !== 0 || ui.getState().spaceHeld) return;
      const tool = core.registry.toolsById.get(ui.getState().toolId);
      if (tool) dispatch(tool, 'onPointerMove', e, screen, world);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (pinch) {
          if (touches.size < 2) pinch = null;
          return;
        }
      }
      if (pan && e.pointerId === pan.pointerId) {
        pan = null;
        ui.setState({ transforming: null });
        return;
      }
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const g = gesture;
      const screen = screenOf(e);
      if (!g.cancelled) dispatch(g.tool, 'onPointerUp', e, screen, editor.screenToWorld(screen));
      endGesture();
    };

    const onPointerCancel = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (pan && e.pointerId === pan.pointerId) {
        pan = null;
        ui.setState({ transforming: null });
      }
      if (gesture && e.pointerId === gesture.pointerId) core.interaction.cancel?.();
    };

    const onPointerLeave = () => {
      core.pointer.setState({ inside: false });
      publishCursor(null);
      if (!gesture && ui.getState().hoverId) ui.setState({ hoverId: null });
    };

    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-fr-scrollable]')) return;
      e.preventDefault();
      const screen = screenOf(e);
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= el.clientWidth;
        dy *= el.clientHeight;
      }
      const cam = editor.getCamera();
      if (e.ctrlKey || e.metaKey) {
        // Pinch (trackpads report ctrl+wheel) or Ctrl/⌘+wheel: zoom around the cursor.
        const factor = Math.exp(-Math.max(-30, Math.min(30, dy)) * 0.01);
        userCamera(zoomAt(cam, cam.zoom * factor, screen));
      } else {
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        userCamera({ x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom, zoom: cam.zoom });
      }
      const world = editor.screenToWorld(screen);
      core.pointer.setState({ screen, world, inside: true });
    };

    // Safari trackpad pinch.
    let gestureZoom0 = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureZoom0 = editor.getCamera().zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      userCamera(zoomAt(editor.getCamera(), gestureZoom0 * ge.scale, screenOf(ge)));
    };

    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-fr-text-editor]')) return;
      e.preventDefault();
      const screen = screenOf(e);
      ui.setState({ contextMenu: { x: e.clientX, y: e.clientY, world: editor.screenToWorld(screen) } });
    };

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/plain' || t === 'text/html')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      const world = editor.screenToWorld(screenOf(e));
      void editor.importData(
        { files: Array.from(dt.files), text: dt.getData('text/plain') || null, html: dt.getData('text/html') || null },
        world,
      );
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      if (gesture) core.interaction.cancel?.();
      if (cursorTimer) clearTimeout(cursorTimer);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, [core]);

  const tool = core.registry.toolsById.get(toolId);
  const Preview = tool?.def.Preview;

  return (
    <div
      ref={viewportRef}
      className="fr-viewport"
      tabIndex={0}
      aria-label="Board canvas"
      style={{ background: settings.background, cursor }}
    >
      <Grid />
      <div ref={worldRef} className="fr-world">
        <WorldElements />
        {Preview && !spaceHeld && (
          <ScopeContext.Provider value={tool!.feature}>
            <Preview editor={core.scoped(tool!.feature)} />
          </ScopeContext.Provider>
        )}
        {props.worldOverlay}
      </div>
      {props.screenOverlay}
    </div>
  );
}
