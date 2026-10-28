// Screen-space connector UI (constant size at any zoom):
//  - anchor dots of the hovered element (L tool) and the highlighted snap target while dragging;
//  - quick-connect "+" handles around a single selected item (drag = new line, click = new
//    connected copy on that side);
//  - endpoint + midpoint handles of a single selected connector.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from 'zustand';
import { Plus } from 'lucide-react';
import type { BoardElement, ConnectorElement, ConnectorEndpoint } from '@freero/shared';
import {
  definePanel,
  useCamera,
  useCanEdit,
  useChromeHidden,
  useEditingId,
  useElement,
  useElements,
  useFormatToolbarRect,
  useSelectedElements,
  useToolId,
  type Editor,
  type Point,
} from '@engine';
import { DRAG_PX, findTarget, overlay, resetOverlay, snap45, type Target } from './lib/connect';
import { anchorWorld, centerOf, localToWorld, nearestOnPoly, OPPOSITE, outlineLocal, pointAlong, SIDES, sideNormal, type Side } from './lib/geometry';
import {
  buildConnector,
  connectorGeometry,
  endpoint,
  isConnectable,
  localAnchors,
  patchConnector,
  styleFromOptions,
  TOOL_ID,
  type ConnectorStyle,
} from './lib/model';
import { nextToSide, occupiedRects, QUICK_GAP, quickSpotTaken } from './lib/quick';
import { liveObstacles } from './lib/obstacles';
import { labelBoxes, partAt } from './lib/labels';

const PLUS_OFFSET = 26;
/** The engine's rotate handle sits under the bottom edge: keep the bottom "+" clear of it. */
const PLUS_OFFSET_BELOW_ROTATE = 58;
/**
 * Stickies have their own "+" (add the next sticky, features/sticky) where ours would be: on them
 * we show small drag-to-connect dots this much further out instead, so the two never overlap.
 */
const STICKY_DOT_EXTRA = 30;
/** Half the "+" button (20 px, connector.css) plus a little air: screen px it must keep off items. */
const PLUS_RADIUS = 12;

// ------------------------------------------------------------------------------ drag plumbing
interface DragHandlers {
  move(world: Point, e: PointerEvent): void;
  up(world: Point, e: PointerEvent, moved: boolean): void;
}

/**
 * Runs a native pointer drag that started on one of our handles (marked data-fr-interactive,
 * so the canvas ignores it). Everything written until release is one undo step; Escape cancels
 * the gesture (the engine reverts its writes).
 */
function runDrag(editor: Editor, root: HTMLElement, down: ReactPointerEvent, h: DragHandlers) {
  down.preventDefault();
  down.stopPropagation();
  const start = { x: down.clientX, y: down.clientY };
  let moved = false;
  const world = (e: { clientX: number; clientY: number }) => {
    const r = root.getBoundingClientRect();
    return editor.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  editor.beginGesture();
  overlay.setState({ dragging: true });
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_PX) return;
    moved = true;
    h.move(world(e), e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    done();
    h.up(world(e), e, moved);
    editor.endGesture();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    done();
    // Reverts everything this drag wrote and leaves no (empty) undo step behind.
    editor.cancelGesture();
  };
  const done = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    resetOverlay();
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('keydown', onKey, true);
}

/** True while a pointer button is held on the board (engine drags: hide our handles). */
function usePointerHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    // Presses on our own handles don't count: hiding the handle on press would unmount it
    // before React dispatches its pointerdown.
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.fr-cx-ov'))) setHeld(true);
    };
    const up = () => setHeld(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  return held;
}

// ------------------------------------------------------------------------------ pieces
function boxStyle(editor: Editor, el: BoardElement, pad: number): CSSProperties {
  const z = editor.getCamera().zoom;
  const c = editor.worldToScreen(centerOf(el));
  const w = el.w * z + pad * 2;
  const h = el.h * z + pad * 2;
  return {
    width: w,
    height: h,
    transform: `translate(${c.x - w / 2}px, ${c.y - h / 2}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`,
  };
}

const at = (p: Point): CSSProperties => ({ transform: `translate(${p.x}px, ${p.y}px)` });

/** Anchor dots (and, for a snap target, the highlight) of one element. */
function TargetMarks({ editor, target, highlight }: { editor: Editor; target: Target; highlight: boolean }) {
  const el = useElement(target.id);
  if (!el) return null;
  const local = localAnchors(editor);
  return (
    <>
      {highlight && <div className="fr-cx-ov__target" style={boxStyle(editor, el, 3)} />}
      {SIDES.map((side) => (
        <div
          key={side}
          className={`fr-cx-ov__dot${!target.at && target.anchor === side ? ' is-on' : ''}`}
          style={at(editor.worldToScreen(anchorWorld(el, side, local)))}
        />
      ))}
      {/* Attach anywhere: the spot on the outline the end will hold. */}
      {target.at && <div className="fr-cx-ov__dot is-on" style={at(editor.worldToScreen(localToWorld(el, outlineLocal(el, target.at, local))))} />}
    </>
  );
}

