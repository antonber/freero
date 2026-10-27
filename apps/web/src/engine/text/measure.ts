// measureRichText: the size rich text takes when <ElementText> renders it. Features call it from
// `normalize` (pure + synchronous), so stored frames match what is drawn: text boxes hugging
// their text, card titles, mind-map pills.
//
// It lays the HTML out in one hidden offscreen node that uses ElementText's own classes
// (.fr-text / .fr-text-content: same wrapping rules, list styles, line height) — not a copy of
// its metrics. Without layout (tests, SSR) it falls back to canvas/estimated word widths.
// Results are cached until web fonts change (see autofit.ts font epoch).
import type { FontFamily } from '@freero/shared';
import { FONT_VARS, LINE_HEIGHT, measureRef, subscribeFontEpoch } from './autofit';
import { richTextToPlain, sanitizeRichText } from './sanitize';
import './text.css';

export interface MeasureTextOptions {
  /** Default 'sans'. */
  fontFamily?: FontFamily;
  fontSize: number;
  /** Default 400. */
  fontWeight?: number;
  /** Multiple of fontSize. Default ElementText's (1.3). */
  lineHeight?: number;
  /** Fixed wrapping width of the text itself (padding excluded); the result's w is width + 2·padding. */
  width?: number;
  /** Hug the text, wrapping only past this width (padding excluded). */
  maxWidth?: number;
  /** Inner padding on every side, included in the result. Default 0. */
  padding?: number;
  /** Match a renderer that keeps spaces (`.fr-text { white-space: pre-wrap }`). Default 'normal'. */
  whiteSpace?: 'normal' | 'pre-wrap';
}

export interface MeasuredText {
  /** Box width including padding: `width` when fixed, else the widest line (rounded up). */
  w: number;
  /** Box height including padding (rounded up). */
  h: number;
  /** Rendered line count (wrapped lines + explicit breaks). */
  lines: number;
}

let box: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
const cache = new Map<string, MeasuredText>();
subscribeFontEpoch(() => cache.clear());

function nodes(): { box: HTMLDivElement; content: HTMLDivElement } | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!box || !box.isConnected) {
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.className = 'fr-text';
    content = document.createElement('div');
    content.className = 'fr-text-content';
    box.appendChild(content);
    document.body.appendChild(box);
  }
  return { box, content: content! };
}

/** Widest line and line count of plain text, from word widths (no layout available). */
function estimate(plain: string, family: FontFamily, size: number, bold: boolean, wrapAt: number | null) {
  const k = size / 100;
  const space = measureRef(' ', family) * k;
  let width = 0;
  let lines = 0;
  for (const para of plain.split('\n')) {
    lines++;
    let x = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = measureRef(word, family, bold) * k;
      if (wrapAt !== null && w > wrapAt) {
        // overflow-wrap: anywhere
        const pieces = Math.ceil(w / wrapAt);
        if (x > 0) lines++;
        lines += pieces - 1;
        width = wrapAt;
        x = w - (pieces - 1) * wrapAt;
      } else if (x === 0) x = w;
      else if (wrapAt === null || x + space + w <= wrapAt) x += space + w;
      else {
        width = Math.max(width, x);
        lines++;
        x = w;
      }
    }
    width = Math.max(width, x);
  }
  return { width, lines: Math.max(1, lines) };
}

export function measureRichText(html: string, opts: MeasureTextOptions): MeasuredText {
  const family = opts.fontFamily ?? 'sans';
  const size = opts.fontSize;
  const weight = opts.fontWeight ?? 400;
  const lh = opts.lineHeight ?? LINE_HEIGHT;
  const pad = opts.padding ?? 0;
  const fixed = opts.width ?? null;
  const max = fixed === null ? (opts.maxWidth ?? null) : null;
  const ws = opts.whiteSpace ?? 'normal';
  const key = `${family}|${size}|${weight}|${lh}|${pad}|${fixed ?? ''}|${max ?? ''}|${ws}|${html}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const lineH = size * lh;
  let out: MeasuredText | null = null;
  const n = nodes();
  if (n) {
    const s = n.box.style;
    s.cssText =
      'position:absolute;left:-100000px;top:0;right:auto;bottom:auto;visibility:hidden;pointer-events:none;contain:layout style;box-sizing:border-box;';
    s.fontFamily = FONT_VARS[family];
    s.fontSize = `${size}px`;
    s.fontWeight = String(weight);
    s.lineHeight = String(lh);
    s.padding = `${pad}px`;
    s.whiteSpace = ws;
    if (fixed !== null) s.width = `${fixed + pad * 2}px`;
    else {
      s.width = 'max-content';
      if (max !== null) s.maxWidth = `${max + pad * 2}px`;
      else s.whiteSpace = ws === 'pre-wrap' ? 'pre' : 'nowrap';
    }
    n.content.innerHTML = sanitizeRichText(html);
    const r = n.box.getBoundingClientRect();
    // jsdom has no layout: fall through to the estimate.
    if (r.width || r.height) {
      out = {
        w: fixed !== null ? fixed + pad * 2 : Math.ceil(r.width),
        h: Math.ceil(r.height),
        lines: Math.max(1, Math.round((r.height - pad * 2) / lineH)),
      };
    }
  }
  if (!out) {
    const e = estimate(richTextToPlain(html), family, size, weight >= 600, fixed ?? max);
    out = {
      w: fixed !== null ? fixed + pad * 2 : Math.ceil(e.width + pad * 2),
      h: Math.ceil(e.lines * lineH + pad * 2),
      lines: e.lines,
    };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, out);
  return out;
}
