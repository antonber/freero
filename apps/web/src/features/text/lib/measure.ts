// Measures a text box's content with an offscreen DOM node styled like <ElementText>, so the
// stored w/h match what renders (bold runs, lists, line breaks, real fonts).
import type { FontFamily } from '@freero/shared';
import { sanitizeRichText } from '@engine';
import { textPadding } from './layout';

/** Same as the engine's text line height (ElementText). */
const LINE_HEIGHT = 1.3;

const FONT_VARS: Record<FontFamily, string> = {
  sans: 'var(--fr-font)',
  serif: 'var(--fr-font-serif)',
  mono: 'var(--fr-font-mono)',
  hand: 'var(--fr-font-hand)',
};

let box: HTMLDivElement | null = null;
let content: HTMLDivElement | null = null;
const cache = new Map<string, { w: number; h: number }>();

function nodes(): { box: HTMLDivElement; content: HTMLDivElement } | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!box || !box.isConnected) {
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText =
      'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;display:flex;flex-direction:column;overflow-wrap:anywhere;word-break:normal;box-sizing:border-box;contain:layout style;';
    content = document.createElement('div');
    content.className = 'fr-text-content';
    box.appendChild(content);
    document.body.appendChild(box);
  }
  return { box, content: content! };
}

/**
 * Size of a text element's box for `html` at the given font. `wrapWidth` null = no wrapping
 * (auto width); otherwise the box is that wide and the height follows the wrapped lines.
 */
export function measureTextBox(
  html: string,
  family: FontFamily,
  fontSize: number,
  wrapWidth: number | null,
): { w: number; h: number } {
  const pad = textPadding(fontSize);
  const minW = Math.ceil(pad * 2 + fontSize * 0.6);
  const lineH = Math.ceil(fontSize * LINE_HEIGHT + pad * 2);
  const key = `${family}|${fontSize}|${wrapWidth ?? 'auto'}|${html}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = nodes();
  let out: { w: number; h: number };
  if (!n) {
    // No DOM (tests / SSR): rough estimate.
    const lines = html ? html.split(/<br\s*\/?>|<\/p>|<\/li>/i).length : 1;
    out = { w: wrapWidth ?? Math.max(minW, html.length * fontSize * 0.5 + pad * 2), h: lineH * lines };
  } else {
    const s = n.box.style;
    s.fontFamily = FONT_VARS[family];
    s.fontSize = `${fontSize}px`;
    s.lineHeight = String(LINE_HEIGHT);
    s.padding = `${pad}px`;
    s.whiteSpace = wrapWidth === null ? 'nowrap' : 'normal';
    s.width = wrapWidth === null ? 'max-content' : `${wrapWidth}px`;
    n.content.innerHTML = sanitizeRichText(html);
    const r = n.box.getBoundingClientRect();
    out = {
      w: wrapWidth ?? Math.max(minW, Math.ceil(r.width)),
      h: Math.max(lineH, Math.ceil(r.height)),
    };
    // jsdom has no layout: fall back to the estimate's shape.
    if (!r.width && !r.height) out = { w: wrapWidth ?? minW, h: lineH };
  }
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}
