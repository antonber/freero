// Board settings people pick from (board menu, command palette): one list for both, so a new
// background or grid option shows up everywhere at once.
import { GRID_SIZES, type BoardSettings } from '@freero/shared';

/** Board backgrounds, in menu order, with the names people see. */
export const BACKGROUNDS: ReadonlyArray<{ color: string; name: string }> = [
  { color: '#F3F2F8', name: 'Mist' },
  { color: '#FFFFFF', name: 'White' },
  { color: '#F6F1E7', name: 'Paper' },
  { color: '#EAF4EE', name: 'Sage' },
  { color: '#E9F1FB', name: 'Sky' },
  { color: '#F8ECF1', name: 'Blush' },
  { color: '#2A2838', name: 'Dusk' },
  { color: '#16151F', name: 'Night' },
];

export const GRID_STYLES: ReadonlyArray<{ value: BoardSettings['grid']; label: string }> = [
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Lines' },
  { value: 'none', label: 'None' },
];

export { GRID_SIZES };