/**
 * `inert`: mounted but invisible and not interactive (pointer held elsewhere, text editing, a line
 * being dragged). The top handle stays in the layout then, so the format toolbar — which climbs
 * over it (keep-clear) — doesn't jump while you click one of its buttons or start typing.
 */
function QuickConnect({ editor, el, root, inert }: { editor: Editor; el: BoardElement; root: HTMLDivElement; inert: boolean }) {
  const local = localAnchors(editor);
  const rotates = editor.getDefinition(el.type)?.rotatable !== false;
  const style = () => styleFromOptions(editor.getToolOptions<Partial<ConnectorStyle>>(TOOL_ID));
  const dots = el.type === 'sticky';

  const onDown = (side: Side) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    let id: string | null = null;
    const start: ConnectorEndpoint = endpoint({ id: el.id, anchor: side }, anchorWorld(el, side, local));
    runDrag(editor, root, e, {
      move(world, ev) {
        const target = findTarget(editor, world, [id, el.id]);
        overlay.setState({ snap: target });
        let p = world;
        if (!target && ev.shiftKey && style().routing === 'straight') p = snap45(start, world);
        const end = endpoint(target, p);
        if (!id) id = editor.create(buildConnector(editor, start, end, style())) || null;
        else patchConnector(editor, id, { end });
      },
      up(_world, _ev, moved) {
        if (moved) {
          if (id) editor.select([id]);
          return;
        }
        // Click: a connected copy of the item on that side, like extending a flowchart.
        const reach = 4 * (Math.max(el.w, el.h) + QUICK_GAP);
        const offset = nextToSide(el, side, occupiedRects(editor, el, reach));
        const [copy] = editor.duplicate([el.id], offset);
        if (!copy) return;
        const field = editor.getDefinition(el.type)?.textField;
        if (field) editor.update(copy, { [field]: '' } as never);
        const end = endpoint({ id: copy, anchor: OPPOSITE[side] }, centerOf(el));
        editor.create(buildConnector(editor, start, end, style()));
        editor.select([copy]);
      },
    });
  };

  // The top handle sits at the same distance as the others and is keep-clear: the format toolbar
  // climbs over it. The format toolbar may still flip below the selection: a bottom / side "+" it
  // would cover then steps further out along its side so it stays reachable.
  const bar = useFormatToolbarRect();
  const { zoom } = editor.getCamera();
  // Items around it move too (a sibling added, a collaborator's drag): re-check the spots.
  useElements();

  return (
    <>
      {SIDES.map((side) => {
        let off = side === 'bottom' && rotates ? PLUS_OFFSET_BELOW_ROTATE : PLUS_OFFSET;
        const n = sideNormal(el, side);
        const a = editor.worldToScreen(anchorWorld(el, side, local));
        const covered = (q: Point) => !!bar && q.x > bar.x - 14 && q.x < bar.x + bar.w + 14 && q.y > bar.y - 14 && q.y < bar.y + bar.h + 14;
        const top = side === 'top';
        const clear = () => {
          if (top) return;
          for (let i = 0; i < 40 && covered({ x: a.x + n.x * off, y: a.y + n.y * off }); i++) off += 4;
        };
        clear();
        // On a sticky its own "+" takes this spot (it steps past the toolbar the same way): go beyond.
        if (dots) {
          off += STICKY_DOT_EXTRA;
          clear();
        }
        const q = { x: a.x + n.x * off, y: a.y + n.y * off };
        if (quickSpotTaken(editor, el, editor.screenToWorld(q), PLUS_RADIUS / zoom)) return null;
        return (
          <div
            key={side}
            role="button"
            aria-label={`Connect from ${side} (drag), or add a connected copy (click)`}
            title="Drag to connect · Click to add a connected copy"
            className={`fr-cx-ov__plus${dots ? ' fr-cx-ov__plus--dot' : ''}${inert ? ' is-inert' : ''}`}
            data-fr-interactive=""
            data-fr-keep-clear={top ? '' : undefined}
            aria-hidden={inert || undefined}
            style={at(q)}
            onPointerDown={onDown(side)}
          >
            {!dots && <Plus size={12} strokeWidth={2.6} />}
          </div>
        );
      })}
    </>
  );
}

