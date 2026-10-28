import type { CardStatus, KanbanColumn } from '@freero/shared';

export const TOOL_ID = 'kanban';

/** Header accents for columns (Freero palette). */
export const COLUMN_COLORS = ['#8A89A3', '#2E9BF0', '#F5A524', '#1FA463', '#8B5CF6', '#E64DA6', '#14B8A6', '#E5484D'];

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
