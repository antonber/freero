// The walkthrough timeline (@freero/shared WalkthroughTimeline): recorded while the narrator talks,
// replayed against the recording's clock. Pure, so recording and playback agree by construction.
import { MAX_TIMELINE_SAMPLES, type WalkthroughCue, type WalkthroughTimeline } from '@freero/shared';

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

/** Shortest gap between two view samples while the view moves (≈15 per second). */
const VIEW_EVERY_MS = 66;
/** Shortest gap between two pointer samples (≈20 per second). */
const POINTER_EVERY_MS = 50;
/** A pointer sample older than this is not interpolated across (it stopped, then jumped). */
const POINTER_GAP_MS = 400;

const round = (n: number) => Math.round(n * 10) / 10;
const sameRect = (a: ViewRect, b: ViewRect) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w / b.w - 1) < 1e-3 && Math.abs(a.h / b.h - 1) < 1e-3;

/**
 * Collects samples while recording. A still view stores nothing; when it starts moving again the
 * last still position is stored again just before the move, so playback holds still through the
 * pause instead of drifting slowly from the old sample to the new one.
 */
export class TimelineRecorder {
  private views: WalkthroughTimeline['view'] = [];
  private pointers: WalkthroughTimeline['pointer'] = [];
  private lastView: { t: number; r: ViewRect } | null = null;
  private pendingView: { t: number; r: ViewRect } | null = null;
  private lastPointer: { t: number; p: Pt | null } | null = null;

  view(t: number, r: ViewRect): void {
    if (this.lastView && t - this.lastView.t < VIEW_EVERY_MS) {
      // Too soon: kept aside, stored at its own time when the next sample (or the end) comes.
      this.pendingView = { t, r };
      return;
    }
    this.flushPending();
    const prev = this.lastView;
    if (prev && sameRect(prev.r, r)) return;
    if (prev && t - prev.t > VIEW_EVERY_MS * 2)
      this.views.push([Math.round(Math.max(prev.t, t - VIEW_EVERY_MS)), round(prev.r.x), round(prev.r.y), round(prev.r.w), round(prev.r.h)]);
    this.views.push([Math.round(t), round(r.x), round(r.y), round(r.w), round(r.h)]);
    this.lastView = { t, r };
  }

  pointer(t: number, p: Pt | null): void {
    const moving = p !== null && this.lastPointer?.p != null;
    // Moves are thinned (the latest one kept aside); leaving or entering the board is kept at once.
    if (moving && this.lastPointer && t - this.lastPointer.t < POINTER_EVERY_MS) {
      this.pendingPointer = { t, p };
      return;
    }
    this.flushPendingPointer();
    const prev = this.lastPointer;
    if (prev && (prev.p === null ? p === null : p !== null && Math.abs(prev.p.x - p.x) < 0.5 && Math.abs(prev.p.y - p.y) < 0.5)) return;
    if (prev?.p && p && t - prev.t > POINTER_GAP_MS) this.pointers.push([Math.round(Math.max(prev.t, t - POINTER_EVERY_MS)), round(prev.p.x), round(prev.p.y)]);
    this.pointers.push(p ? [Math.round(t), round(p.x), round(p.y)] : [Math.round(t)]);
    this.lastPointer = { t, p };
  }

  private pendingPointer: { t: number; p: Pt | null } | null = null;

  private flushPendingPointer(): void {
    const q = this.pendingPointer;
    this.pendingPointer = null;
    if (!q?.p) return;
    this.pointers.push([Math.round(q.t), round(q.p.x), round(q.p.y)]);
    this.lastPointer = q;
  }

  private flushPending(): void {
    const p = this.pendingView;
    this.pendingView = null;
    if (!p || (this.lastView && sameRect(this.lastView.r, p.r))) return;
    this.views.push([Math.round(p.t), round(p.r.x), round(p.r.y), round(p.r.w), round(p.r.h)]);
    this.lastView = p;
  }

  /** The timeline up to `endMs`, thinned to what the server keeps. */
  finish(endMs: number): WalkthroughTimeline {
    this.flushPending();
    this.flushPendingPointer();
    const keep = <T extends unknown[]>(list: T[]) => thin(list.filter((s) => (s[0] as number) <= endMs));
    return { v: 1, view: keep(this.views), pointer: keep(this.pointers) };
  }
}

/** At most `max` samples, evenly dropped, always keeping the first and the last. */
export function thin<T>(list: T[], max = MAX_TIMELINE_SAMPLES): T[] {
  if (list.length <= max) return list;
  const out: T[] = [];
  const step = (list.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]);
  return out;
}

/** Index of the last sample at or before `t` (-1 when all are after). */
function before<T extends [number, ...unknown[]]>(list: T[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Where the narrator looked at `t` (between samples: in between). */
export function viewAt(tl: WalkthroughTimeline, t: number): ViewRect | null {
  if (!tl.view.length) return null;
  const i = before(tl.view, t);
  if (i < 0) {
    const [, x, y, w, h] = tl.view[0];
    return { x, y, w, h };
  }
  const a = tl.view[i];
  const b = tl.view[i + 1];
  if (!b) return { x: a[1], y: a[2], w: a[3], h: a[4] };
  const k = (t - a[0]) / Math.max(1, b[0] - a[0]);
  return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), w: lerp(a[3], b[3], k), h: lerp(a[4], b[4], k) };
}

/** Where the narrator's pointer was at `t`, or null while it was off the board. */
export function pointerAt(tl: WalkthroughTimeline, t: number): Pt | null {
  const i = before(tl.pointer, t);
  if (i < 0) return null;
  const a = tl.pointer[i];
  if (a.length === 1) return null;
  const b = tl.pointer[i + 1];
  if (!b || b.length === 1 || b[0] - a[0] > POINTER_GAP_MS) return { x: a[1], y: a[2] };
  const k = (t - a[0]) / Math.max(1, b[0] - a[0]);
  return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k) };
}

/** The caption showing at `t`. */
export function cueAt(cues: readonly WalkthroughCue[] | null, t: number): WalkthroughCue | null {
  if (!cues) return null;
  for (const c of cues) if (c.start <= t && t < c.end) return c;
  return null;
}

/** The camera that shows all of `r`, centred, in a viewport of `size` (zoom clamped to the board's range). */
export function cameraShowing(r: ViewRect, size: { width: number; height: number }, zoomRange = { min: 0.05, max: 8 }): { x: number; y: number; zoom: number } {
  const zoom = Math.min(zoomRange.max, Math.max(zoomRange.min, Math.min(size.width / r.w, size.height / r.h)));
  return { x: r.x + r.w / 2 - size.width / 2 / zoom, y: r.y + r.h / 2 - size.height / 2 / zoom, zoom };
}

/** Captions typed as lines of "m:ss text" (or "h:mm:ss text"); each lasts until the next one starts. */
export function parseCaptionLines(text: string, durationMs: number): WalkthroughCue[] {
  const starts: Array<{ start: number; text: string }> = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const start = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    if (start < durationMs) starts.push({ start, text: m[4] });
  }
  starts.sort((a, b) => a.start - b.start);
  return starts.map((s, i) => ({ start: s.start, end: Math.min(durationMs, starts[i + 1]?.start ?? durationMs), text: s.text })).filter((c) => c.end > c.start);
}
