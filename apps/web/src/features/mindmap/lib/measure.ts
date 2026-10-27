// Node sizing: a pill hugging its text. Used by `normalize`, which must be pure and synchronous,
// so text is measured with canvas metrics (no layout) and wrapped arithmetically.
// (The engine has the same machinery for auto-fit text but doesn't export it; see report.)

export const NODE_STYLE = {
  root: { font: 20, weight: 700, padX: 26, padY: 14, minW: 150, maxText: 300 },
  node: { font: 15, weight: 500, padX: 16, padY: 8, minW: 64, maxText: 260 },
} as const;
export const LINE_HEIGHT = 1.3;

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

/** Widest line and line count of `text` wrapped at `max` px. */
function wrap(text: string, size: number, weight: number, max: number): { width: number; lines: number } {
  const space = measure(' ', size, weight);
  let width = 0;
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let x = 0;
    lines++;
    for (const word of words) {
      const w = measure(word, size, weight);
      if (x === 0) {
        if (w > max) {
          const pieces = Math.ceil(w / max);
          lines += pieces - 1;
          width = max;
          x = w - (pieces - 1) * max;
        } else x = w;
      } else if (x + space + w <= max) x += space + w;
      else {
        width = Math.max(width, x);
        lines++;
        x = Math.min(w, max);
      }
    }
    width = Math.max(width, x);
  }
  return { width, lines };
}

export function nodeSize(plain: string, isRoot: boolean): { w: number; h: number } {
  const s = isRoot ? NODE_STYLE.root : NODE_STYLE.node;
  const { width, lines } = wrap(plain, s.font, s.weight, s.maxText);
  // Small slack: canvas metrics vs. DOM layout (and fonts still loading) must not cause a wrap.
  const w = Math.max(s.minW, Math.ceil(width * 1.04 + 4 + s.padX * 2));
  const h = Math.ceil(Math.max(1, lines) * s.font * LINE_HEIGHT + s.padY * 2);
  return { w, h };
}
