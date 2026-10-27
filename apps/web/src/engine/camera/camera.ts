// Camera math. Camera (x, y) is the world point at the viewport's top-left; screen = (world - cam) * zoom.
import type { Camera, Point, Rect } from '../api';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;
/** Zoom steps used by +/− buttons and Ctrl/⌘ +/−. */
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const screenToWorld = (cam: Camera, p: Point): Point => ({ x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y });
export const worldToScreen = (cam: Camera, p: Point): Point => ({ x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom });

/** New camera with `zoom`, keeping the world point under `screen` fixed. */
export function zoomAt(cam: Camera, zoom: number, screen: Point): Camera {
  const z = clampZoom(zoom);
  const w = screenToWorld(cam, screen);
  return { x: w.x - screen.x / z, y: w.y - screen.y / z, zoom: z };
}

export function nextZoomStep(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom + 1e-3) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-3) ?? MIN_ZOOM;
}

/** Camera that fits `rect` into a viewport, with padding in screen px. */
export function fitRect(
  rect: Rect,
  viewport: { width: number; height: number },
  padding = 64,
  maxZoom = 1,
): Camera {
  const vw = Math.max(1, viewport.width - padding * 2);
  const vh = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, vw / Math.max(rect.w, 1), vh / Math.max(rect.h, 1)));
  return {
    x: rect.x + rect.w / 2 - viewport.width / 2 / zoom,
    y: rect.y + rect.h / 2 - viewport.height / 2 / zoom,
    zoom,
  };
}

export function viewportRect(cam: Camera, viewport: { width: number; height: number }): Rect {
  return { x: cam.x, y: cam.y, w: viewport.width / cam.zoom, h: viewport.height / cam.zoom };
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Interpolates two cameras so that the motion looks natural when zoom changes a lot:
 * zoom is interpolated in log space and the viewport center follows linearly.
 */
export function lerpCamera(a: Camera, b: Camera, t: number, viewport: { width: number; height: number }): Camera {
  const e = easeOutCubic(t);
  const za = Math.log(a.zoom);
  const zb = Math.log(b.zoom);
  const zoom = Math.exp(za + (zb - za) * e);
  const ca = { x: a.x + viewport.width / 2 / a.zoom, y: a.y + viewport.height / 2 / a.zoom };
  const cb = { x: b.x + viewport.width / 2 / b.zoom, y: b.y + viewport.height / 2 / b.zoom };
  const cx = ca.x + (cb.x - ca.x) * e;
  const cy = ca.y + (cb.y - ca.y) * e;
  return { x: cx - viewport.width / 2 / zoom, y: cy - viewport.height / 2 / zoom, zoom };
}

/** Zoom value handed to element renderers, quantized so zooming doesn't re-render every element every frame. */
export function quantizeZoom(zoom: number): number {
  return Math.pow(2, Math.round(Math.log2(zoom) * 2) / 2);
}
