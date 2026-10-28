// Pure frame helpers: presets, ordering, naming, adoption and fitting (unit-tested).
import type { BoardElement, FrameElement } from '@freero/shared';
import type { Rect } from '@engine';

export type FramePreset = NonNullable<FrameElement['preset']>;

export const TOOL_ID = 'frame';
export const PANEL_ID = 'frame.panel';
export const DEFAULT_FILL = '#FFFFFF';
/** Padding around content for "Frame selection" and "Fit to content". */
export const CONTENT_PADDING = 40;

export const PRESETS: Array<{ id: FramePreset; label: string; w: number; h: number; hint: string }> = [
  { id: '16:9', label: '16:9', w: 1280, h: 720, hint: 'Slides' },
  { id: '4:3', label: '4:3', w: 1024, h: 768, hint: 'Classic slides' },
  { id: '1:1', label: '1:1', w: 800, h: 800, hint: 'Square' },
  { id: 'a4', label: 'A4', w: 794, h: 1123, hint: '210 × 297 mm' },
  { id: 'letter', label: 'Letter', w: 816, h: 1056, hint: '8.5 × 11 in' },
  { id: 'mobile', label: 'Mobile', w: 390, h: 844, hint: 'Phone screen' },
  { id: 'tablet', label: 'Tablet', w: 820, h: 1180, hint: 'Tablet screen' },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 1024, hint: 'Web page' },
  { id: 'custom', label: 'Custom', w: 960, h: 640, hint: 'Drag to size' },
];

export const presetById = (id: FramePreset | undefined) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export const isFrame = (el: BoardElement | undefined | null): el is FrameElement => el?.type === 'frame';

/** Frames in presentation / panel order (index, then creation time, then id for a stable tie-break). */
export function orderFrames(frames: readonly FrameElement[]): FrameElement[] {
  return [...frames].sort((a, b) => a.index - b.index || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Index for a newly created frame: after every existing one. */
export function nextFrameIndex(frames: readonly FrameElement[]): number {
  return frames.reduce((m, f) => Math.max(m, Number.isFinite(f.index) ? f.index : 0), -1) + 1;
}

/** "Frame N" with N one past the frame count, skipping titles already on the board. */
export function nextFrameTitle(frames: readonly FrameElement[]): string {
  const taken = new Set(frames.map((f) => f.title.trim().toLowerCase()));
  let n = frames.length + 1;
  while (taken.has(`frame ${n}`)) n++;
  return `Frame ${n}`;
}

/**
 * Drag-reorder: moves `id` into insertion slot `slot` of the current order (0 = before the first
 * frame, n = after the last) and returns the index patches that make every frame's `index` equal
 * its new position (only frames whose index changes are patched).
 */
export function reorderPatches(frames: readonly FrameElement[], id: string, slot: number): Array<{ id: string; index: number }> {
  const list = orderFrames(frames);
  const from = list.findIndex((f) => f.id === id);
  if (from < 0) return [];
  const [moved] = list.splice(from, 1);
  const to = slot > from ? slot - 1 : slot; // slots after the dragged frame shift up once it is lifted out
  list.splice(Math.max(0, Math.min(list.length, to)), 0, moved);
  return list.flatMap((f, i) => (f.index === i ? [] : [{ id: f.id, index: i }]));
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const containsPoint = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Elements a frame at `rect` takes ownership of: non-frames whose bounds center lies inside it
 * (the same rule the engine uses when an element is dropped into a frame).
 */
export function adoptableIds(rect: Rect, items: ReadonlyArray<{ el: BoardElement; bounds: Rect }>): string[] {
  return items.filter(({ el, bounds }) => el.type !== 'frame' && containsPoint(rect, center(bounds))).map(({ el }) => el.id);
}

/**
 * frameId changes after `frame` was created or changed its rect: elements whose center is inside
 * join it (from no frame, or from a larger frame — the innermost frame wins); members whose center
 * is now outside leave. `frameArea` returns another frame's area (undefined if it no longer exists).
 */
export function membershipPatches(
  frame: Rect & { id: string },
  items: ReadonlyArray<{ el: BoardElement; bounds: Rect }>,
  frameArea: (id: string) => number | undefined,
): Array<{ id: string; frameId: string | null }> {
  const inside = new Set(adoptableIds(frame, items));
  const out: Array<{ id: string; frameId: string | null }> = [];
  for (const { el } of items) {
    if (el.type === 'frame') continue;
    const isIn = inside.has(el.id);
    if (el.frameId === frame.id) {
      if (!isIn) out.push({ id: el.id, frameId: null });
      continue;
    }
    if (!isIn) continue;
    const parentArea = el.frameId ? frameArea(el.frameId) : undefined;
    if (parentArea === undefined || parentArea > frame.w * frame.h) out.push({ id: el.id, frameId: frame.id });
  }
  return out;
}

/** Rect that wraps `content` with `padding` on every side (rounded to whole units). */
export function padRect(content: Rect, padding = CONTENT_PADDING): Rect {
  const x = Math.floor(content.x - padding);
  const y = Math.floor(content.y - padding);
  return { x, y, w: Math.ceil(content.x + content.w + padding) - x, h: Math.ceil(content.y + content.h + padding) - y };
}

/** Same-center resize of a frame to a preset's aspect: keeps the frame's area roughly the same. */
export function applyPresetSize(frame: Rect, preset: FramePreset): Rect {
  if (preset === 'custom') return frame;
  const p = presetById(preset);
  const area = frame.w * frame.h;
  const k = Math.sqrt(area / (p.w * p.h));
  const w = Math.round(p.w * k);
  const h = Math.round(p.h * k);
  const c = center(frame);
  return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
}

/** Rect of a frame drawn from `a` to `b`; Shift keeps the preset's aspect ratio. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, aspect: number | null): Rect {
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (aspect) {
    if (w / Math.max(h, 1) > aspect) h = w / aspect;
    else w = h * aspect;
  }
  const x = b.x < a.x ? a.x - w : a.x;
  const y = b.y < a.y ? a.y - h : a.y;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
