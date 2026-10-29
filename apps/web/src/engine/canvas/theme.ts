// The page's colour theme (#89). The app sets `data-theme="dark"` on <html> where a page follows a
// dark surrounding (a live board view in an AI assistant follows the assistant's theme). The chrome
// follows through ui/tokens.css. The board's CONTENT keeps its light-theme colours (`.fr-paper`: the
// same colours exports and thumbnails show, so nothing a person makes depends on who looks at it)
// and is drawn through DARK_FILTER (canvas.css); the canvas background goes through the same
// function here, so content and canvas always agree — white cards and frames turn dark, ink turns
// light, sticky notes keep their hue. Photos, video and frames are turned back (canvas.css).
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

/** The board background as shown in `theme`. */
export function shownBackground(background: string, theme: ColorTheme): string {
  return theme === 'dark' ? darkFiltered(background) : background;
}
