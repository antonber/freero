// The page's colour theme (#89). The app sets `data-theme="dark"` on <html> when the person chose
// dark (or System on a dark device), and in a live board view inside an AI assistant that is dark
// (app/lib/theme.ts). The chrome follows through ui/tokens.css.
//
// Board CONTENT is drawn as its authors made it: a yellow sticky stays yellow, a photo a photo,
// exports and thumbnails never change. On a dark page only the live canvas changes, at paint time
// and never in the doc:
//   - a light board background (and grid) is shown dark (`shownBackground`, darkFiltered keeps its
//     hue); a background the author made dark stays as it is;
//   - light frame fills are shown dark the same way (features/frame), so what sits on a frame
//     reads like what sits on the canvas;
//   - the DEFAULT inks (`canvasInk`: Freero's ink #17162B, its muted #4B4A63, plain black) are
//     painted light where they lie on the canvas: free text, lines, pen strokes, outlines and
//     text of unfilled shapes, frame titles. Any other colour is the author's choice and stays.
// Both work through CSS variables set on the live viewport only (canvas.css, Canvas.tsx), so an
// export rendered elsewhere falls back to the authored colours.
import { useSyncExternalStore } from 'react';

export type ColorTheme = 'light' | 'dark';

/** The theme the app set on the document (light unless it said dark). */
export function documentTheme(): ColorTheme {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Calls `cb` whenever the document's theme changes. */
export function subscribeDocumentTheme(cb: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => undefined;
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}

export function useDocumentTheme(): ColorTheme {
  return useSyncExternalStore(subscribeDocumentTheme, documentTheme, () => 'light');
}

// DARK_FILTER = `invert(0.93) hue-rotate(180deg)` (canvas.css), applied to a colour in sRGB.
const INVERT = 0.93;
const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** `#rrggbb` as DARK_FILTER draws it; anything that isn't a hex colour comes back unchanged. */
export function darkFiltered(color: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return color;
  const inv = [m[1], m[2], m[3]].map((h) => clamp(INVERT + (parseInt(h, 16) / 255) * (1 - 2 * INVERT)));
  const out = HUE_180.map((row) => clamp(row[0] * inv[0] + row[1] * inv[1] + row[2] * inv[2]));
  return `#${out.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative brightness of `#rrggbb` (0–1); anything else counts as light. */
export function lightness(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A surface (board background, frame fill) dark mode shows dark: a light one. */
export const isLightSurface = (color: string | undefined | null): boolean => !!color && color !== 'transparent' && lightness(color) > 0.55;

/** The board background as shown in `theme`: a light one turns dark, keeping its hue. */
export function shownBackground(background: string, theme: ColorTheme): string {
  return theme === 'dark' && isLightSurface(background) ? darkFiltered(background) : background;
}

const DEFAULT_INKS: Record<string, string> = {
  '#17162b': '--fr-canvas-ink',
  '#000000': '--fr-canvas-ink',
  '#000': '--fr-canvas-ink',
  '#4b4a63': '--fr-canvas-ink-2',
  '#1f1a33': '--fr-canvas-ink', // an icon's default
  '#2b2a44': '--fr-canvas-ink', // a connector's default
};

/**
 * How to paint `color` where it lies on the canvas (not on a paper of its own): a default ink is
 * painted light on a dark page (see the header), anything else as authored. A CSS value: use it in
 * `style` (SVG: as `color`, with `stroke` / `fill` = currentColor). Undefined stays undefined.
 */
export function canvasInk<T extends string | undefined | null>(color: T): T | string {
  if (!color) return color;
  const v = DEFAULT_INKS[color.toLowerCase()];
  return v ? `var(${v}, ${color})` : color;
}

/** The board background where it shows through (connector label knock-outs, hollow arrow heads). */
export const canvasPaper = (background: string): string => `var(--fr-canvas-paper, ${background})`;
