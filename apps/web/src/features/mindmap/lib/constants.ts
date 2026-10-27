export const TOOL_ID = 'mindmap';

/** Root pill fill. Freero violet. */
export const ROOT_COLOR = '#5B3FF0';

/** Branch palette: each first-level branch takes the least-used color, descendants inherit it. */
export const BRANCH_COLORS = ['#FF6B5B', '#2E9BF0', '#1FA463', '#F5A524', '#E64DA6', '#14B8A6', '#8B5CF6', '#F97316'];

export const ROOT_COLORS = ['#5B3FF0', '#17162B', '#2E9BF0', '#1FA463', '#E5484D', '#F97316', '#E64DA6', '#14B8A6'];

export const COLOR_NAMES: Record<string, string> = {
  '#FF6B5B': 'Coral',
  '#2E9BF0': 'Blue',
  '#1FA463': 'Green',
  '#F5A524': 'Amber',
  '#E64DA6': 'Pink',
  '#14B8A6': 'Teal',
  '#8B5CF6': 'Violet',
  '#F97316': 'Orange',
  '#5B3FF0': 'Freero violet',
  '#17162B': 'Ink',
  '#E5484D': 'Red',
};

/** Radius of the collapse hub drawn at a node's outer edge; child edges start just past it. */
export const HUB_R = 5;
