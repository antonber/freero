// What an offscreen picture draws, and how its work is cut up (export.tsx renders the plan).
//
// html-to-image copies every computed style property of every DOM node it rasterizes, on the main
// thread, in one go: ~0.5 ms per node. A 2,000-card board is ~50,000 nodes, so the board thumbnail
// froze the page for half a minute after every edit. Two rules keep that bounded:
//  - A thumbnail draws in full only what is big enough on the picture to show detail. Smaller
//    items are boxes in the colour they read as (`ElementDefinition.swatch`), painted on a canvas
//    in a few milliseconds; lines thinner than a pixel are left out. At most MAX_DETAILED items are
//    drawn in full (the biggest), however dense the board.
//  - The DOM part is rasterized in chunks of a bounded number of nodes, one chunk per task, so the
//    page keeps answering in between (explicit exports keep full fidelity this way: same pixels,
//    just not in one blocking task).
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';

/** An item at least this many pixels long on a thumbnail is drawn in full (else as a box). */
export const DETAIL_MIN_PX = 16;
/** At most this many items of a thumbnail are drawn in full; the rest are boxes. */
export const MAX_DETAILED = 150;
/** Items smaller than this on the picture, both ways, are left out of a thumbnail. */
const MIN_PX = 0.5;
/** DOM nodes rasterized per task (~0.75 ms each in Chrome): keeps each task near 50 ms. */
export const CHUNK_NODES = 50;

export type PaintStep<T> = { kind: 'dom'; items: T[] } | { kind: 'boxes'; items: Array<{ el: BoardElement; color: string }> };

const NEUTRAL = '#B9B7CC';

/** The colour an item reads as when it is only a few pixels big (see ElementDefinition.swatch). */
export function swatchOf(el: BoardElement, def: Pick<ElementDefinition, 'swatch'> | undefined): string | null {
  if (def?.swatch) return def.swatch(el as never);
  const rec = el as unknown as Record<string, unknown>;
  for (const key of ['fill', 'color', 'stroke']) {
    const c = rec[key];
    if (typeof c === 'string' && c && c !== 'transparent' && c !== 'none') return c;
  }
  return NEUTRAL;
}

/**
 * A thumbnail's plan, in render order: runs of items drawn in full (`dom`) and runs of boxes.
 * `scale` is picture pixels per world unit. Order is kept exactly, so a box never covers an item
 * drawn above it.
 */
export function planThumbnail(
  elements: BoardElement[],
  scale: number,
  swatch: (el: BoardElement) => string | null,
  limits: { minPx?: number; maxDetailed?: number } = {},
): Array<PaintStep<BoardElement>> {
  const minPx = limits.minPx ?? DETAIL_MIN_PX;
  const maxDetailed = limits.maxDetailed ?? MAX_DETAILED;
  const size = (el: BoardElement) => Math.max(el.w, el.h) * scale;
  let detailed = elements.filter((el) => size(el) >= minPx);
  if (detailed.length > maxDetailed) {
    const area = (el: BoardElement) => el.w * el.h;
    detailed = [...detailed].sort((a, b) => area(b) - area(a)).slice(0, maxDetailed);
  }
  const full = new Set(detailed);
  const steps: Array<PaintStep<BoardElement>> = [];
  for (const el of elements) {
    if (full.has(el)) {
      const last = steps[steps.length - 1];
      if (last?.kind === 'dom') last.items.push(el);
      else steps.push({ kind: 'dom', items: [el] });
      continue;
    }
    if (el.w * scale < MIN_PX && el.h * scale < MIN_PX) continue;
    const color = swatch(el);
    if (!color) continue;
    const last = steps[steps.length - 1];
    if (last?.kind === 'boxes') last.items.push({ el, color });
    else steps.push({ kind: 'boxes', items: [{ el, color }] });
  }
  return steps;
}

/**
 * Cuts a run into chunks of about `budget` cost each, in order. An item that must be composited on
 * its own (a blend mode) gets a chunk of its own; an item costlier than the budget too.
 */
export function chunkByCost<T>(items: T[], cost: (item: T) => number, budget: number, alone: (item: T) => boolean = () => false): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let sum = 0;
  for (const item of items) {
    const c = cost(item);
    if (alone(item)) {
      if (cur.length) chunks.push(cur);
      chunks.push([item]);
      cur = [];
      sum = 0;
      continue;
    }
    if (cur.length && sum + c > budget) {
      chunks.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(item);
    sum += c;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
