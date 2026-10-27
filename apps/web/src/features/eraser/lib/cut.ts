// Partial erase: cut a pen stroke where the eraser passes and keep what's left (pure).
//
// Works on the shared PenElement data shape (features never import each other): points are
// [x, y, pressure] triples relative to (x, y) in the "base" space baseW × baseH, scaled to the
// element's w × h, and the element is rotated around its center. Every piece keeps the stroke's
// scale and rotation, gets its own tight box, and its ink stays exactly where it was drawn.
import type { PenElement } from '@freero/shared';
import { worldToLocal, type Point } from '@engine';

export type Stroke = Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'points' | 'strokeWidth' | 'highlighter' | 'baseW' | 'baseH'>;
export type Piece = Pick<PenElement, 'x' | 'y' | 'w' | 'h' | 'points' | 'baseW' | 'baseH'>;

/** The pen's pressure → outline radius (perfect-freehand, linear easing; thinning 0.5, highlighters 0). */
const inkRadius = (width: number, highlighter: boolean, p: number) => Math.max(0.5, width * (0.5 - (highlighter ? 0 : 0.5) * (0.5 - p)));

/** Most centerline samples one cut works with (very long strokes are resampled more coarsely). */
const MAX_SAMPLES = 6000;

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cuts `el` with an eraser of `radius` (world units) moving from `from` to `to` (world).
 * Returns null when the sweep doesn't touch the ink, [] when nothing is left, else the pieces
 * (each a full geometry for a new pen element with the same style, z and rotation).
 */
export function cutStroke(el: Stroke, from: Point, to: Point, radius: number): Piece[] | null {
  const flat = el.points;
  if (flat.length < 3) return null;
  const sx = el.w / (el.baseW || 1);
  const sy = el.h / (el.baseH || 1);
  const scale = Math.sqrt(Math.abs(sx * sy)) || 1;
  const a = worldToLocal(el as never, from);
  const b = worldToLocal(el as never, to);

  // Centerline in local (scaled) space, resampled so no gap between samples is wider than a
  // fraction of the eraser: a cut through a long straight segment lands where the eraser was.
  // `v` marks the recorded vertices: pieces keep those (plus their cut ends), not the extra samples.
  const src: Array<{ x: number; y: number; p: number; v: boolean }> = [];
  for (let i = 0; i + 2 < flat.length; i += 3) src.push({ x: flat[i] * sx, y: flat[i + 1] * sy, p: flat[i + 2], v: true });
  let total = 0;
  for (let i = 1; i < src.length; i++) total += Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
  const step = Math.max(radius / 3, 0.5, total / MAX_SAMPLES);
  const pts: typeof src = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const p0 = src[i - 1];
    const p1 = src[i];
    const n = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, p: p0.p + (p1.p - p0.p) * t, v: k === n });
    }
  }

  const ink = (p: number) => inkRadius(el.strokeWidth, el.highlighter, p) * scale;
  const erased = pts.map((q) => distToSegment(q, a, b) <= radius + ink(q.p));
  if (!erased.some(Boolean)) return null;

  // Runs of surviving samples; crumbs shorter than the ink is wide are dropped.
  const runs: Array<typeof pts> = [];
  let cur: typeof pts = [];
  pts.forEach((q, i) => {
    if (erased[i]) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(q);
  });
  if (cur.length) runs.push(cur);
  const minLen = el.strokeWidth * scale;
  const pieces: Piece[] = [];
  const c = { x: el.w / 2, y: el.h / 2 };
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const run of runs) {
    let len = 0;
    for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
    if (run.length < 2 || len < minLen) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let pad = 0;
    for (const q of run) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
      pad = Math.max(pad, ink(q.p));
    }
    pad = Math.ceil(pad + 1);
    x0 -= pad;
    y0 -= pad;
    const w = r2(x1 + pad - x0);
    const h = r2(y1 + pad - y0);
    // The piece's center, from the stroke's local space to the world (rotation about the center).
    const lc = { x: x0 + w / 2 - c.x, y: y0 + h / 2 - c.y };
    const wc = { x: el.x + c.x + lc.x * cos - lc.y * sin, y: el.y + c.y + lc.x * sin + lc.y * cos };
    const points: number[] = [];
    run.forEach((q, i) => {
      if (q.v || i === 0 || i === run.length - 1) points.push(r2((q.x - x0) / sx), r2((q.y - y0) / sy), r2(q.p));
    });
    pieces.push({ x: r2(wc.x - w / 2), y: r2(wc.y - h / 2), w, h, points, baseW: r2(w / sx), baseH: r2(h / sy) });
  }
  return pieces;
}
