// The board outline for the Layers panel: items grouped by the frame they sit in (frames in
// presentation order, loose items last), each group front-most first, and the z values that
// restack one item inside its group.
import type { BoardElement, FrameElement } from '@freero/shared';

export interface OutlineGroup {
  /** null = items not in any frame. */
  frame: FrameElement | null;
  /** Front-most first (descending z). */
  items: BoardElement[];
}

const byFrameOrder = (a: FrameElement, b: FrameElement) => (a.index ?? 0) - (b.index ?? 0) || a.y - b.y || a.x - b.x;

export function buildOutline(elements: BoardElement[]): OutlineGroup[] {
  const frames = elements.filter((el): el is FrameElement => el.type === 'frame').sort(byFrameOrder);
  const groups = new Map<string | null, OutlineGroup>(frames.map((f) => [f.id, { frame: f, items: [] }]));
  const loose: OutlineGroup = { frame: null, items: [] };
  for (const el of elements) {
    if (el.type === 'frame') continue;
    (groups.get(el.frameId ?? null) ?? loose).items.push(el);
  }
  const out = [...groups.values(), ...(loose.items.length ? [loose] : [])];
  for (const g of out) g.items.sort((a, b) => b.z - a.z);
  return out;
}

/**
 * Moves `id` to position `to` (0 = front) of `items` (front-most first) by giving it a z between
 * its new neighbours, so nothing else is rewritten and concurrent restacks of other items merge.
 * null when it would not move.
 */
export function restackZ(items: BoardElement[], id: string, to: number): number | null {
  const from = items.findIndex((el) => el.id === id);
  if (from < 0 || to === from || to === from + 1) return null;
  const rest = items.filter((el) => el.id !== id);
  const at = to > from ? to - 1 : to;
  const above = rest[at - 1];
  const below = rest[at];
  if (!above && !below) return null;
  if (!above) return below.z + 1;
  if (!below) return above.z - 1;
  return (above.z + below.z) / 2;
}

/** One line of preview text, or null. */
export function previewOf(text: string): string | null {
  const line = text
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
