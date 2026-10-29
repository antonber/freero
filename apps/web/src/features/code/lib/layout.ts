// Code block geometry. Lines never wrap (code keeps its shape), so the height follows the line
// count alone and no text has to be measured.
import type { CodeElement } from '@freero/shared';

export const FONT_SIZE = 13;
export const LINE_H = 20;
export const HEAD_H = 34;
export const PAD_Y = 12;
export const PAD_X = 14;
/** Monospace advance at FONT_SIZE (≈ 0.6 em), for sizing a pasted block to its longest line. */
export const CHAR_W = FONT_SIZE * 0.6;
export const MIN_W = 220;
export const MAX_AUTO_W = 880;
export const DEFAULT_W = 480;
/** Tabs show four columns wide. */
export const TAB = 4;

export const lineCount = (code: string): number => Math.max(1, code.split('\n').length);

export const gutterWidth = (el: Pick<CodeElement, 'code' | 'lineNumbers'>): number =>
  el.lineNumbers ? Math.max(2, String(lineCount(el.code)).length) * CHAR_W + 18 : 0;

export const heightOf = (code: string): number => HEAD_H + PAD_Y * 2 + lineCount(code) * LINE_H;

/** A width that shows the longest line (tabs at TAB columns), within sensible bounds. */
export function widthFor(el: Pick<CodeElement, 'code' | 'lineNumbers'>): number {
  const cols = Math.max(...el.code.split('\n').map((l) => l.replace(/\t/g, ' '.repeat(TAB)).length), 24);
  return Math.round(Math.min(MAX_AUTO_W, Math.max(MIN_W, cols * CHAR_W + PAD_X * 2 + gutterWidth(el) + 4)));
}
