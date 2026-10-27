// fontSize: 'auto' — pick the largest font size whose wrapped text fits the box.
// Words are measured ONCE at a reference size with canvas measureText (no layout), then
// wrapping at any size is pure arithmetic, so fitting 2000 stickies stays cheap.
import type { FontFamily } from '@freero/shared';

export const LINE_HEIGHT = 1.3;
const REF = 100;

export const FONT_STACKS: Record<FontFamily, string> = {
  sans: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  hand: "Caveat, 'Comic Sans MS', cursive",
};

export const FONT_VARS: Record<FontFamily, string> = {
  sans: 'var(--fr-font)',
  serif: 'var(--fr-font-serif)',
  mono: 'var(--fr-font-mono)',
  hand: 'var(--fr-font-hand)',
};

let ctx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
let fontEpoch = 0;
const epochListeners = new Set<() => void>();

function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Width of `s` at the reference size. Falls back to an average-glyph estimate without canvas. */
export function measureRef(s: string, family: FontFamily, bold = false): number {
  const key = `${family}|${bold ? 1 : 0}|${s}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  const c = measureCtx();
  let w: number;
  if (c) {
    c.font = `${bold ? 700 : 400} ${REF}px ${FONT_STACKS[family]}`;
    w = c.measureText(s).width;
  } else {
    w = s.length * REF * (family === 'mono' ? 0.6 : family === 'hand' ? 0.45 : 0.55);
  }
  if (widths.size > 20000) widths.clear();
  widths.set(key, w);
  return w;
}

/** Number of wrapped lines `text` takes at font size `size` in a box `width` wide. */
export function countLines(text: string, family: FontFamily, size: number, width: number): number {
  const k = size / REF;
  const space = measureRef(' ', family) * k;
  let total = 0;
  for (const line of text.split('\n')) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      total += 1;
      continue;
    }
    let lines = 1;
    let x = 0;
    for (const word of words) {
      const w = measureRef(word, family, true) * k;
      if (w > width) {
        // Long word: browsers break it anywhere (overflow-wrap: anywhere).
        const pieces = Math.ceil(w / width);
        if (x > 0) lines++;
        lines += pieces - 1;
        x = w - (pieces - 1) * width;
        continue;
      }
      if (x === 0) x = w;
      else if (x + space + w <= width) x += space + w;
      else {
        lines++;
        x = w;
      }
    }
    total += lines;
  }
  return total;
}

export interface FitOptions {
  min?: number;
  max?: number;
}

/** Largest font size (0.5px steps) in [min, max] at which `text` fits in w×h. */
export function fitFontSize(text: string, family: FontFamily, w: number, h: number, opts: FitOptions = {}): number {
  const min = opts.min ?? 6;
  const max = Math.max(min, opts.max ?? 64);
  // Small safety margin: canvas metrics vs. DOM layout, bold/italic runs.
  const width = Math.max(1, w * 0.94);
  const height = Math.max(1, h);
  if (!text.trim()) return max;
  // Words only break mid-word when even the minimum size can't fit them.
  let longest = 0;
  for (const word of text.split(/\s+/)) if (word) longest = Math.max(longest, measureRef(word, family, true));
  const fits = (s: number) =>
    (longest * s) / REF <= width && countLines(text, family, s, width) * s * LINE_HEIGHT <= height;
  const fitsBroken = (s: number) => countLines(text, family, s, width) * s * LINE_HEIGHT <= height;
  if (fits(max)) return max;
  const test = fits(min) ? fits : fitsBroken;
  if (!test(min)) return min;
  let lo = min;
  let hi = max;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}

/** Default max font size for an auto-fit box: proportional to the box, so big stickies get big text. */
export function autoMaxFont(w: number, h: number): number {
  return Math.max(10, Math.min(w, h) / 4.2);
}

export function getFontEpoch(): number {
  return fontEpoch;
}

export function subscribeFontEpoch(l: () => void): () => void {
  epochListeners.add(l);
  return () => epochListeners.delete(l);
}

if (typeof document !== 'undefined' && (document as Document & { fonts?: FontFaceSet }).fonts) {
  const bump = () => {
    widths.clear();
    fontEpoch++;
    for (const l of [...epochListeners]) l();
  };
  document.fonts.ready.then(bump).catch(() => undefined);
  document.fonts.addEventListener?.('loadingdone', bump);
}
