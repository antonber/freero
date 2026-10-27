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
};

export type CardStatus = NonNullable<CardElement['status']>;
export const STATUSES: Array<{ value: CardStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
];

export interface CardToolOptions {
  color?: string;
}
