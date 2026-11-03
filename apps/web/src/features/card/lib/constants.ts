import type { CardElement, StickyColor } from '@freero/shared';

export const TOOL_ID = 'card';
export const DEFAULT_ACCENT = '#5B3FF0';

export const ACCENTS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#84CC16', '#F5A524', '#F97316', '#E5484D', '#E64DA6', '#8B5CF6', '#8A89A3', '#17162B'];
export const ACCENT_NAMES: Record<string, string> = {
  '#5B3FF0': 'Freero violet',
  '#2E9BF0': 'Blue',
  '#14B8A6': 'Teal',
  '#1FA463': 'Green',
  '#84CC16': 'Lime',
  '#F5A524': 'Amber',
  '#F97316': 'Orange',
  '#E5484D': 'Red',
  '#E64DA6': 'Pink',
  '#8B5CF6': 'Lavender',
  '#8A89A3': 'Gray',
  '#17162B': 'Ink',
};

/** Accent a converted sticky keeps: a stronger tone of its paper color. */
export const STICKY_ACCENT: Record<StickyColor, string> = {
  yellow: '#F5A524',
  lemon: '#EAB308',
  orange: '#F97316',
  coral: '#E5484D',
  pink: '#E64DA6',
  violet: '#8B5CF6',
  blue: '#2E9BF0',
  cyan: '#14B8A6',
  green: '#1FA463',
  lime: '#84CC16',
  gray: '#8A89A3',
  white: '#5B3FF0',
  // Saturated and dark papers are strong already: the card keeps the paper itself.
  sun: '#F5A524',
  tangerine: '#F97316',
  red: '#D93036',
  magenta: '#C2338A',
  purple: '#6A4BE0',
  royal: '#1F66D1',
  teal: '#0B7A7C',
  pine: '#1E7A45',
  navy: '#1F2A5C',
  plum: '#5B2A6E',
  cocoa: '#6B4A32',
  charcoal: '#2A2938',
};

/** Papers of a flip card's back (#142): light, so the ink text reads on all of them. */
export const BACK_COLORS = ['#FFF1B8', '#FFE1D2', '#FFD9EC', '#E6DEFF', '#D7ECFF', '#D2F4E6', '#E9F7C8', '#F1F1F5'];
export const BACK_COLOR_NAMES: Record<string, string> = {
  '#FFF1B8': 'Butter',
  '#FFE1D2': 'Peach',
  '#FFD9EC': 'Blush',
  '#E6DEFF': 'Lilac',
  '#D7ECFF': 'Sky',
  '#D2F4E6': 'Mint',
  '#E9F7C8': 'Pistachio',
  '#F1F1F5': 'Cloud',
};
/** The text part a flip card's back is edited as (ElementDefinition.textPartAt). */
export const BACK_PART = 'back';

export type CardStatus =NonNullable<CardElement['status']>;
export const STATUSES: Array<{ value: CardStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
];

export interface CardToolOptions {
  color?: string;
}
