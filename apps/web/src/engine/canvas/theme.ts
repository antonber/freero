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
//   - an item's ink (free text, lines, pen strokes, outlines and text of unfilled shapes) follows
//     what is shown BEHIND it, its backdrop (canvas/backdrop.ts works it out per item from the
//     surfaces beneath it, `inkOn` picks the colour):
//       · over a surface shown as authored (a white rectangle, a sticky, a card): as authored,
//         default inks too, so black text on a white box stays black;
//       · over a surface shown dark (the board background, a light frame fill): the DEFAULT inks
//         (Freero's ink #17162B, its muted #4B4A63, plain black) are painted light, and a colour
//         the author picked that would lose its contrast there (a dark brown heading) is drawn
//         through the same filter as the surface, so it keeps its relation to it. Colours that
//         still read (an olive label) stay as authored.
//     Frame titles and other ink outside any item take the default-ink rule (`canvasInk`).
// Both work through CSS variables and a context set on the live viewport only (canvas.css,
// Canvas.tsx, WorldLayer.tsx), so an export rendered elsewhere falls back to the authored colours.
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { BackdropContext } from '../context';

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
/** How strongly the board background (and content's DARK_FILTER) is turned. */
export const CANVAS_INVERT = INVERT;
const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** How strongly a light frame fill is turned (`.fr-canvas-surface`, canvas.css): a step lighter than the canvas. */
export const SURFACE_INVERT = 0.86;

/**
 * `#rrggbb` as DARK_FILTER draws it (`invert` 0.93; SURFACE_INVERT for frame fills); anything
 * that isn't a hex colour comes back unchanged.
 */
export function darkFiltered(color: string, invert = INVERT): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return color;
  const inv = [m[1], m[2], m[3]].map((h) => clamp(invert + (parseInt(h, 16) / 255) * (1 - 2 * invert)));
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

/** WCAG relative luminance of `#rrggbb` (null for anything else). */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours (1–21); null when either isn't one. */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Below this contrast with a darkened backdrop an authored ink is drawn through the surface's filter (WCAG's floor for large text and graphics). */
export const MIN_INK_CONTRAST = 3;

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

/** Whether `color` is one of the default inks (painted light on a dark canvas). */
export const isDefaultInk = (color: string | undefined | null): boolean => !!color && color.toLowerCase() in DEFAULT_INKS;

/**
 * What a dark page shows behind an item on the live canvas (canvas/backdrop.ts). `shown`: the
 * colour as painted. `invert`: the filter strength that turned a light surface dark (the board
 * background, a frame fill), or null when the surface is shown as authored (a shape's fill, a
 * sticky, a card). No backdrop at all (null) — a light page, an export, a background the author
 * made dark — paints inks by the default-ink rule (`canvasInk`).
 */
export interface Backdrop {
  readonly shown: string;
  readonly invert: number | null;
}

/** How to paint the ink `color` over `backdrop` (see the header). A CSS value; undefined stays undefined. */
export function inkOn<T extends string | undefined | null>(color: T, backdrop: Backdrop | null): T | string {
  if (!color || !backdrop) return canvasInk(color);
  // On a surface the page shows as its author made it, the author's colours read as they made them.
  if (backdrop.invert === null) return color;
  if (isDefaultInk(color)) return canvasInk(color);
  const c = contrast(color, backdrop.shown);
  return c !== null && c < MIN_INK_CONTRAST ? darkFiltered(color, backdrop.invert) : color;
}

/**
 * How to paint an ink inside an item's component: `inkOn` with what the live canvas shows behind
 * this item (default inks light on the canvas, as authored over a white box…). In an export it
 * is `canvasInk`, which falls back to the authored colour. A CSS value: use it in `style`.
 */
export function useCanvasInk(): <T extends string | undefined | null>(color: T) => T | string {
  const backdrop = useContext(BackdropContext);
  return useCallback(<T extends string | undefined | null>(color: T) => inkOn(color, backdrop), [backdrop]);
}

/** The board background where it shows through (connector label knock-outs, hollow arrow heads). */
export const canvasPaper = (background: string): string => `var(--fr-canvas-paper, ${background})`;
