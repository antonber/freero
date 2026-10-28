// Shared "drag a connector end around" logic for the L tool, the quick-connect handles and the
// endpoint handles of a selected connector: snap-target search and the transient overlay state.
import { createStore } from 'zustand/vanilla';
import type { Editor, Point } from '@engine';
import { anchorWorld, attachNear, dist, SIDES, type Side } from './geometry';
import { isConnectable, localAnchors } from './model';

/** Screen px within which the pointer snaps onto an anchor dot. */
export const ANCHOR_SNAP_PX = 14;
/** Screen px of movement before a press becomes a drag. */
export const DRAG_PX = 4;

export interface Target {
  id: string;
  /** A fixed side when dropped on an anchor dot; 'auto' when dropped on the body. */
  anchor: Side | 'auto';
  /** Dropped on the outline away from the dots: that spot (ConnectorEndpoint.at); `anchor` is its side. */
  at?: { u: number; v: number };
}

/** Transient, local-only overlay state (never synced). */
export interface ConnectOverlay {
  /** Element whose anchor dots are shown (hover with the L tool). */
  hover: Target | null;
  /** Current snap target while dragging an end. */
  snap: Target | null;
  /** True while one of this feature's own drags runs (hides quick-connect handles). */
  dragging: boolean;
}

export const overlay = createStore<ConnectOverlay>(() => ({ hover: null, snap: null, dragging: false }));

export function resetOverlay() {
  overlay.setState({ hover: null, snap: null, dragging: false });
}

/**
 * What a connector end dropped at `p` attaches to: an anchor dot within snap distance (even
 * just outside the element), else that spot of an outline within snap distance (attach
 * anywhere), else the topmost connectable element body ('auto'), else nothing.
 */
export function findTarget(editor: Editor, p: Point, exclude: Array<string | null | undefined>): Target | null {
  const skip = new Set(exclude.filter((x): x is string => !!x));
  const r = ANCHOR_SNAP_PX / editor.getCamera().zoom;
  const near = editor
    .elementsInRect({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }, 'intersect')
    .filter((el) => !skip.has(el.id) && isConnectable(editor, el))
    .reverse(); // topmost first
  const local = localAnchors(editor);
  for (const el of near) {
    let best: Side | null = null;
    let bd = r;
    for (const side of SIDES) {
      const d = dist(anchorWorld(el, side, local), p);
      if (d <= bd) {
        bd = d;
        best = side;
      }
    }
    if (best) return { id: el.id, anchor: best };
    const spot = attachNear(el, p, local);
    if (spot.dist <= r) return { id: el.id, anchor: spot.side, at: spot.at };
  }
  // Body: walk down through non-connectable things on top (pen strokes, other connectors).
  const ignore = [...skip];
  for (let i = 0; i < 12; i++) {
    const hit = editor.hitTest(p, { exclude: ignore });
    if (!hit) return null;
    if (isConnectable(editor, hit)) return { id: hit.id, anchor: 'auto' };
    ignore.push(hit.id);
  }
  return null;
}

/** Shift-drag of a straight line: lock the free end to 45° steps around the other end. */
export function snap45(from: Point, to: Point): Point {
  const d = dist(from, to);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
}
