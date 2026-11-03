// The board's typefaces: one table for the font menu, the DOM (ElementText, measure) and canvas
// metrics (autofit), so what is measured is what is drawn. Every family is self-hosted and openly
// licensed (scripts/fonts.mjs vendors them). The app's four (sans, serif, mono, hand) come with the
// design tokens (ui/fonts); the others' @font-face rules ride in the board's chunk (./fonts/fonts.css)
// and a file is fetched only when text in it is drawn. Each stack ends in system fonts that cover
// Chinese, Japanese and Korean, so CJK text never falls back to boxes.
import type { FontFamily } from '@freero/shared';
import './fonts/fonts.css';

const CJK_SANS = "'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', 'Malgun Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans SC'";
const CJK_SERIF = "'Hiragino Mincho ProN', 'Songti SC', 'SimSun', 'Batang', 'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif SC'";

export type FontGroup = 'Sans' | 'Serif' | 'Mono' | 'Handwritten';

export interface FontInfo {
  /** The name people know it by (the font menu shows it in itself). */
  label: string;
  group: FontGroup;
  /** CSS font-family stack: the web font, then system and CJK fallbacks. */
  stack: string;
  /** What DOM text uses: the design token for the app's own four, else the stack. */
  css: string;
}

const sans = (face: string) => `${face}, system-ui, -apple-system, 'Segoe UI', ${CJK_SANS}, sans-serif`;
const serif = (face: string) => `${face}, Georgia, ${CJK_SERIF}, serif`;
const mono = (face: string) => `${face}, ui-monospace, Menlo, Consolas, ${CJK_SANS}, monospace`;
const hand = (face: string) => `${face}, 'Comic Sans MS', ${CJK_SANS}, cursive`;

/** In menu order: the familiar four first, then by group. Ids are stored on items: only ever add. */
export const FONTS: Record<FontFamily, FontInfo> = {
  sans: { label: 'Inter', group: 'Sans', stack: sans('Inter'), css: 'var(--fr-font)' },
  serif: { label: 'Source Serif', group: 'Serif', stack: serif("'Source Serif 4'"), css: 'var(--fr-font-serif)' },
  mono: { label: 'JetBrains Mono', group: 'Mono', stack: mono("'JetBrains Mono'"), css: 'var(--fr-font-mono)' },
  hand: { label: 'Caveat', group: 'Handwritten', stack: hand('Caveat'), css: 'var(--fr-font-hand)' },
  legible: { label: 'Atkinson Hyperlegible', group: 'Sans', stack: sans("'Atkinson Hyperlegible'"), css: '' },
  rounded: { label: 'Nunito', group: 'Sans', stack: sans('Nunito'), css: '' },
  geometric: { label: 'Montserrat', group: 'Sans', stack: sans('Montserrat'), css: '' },
  grotesk: { label: 'Space Grotesk', group: 'Sans', stack: sans("'Space Grotesk'"), css: '' },
  condensed: { label: 'Oswald', group: 'Sans', stack: sans('Oswald'), css: '' },
  book: { label: 'Lora', group: 'Serif', stack: serif('Lora'), css: '' },
  display: { label: 'Playfair Display', group: 'Serif', stack: serif("'Playfair Display'"), css: '' },
  slab: { label: 'Bitter', group: 'Serif', stack: serif('Bitter'), css: '' },
  typewriter: { label: 'Courier Prime', group: 'Mono', stack: mono("'Courier Prime'"), css: '' },
  print: { label: 'Patrick Hand', group: 'Handwritten', stack: hand("'Patrick Hand'"), css: '' },
  marker: { label: 'Permanent Marker', group: 'Handwritten', stack: hand("'Permanent Marker'"), css: '' },
};
for (const f of Object.values(FONTS)) if (!f.css) f.css = f.stack;

/** A family this client may not know (written by a newer one) reads as Inter. */
export const fontOf = (family: string | undefined): FontInfo => FONTS[family as FontFamily] ?? FONTS.sans;
