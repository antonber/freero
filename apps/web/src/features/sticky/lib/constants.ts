import { STICKY_COLORS, type StickyColor, type StickyElement } from '@freero/shared';

export const STICKY_SIZE = 200;
/** Gap between a sticky and the next one created with Tab / Mod+Enter. */
export const STICKY_GAP = 24;
export const DEFAULT_COLOR: StickyColor = 'yellow';
export const TOOL_ID = 'sticky';

export const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];
export const COLOR_HEX = COLOR_ORDER.map((c) => STICKY_COLORS[c]);
export const COLOR_NAMES: Record<string, string> = Object.fromEntries(
  COLOR_ORDER.map((c) => [STICKY_COLORS[c], c[0].toUpperCase() + c.slice(1)]),
);

export function colorFromHex(hex: string): StickyColor {
  const hit = COLOR_ORDER.find((c) => STICKY_COLORS[c].toLowerCase() === hex.toLowerCase());
  return hit ?? DEFAULT_COLOR;
}

/** The sticky paper closest to any css hex colour (a shape's blue fill → the sticky blue). */
export function nearestColor(hex: string): StickyColor {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return colorFromHex(hex);
  const [r, g, b] = rgb(hex);
  let best = DEFAULT_COLOR;
  let bestD = Infinity;
  for (const c of COLOR_ORDER) {
    const [r2, g2, b2] = rgb(STICKY_COLORS[c]);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

export const FONT_SIZES: Array<{ id: string; label: string; value: StickyElement['fontSize'] }> = [
  { id: 'auto', label: 'Auto', value: 'auto' },
  { id: 's', label: 'Small', value: 14 },
  { id: 'm', label: 'Medium', value: 20 },
  { id: 'l', label: 'Large', value: 28 },
  { id: 'xl', label: 'Extra large', value: 40 },
];

export interface StickyToolOptions {
  color?: StickyColor;
}