function ConnectorHandles({ editor, c, root }: { editor: Editor; c: ConnectorElement; root: HTMLDivElement }) {
  // Follow the attached elements live (also when a collaborator moves them).
  useElement(c.start.elementId ?? null);
  useElement(c.end.elementId ?? null);
  const geo = connectorGeometry(c, (id) => editor.getElement(id), localAnchors(editor), liveObstacles(editor));
  const wp = c.waypoints?.[0];
  // Without a bend yet, the handle sits at the middle, or beside a label that is there (a label
  // is dragged / edited itself, and the two must not cover each other).
  const boxes = labelBoxes(c, geo.route.poly).map((l) => l.box);
  const free = (p: Point) => !boxes.some((b) => p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8);
  const spot = () => [0.5, 0.3, 0.7, 0.2, 0.8].map((t) => pointAlong(geo.route.poly, t).p).find(free) ?? pointAlong(geo.route.poly, 0.5).p;
  const mid = c.routing === 'straight' ? null : wp ? (c.routing === 'curved' ? wp : nearestOnPoly(wp, geo.route.poly)) : spot();

  const dragEnd = (which: 'start' | 'end') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const before = editor.getElement<ConnectorElement>(c.id);
    if (!before) return;
    const other = which === 'start' ? before.end : before.start;
    runDrag(editor, root, e, {
      move(world, ev) {
        // Re-attach (highlighting the target) or detach; never onto the other end's element.
        const target = findTarget(editor, world, [c.id, other.elementId]);
        overlay.setState({ snap: target });
        let p = world;
        if (!target && ev.shiftKey && before.routing === 'straight') p = snap45(other, world);
        patchConnector(editor, c.id, { [which]: endpoint(target, p) });
      },
      up() {},
    });
  };

  const dragMid = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    runDrag(editor, root, e, {
      move(world) {
        patchConnector(editor, c.id, { waypoints: [{ x: Math.round(world.x), y: Math.round(world.y) }] });
      },
      up() {},
    });
  };

  const ends: Array<['start' | 'end', Point, boolean]> = [
    ['start', geo.start.p, !!c.start.elementId],
    ['end', geo.end.p, !!c.end.elementId],
  ];
  return (
    <>
      {mid && (
        <div
          className="fr-cx-ov__mid"
          data-fr-interactive=""
          title={wp ? 'Drag to bend · Double-click to straighten' : 'Drag to bend · Double-click to add a label'}
          style={{ transform: `${at(editor.worldToScreen(mid)).transform} rotate(45deg)` }}
          onPointerDown={dragMid}
          onDoubleClick={() => {
            // Double-clicking the middle of a line means "label it" (the handle sits where the
            // label goes); with a bend, it straightens the line as before.
            if (wp) return patchConnector(editor, c.id, { waypoints: [] });
            const part = partAt(c, geo.route.poly, mid);
            editor.startEditing(c.id, part ? { part } : {});
          }}
        />
      )}
      {ends.map(([which, p, attached]) => (
        <div
          key={which}
          className={`fr-cx-ov__end${attached ? ' is-attached' : ''}`}
          data-fr-interactive=""
          title={attached ? 'Drag to re-attach or detach' : 'Drag onto an item to attach'}
          style={at(editor.worldToScreen(p))}
          onPointerDown={dragEnd(which)}
        />
      ))}
    </>
  );
}

function ConnectorOverlay({ editor }: { editor: Editor }) {
  useCamera(); // re-render on pan/zoom: everything here is screen-positioned
  const rootRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => setRoot(rootRef.current), []);
  const { hover, snap, dragging } = useStore(overlay);
  const toolId = useToolId();
  const selection = useSelectedElements();
  const canEdit = useCanEdit();
  const editingId = useEditingId();
  const held = usePointerHeld();
  const hidden = useChromeHidden();

  const single = selection.length === 1 ? selection[0] : null;
  const idle = toolId === 'select' && canEdit && !editingId && !hidden && single && !single.locked;
  // Shown (and kept mounted, inert, while text is edited or a pointer is held) for one selected,
  // unlocked, connectable item.
  const quickable = toolId === 'select' && canEdit && !hidden && single && !single.locked && isConnectable(editor, single);
  const quick = quickable ? single : null;
  const quickInert = !!editingId || held || dragging;
  const conn = idle && single.type === 'connector' ? (single as ConnectorElement) : null;
  const marks = snap ?? (toolId === TOOL_ID ? hover : null);

  return (
    <div ref={rootRef} className="fr-cx-ov">
      {root && quick && <QuickConnect editor={editor} el={quick} root={root} inert={quickInert} />}
      {root && conn && <ConnectorHandles editor={editor} c={conn} root={root} />}
      {marks && <TargetMarks editor={editor} target={marks} highlight={!!snap} />}
    </div>
  );
}

export default definePanel({
  id: 'connector.overlay',
  slot: 'screen-overlay',
  order: 50,
  Component: ConnectorOverlay,
});
