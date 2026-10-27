// Resize / rotate math for the select tool. Pure functions, unit-tested.
import type { Point, Rect } from '../api';
import { localToWorld, rectCenter, rotatePoint, worldToLocal } from './geometry';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];

export interface Box { x: number; y: number; w: number; h: number; rotation: number }

/** Unit position of a handle in the box: (0,0)=nw, (1,1)=se. */
export function handleUnit(h: Handle): Point {
  return {
    x: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5,
    y: h.startsWith('n') ? 0 : h.startsWith('s') ? 1 : 0.5,
  };
}

export const oppositeHandle = (h: Handle): Handle =>
  (({ nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' }) as const)[h];

export const isCorner = (h: Handle): boolean => h.length === 2;

export function handleEdges(h: Handle) {
  return { left: h.includes('w'), right: h.includes('e'), top: h.startsWith('n'), bottom: h.startsWith('s') };
}

export interface ResizeOpts {
  keepAspect: boolean;
  minW: number;
  minH: number;
  /** Only width changes (text that wraps); height is left as-is. */
  widthOnly?: boolean;
}

/**
 * Resizes a (possibly rotated) box by dragging `handle` to world point `pointer`.
 * `grab` is the offset (local units) between the pointer and the handle at gesture start,
 * so the handle doesn't jump. The opposite handle stays fixed in world space.
 * Returns the new box (same rotation) and the scale factors applied.
 */
export function resizeBox(
  start: Box,
  handle: Handle,
  pointer: Point,
  grab: Point,
  opts: ResizeOpts,
): { box: Box; sx: number; sy: number } {
  const u = handleUnit(handle);
  const anchorU = handleUnit(oppositeHandle(handle));
  const anchorLocal = { x: anchorU.x * start.w, y: anchorU.y * start.h };
  const anchorWorld = localToWorld(start, anchorLocal);
  const p = worldToLocal(start, pointer);
  const px = p.x - grab.x;
  const py = p.y - grab.y;

  let w = start.w;
  let h = start.h;
  if (u.x === 1) w = px - anchorLocal.x;
  else if (u.x === 0) w = anchorLocal.x - px;
  if (!opts.widthOnly) {
    if (u.y === 1) h = py - anchorLocal.y;
    else if (u.y === 0) h = anchorLocal.y - py;
  }
  w = Math.max(opts.minW, w);
  h = Math.max(opts.minH, h);

  if (opts.keepAspect && start.w > 0 && start.h > 0 && !opts.widthOnly) {
    const ratio = start.w / start.h;
    if (isCorner(handle)) {
      const s = Math.max(w / start.w, h / start.h);
      w = start.w * s;
      h = start.h * s;
    } else if (u.x === 0.5) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
    if (w < opts.minW) { w = opts.minW; h = w / ratio; }
    if (h < opts.minH) { h = opts.minH; w = h * ratio; }
  }

  const newAnchorLocal = { x: anchorU.x * w, y: anchorU.y * h };
  // center' = anchorWorld - R(newAnchorLocal - (w/2, h/2))
  const off = rotatePoint({ x: newAnchorLocal.x - w / 2, y: newAnchorLocal.y - h / 2 }, { x: 0, y: 0 }, start.rotation || 0);
  const cx = anchorWorld.x - off.x;
  const cy = anchorWorld.y - off.y;
  return {
    box: { x: cx - w / 2, y: cy - h / 2, w, h, rotation: start.rotation || 0 },
    sx: w / (start.w || 1),
    sy: h / (start.h || 1),
  };
}

/** Uniform scale of a group's members around an anchor point. */
export function scaleBoxAround(b: Box, anchor: Point, s: number, keepSize: boolean): Box {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const nc = { x: anchor.x + (c.x - anchor.x) * s, y: anchor.y + (c.y - anchor.y) * s };
  const w = keepSize ? b.w : b.w * s;
  const h = keepSize ? b.h : b.h * s;
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h, rotation: b.rotation };
}

/** Rotates a box around a pivot by `delta` degrees: moves its center and adds to its rotation. */
export function rotateBoxAround(b: Box, pivot: Point, delta: number): Box {
  const c = rectCenter(b);
  const nc = rotatePoint(c, pivot, delta);
  return { ...b, x: nc.x - b.w / 2, y: nc.y - b.h / 2, rotation: (((b.rotation || 0) + delta) % 360 + 360) % 360 };
}

/** Angle in degrees (clockwise from +x… adjusted so 0 = pointing up) from center to point. */
export function angleFromCenter(c: Point, p: Point): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
}

export function rectToBox(r: Rect): Box {
  return { ...r, rotation: 0 };
}
