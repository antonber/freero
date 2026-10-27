import type { FontFamily } from '@freero/shared';

export const TOOL_ID = 'text';
export const DEFAULT_FONT_SIZE = 20;
/** Below this drag distance (screen px) a press counts as a click. */
export const CLICK_SLOP_PX = 4;
/** Pasted text wider than this wraps in a fixed-width box instead of one endless line. */
export const PASTE_MAX_WIDTH = 640;

export const FONT_FAMILIES: Array<{ value: FontFamily; label: string }> = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'hand', label: 'Handwritten' },
];
export const FONT_SIZES = [10, 12, 14, 18, 20, 24, 32, 40, 48, 64, 80, 96, 144];

export const TEXT_COLORS = [
  '#17162B', '#4B4A63', '#8A89A3', '#FFFFFF', '#5B3FF0', '#2F80ED',
  '#13A8A8', '#1FA463', '#F5A524', '#F07A2E', '#E5484D', '#D64FA8',
];
export const HIGHLIGHT_COLORS = [
  'transparent', '#FFF3A3', '#FFC98B', '#FFA9A0', '#F9B9E0', '#D3C4FF',
  '#B5D6FF', '#A7EBEB', '#C2EFB0', '#E6E6EA', '#17162B', '#5B3FF0',
];
