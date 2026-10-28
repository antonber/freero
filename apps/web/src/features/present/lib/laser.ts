// Laser pointer (KAI-130): an ephemeral trail shared through presence only (ext.present.laser),
// never the doc, so nothing lands on the board or in anyone's undo history.
//
// The sender publishes its last few points, each numbered; receivers append the points they have
// not seen yet with THEIR OWN arrival time and fade them from there, so clock differences between
// computers never matter.
import type { Editor, Point } from '@engine';

/** What a pointing client publishes in ext.present.laser: recent points as [x, y, seq]. */
export interface LaserExt {
  pts: Array<[number, number, number]>;
}

export interface TrailPoint {
  x: number;
  y: number;
  n: number;
  /** Local time the point arrived (ms, performance.now()). */
  at: number;
}

/** How long a point stays visible. */
export const FADE_MS = 1000;
/** Points published per update (enough to bridge two updates at a fast swipe). */
const KEEP = 12;
const SEND_EVERY_MS = 40;

export function readLaser(v: unknown): LaserExt | null {
  const l = v as Partial<LaserExt> | null | undefined;
  if (!l || !Array.isArray(l.pts)) return null;
  const pts = l.pts.filter(
    (p): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
  return { pts: pts.slice(-KEEP) };
}

/** What a receiver keeps per pointing client. `last`: the newest sequence number seen. */
export interface Trail {
  last: number;
  pts: TrailPoint[];
}
export const EMPTY_TRAIL: Trail = { last: -1, pts: [] };

/**
 * Appends the points of `ext` this receiver has not seen yet (presence re-sends the same points
 * with every cursor move) and drops the faded ones. Returns a new trail.
 */
export function mergeTrail(trail: Trail, ext: LaserExt | null, now: number): Trail {
  const pts = trail.pts.filter((p) => now - p.at < FADE_MS);
  let last = trail.last;
  for (const [x, y, n] of ext?.pts ?? [])
    if (n > last) {
      pts.push({ x, y, n, at: now });
      last = n;
    }
  return { last, pts };
}

// ---- this client's own pointer (one per board)
interface Mine {
  seq: number;
  pts: Array<[number, number, number]>;
  trail: Trail;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}
const mine = new Map<string, Mine>();

function stateOf(editor: Editor): Mine {
  let s = mine.get(editor.boardId);
  if (!s) mine.set(editor.boardId, (s = { seq: 0, pts: [], trail: EMPTY_TRAIL, timer: null, listeners: new Set() }));
  return s;
}

/** My own trail (drawn locally, without waiting for the network). */
export function myTrail(editor: Editor): Trail {
  return stateOf(editor).trail;
}

export function onMyTrail(editor: Editor, l: () => void): () => void {
  const s = stateOf(editor);
  s.listeners.add(l);
  return () => s.listeners.delete(l);
}

/** Adds a point to my laser and publishes the recent ones (throttled). */
export function pointLaser(editor: Editor, p: Point, publish: (ext: LaserExt | null) => void): void {
  const s = stateOf(editor);
  const n = ++s.seq;
  const pt: [number, number, number] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, n];
  s.pts = [...s.pts, pt].slice(-KEEP);
  s.trail = mergeTrail(s.trail, { pts: [pt] }, performance.now());
  for (const l of s.listeners) l();
  if (s.timer) return;
  publish({ pts: s.pts });
  s.timer = setTimeout(() => {
    s.timer = null;
    publish({ pts: s.pts });
  }, SEND_EVERY_MS);
}

/** Stops pointing: others' trails fade out on their own. */
export function stopLaser(editor: Editor, publish: (ext: LaserExt | null) => void): void {
  const s = stateOf(editor);
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.pts = [];
  publish(null);
}
