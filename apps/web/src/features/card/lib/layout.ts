// Card geometry: the height is derived from the content (title wrap, description preview,
// footer), so `normalize` can keep it right after every edit. Pure and synchronous: text is
// measured with canvas metrics and wrapped arithmetically (the engine's equivalent isn't exported).
import type { CardElement } from '@freero/shared';
import { richTextToPlain } from '@engine';

export const CARD_W = 300;
export const CARD_MIN_W = 200;
export const PAD = { left: 22, right: 14, top: 13, bottom: 12 };
export const TITLE = { size: 15, weight: 600, line: 20 };
export const DESC = { size: 13, weight: 400, line: 18, maxLines: 3, gap: 4 };
export const FOOTER = { h: 24, gap: 10 };

const FONT_STACK = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

function measure(s: string, size: number, weight: number): number {
  const key = `${size}|${weight}|${s}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let w: number;
  if (ctx) {
    ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    w = ctx.measureText(s).width;
  } else w = s.length * size * 0.56;
  if (cache.size > 5000) cache.clear();
  cache.set(key, w);
  return w;
}

/** Wrapped line count of `text` in a box `width` px wide (overflow-wrap: anywhere). */
export function countLines(text: string, size: number, weight: number, width: number): number {
  // Canvas vs. DOM metrics: wrap a little early rather than clip a line.
  const max = Math.max(1, width * 0.96);
  const space = measure(' ', size, weight);
  let total = 0;
  for (const para of text.split('\n')) {
    let lines = 1;
    let x = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = measure(word, size, weight);
      if (w > max) {
        const pieces = Math.ceil(w / max);
        if (x > 0) lines++;
        lines += pieces - 1;
        x = w - (pieces - 1) * max;
      } else if (x === 0) x = w;
      else if (x + space + w <= max) x += space + w;
      else {
        lines++;
        x = w;
      }
    }
    total += lines;
  }
  return Math.max(1, total);
}

export interface CardLayout {
  titleLines: number;
  descLines: number;
  descText: string;
  h: number;
}

export function cardLayout(el: Pick<CardElement, 'w' | 'title' | 'description'>): CardLayout {
  const inner = Math.max(40, el.w - PAD.left - PAD.right);
  const titleLines = countLines(richTextToPlain(el.title ?? ''), TITLE.size, TITLE.weight, inner);
  const descText = richTextToPlain(el.description ?? '').trim();
  const descLines = descText ? Math.min(DESC.maxLines, countLines(descText, DESC.size, DESC.weight, inner)) : 0;
  const h =
    PAD.top +
    titleLines * TITLE.line +
    (descLines ? DESC.gap + descLines * DESC.line : 0) +
    FOOTER.gap +
    FOOTER.h +
    PAD.bottom;
  return { titleLines, descLines, descText, h };
}
