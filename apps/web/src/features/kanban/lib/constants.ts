import type { CardStatus, KanbanColumn } from '@freero/shared';

export const TOOL_ID = 'kanban';

/** Header accents for columns (Freero palette). */
export const COLUMN_COLORS = ['#8A89A3', '#2E9BF0', '#F5A524', '#1FA463', '#8B5CF6', '#E64DA6', '#14B8A6', '#E5484D'];

/** What a column's colour can be picked from (also what its cards get as accent). */
export const COLUMN_PALETTE = ['#8A89A3', '#2E9BF0', '#14B8A6', '#1FA463', '#84CC16', '#F5A524', '#F97316', '#E5484D', '#E64DA6', '#8B5CF6', '#5B3FF0', '#17162B'];
export const COLUMN_COLOR_NAMES: Record<string, string> = {
  '#8A89A3': 'Gray',
  '#2E9BF0': 'Blue',
  '#14B8A6': 'Teal',
  '#1FA463': 'Green',
  '#84CC16': 'Lime',
  '#F5A524': 'Amber',
  '#F97316': 'Orange',
  '#E5484D': 'Red',
  '#E64DA6': 'Pink',
  '#8B5CF6': 'Lavender',
  '#5B3FF0': 'Violet',
  '#17162B': 'Ink',
};

export const DEFAULT_COLUMNS: Array<Omit<KanbanColumn, 'id'>> = [
  { title: 'To do', status: 'todo', color: '#8A89A3' },
  { title: 'In progress', status: 'doing', color: '#2E9BF0' },
  { title: 'Done', status: 'done', color: '#1FA463' },
];

/** Card statuses a column can set (same values as task cards' own status). */
export const STATUS_LABELS: Record<CardStatus, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };

export const WIP_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

export const COLUMN_WIDTHS = [
  { id: 's', label: 'S', w: 220 },
  { id: 'm', label: 'M', w: 280 },
  { id: 'l', label: 'L', w: 360 },
];
