import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, ListChecks, SlidersHorizontal } from 'lucide-react';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { addColumn, canMove, moveSelection, moveToColumn, type MoveDir } from './lib/actions';
import { FIELDS_PANEL, VIEW_PANEL } from './lib/constants';
import { fieldsTarget } from './lib/schema';
import { cleanFilter } from '@freero/shared';
import { saveViewForEveryone, setDensity, setMyCardDisplay, setMyFilter, setSort, setViewLocked } from './lib/view';
import { setGroupBy, setSwimlanes } from './lib/group';

const selectedKanban = (editor: Editor) => {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'kanban' && !el.locked ? el : null;
};

/**
 * Arrow keys on items stacked in a kanban move them between and within columns (the layout
 * would put a nudged item straight back). Only while the move is possible: at the edge the key
 * falls through to the engine's nudge, which the layout undoes, so nothing happens.
 */
const move = (dir: MoveDir, label: string, icon: CommandDefinition['icon'], shortcut: string): CommandDefinition => ({
  id: `kanban.move${dir[0].toUpperCase()}${dir.slice(1)}`,
  label,
  icon,
  shortcut,
  menus: ['context'],
  when: (editor) => canMove(editor, dir),
  run: (editor) => void moveSelection(editor, dir),
});

export default defineCommands([
  {
    id: 'kanban.addColumn',
    label: 'Add column',
    icon: Columns3,
    menus: ['context'],
    when: (editor) => !!selectedKanban(editor),
    run(editor) {
      const k = selectedKanban(editor);
      if (k) addColumn(editor, k.id);
    },
  },
  {
    // The card feature sets a card's column field ("Stage") through this: on the board the column
    // a card stands in IS that value, and only the kanban knows where its columns are. Args
    // { id, column } (a column id of the kanban the item is in).
    id: 'kanban.moveToColumn',
    label: 'Move to column',
    run(editor, args) {
      if (typeof args?.id === 'string' && typeof args.column === 'string') moveToColumn(editor, args.id, args.column);
    },
  },
  {
    id: 'kanban.editFields',
    label: 'Edit fields…',
    icon: ListChecks,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!fieldsTarget(editor),
    run: (editor) => editor.openDock(FIELDS_PANEL),
  },
  {
    // What a kanban's cards show (lib/view.ts). Args { id (the kanban), show?: field ids,
    // color?: 'own' | 'group' | field id } change this person's own view (any role); density?:
    // 'compact' | 'comfortable' changes card sizes, so it is saved for everyone (editors).
    id: 'kanban.setCardDisplay',
    label: 'Change what cards show',
    minRole: 'viewer',
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : null;
      if (!id) return;
      const show = Array.isArray(args?.show) && args.show.every((x) => typeof x === 'string') ? (args.show as string[]) : undefined;
      const color = typeof args?.color === 'string' ? args.color : undefined;
      if (show || color) setMyCardDisplay(editor, id, { ...(show ? { show } : {}), ...(color ? { color } : {}) });
      if ((args?.density === 'compact' || args?.density === 'comfortable') && editor.can('editor')) setDensity(editor, id, args.density);
    },
  },
  {
    // Columns by another field (lib/group.ts): args { id (the kanban), field (a single select,
    // person or checkbox field id; 'stage' is the column field) }. Moves the cards; one undo step.
    id: 'kanban.groupBy',
    label: 'Group cards by',
    run(editor, args) {
      if (typeof args?.id === 'string' && typeof args.field === 'string') setGroupBy(editor, args.id, args.field);
    },
  },
  {
    // Swimlanes: args { id, field } (null: none). One undo step with the re-stack.
    id: 'kanban.setSwimlanes',
    label: 'Swimlanes by',
    run(editor, args) {
      if (typeof args?.id === 'string' && (typeof args.field === 'string' || args.field === null)) setSwimlanes(editor, args.id, args.field);
    },
  },
  {
    // This person's own filter on kanban { id, filter } (a ViewFilter, null: none): it fades the
    // cards it leaves out, for them only, until an editor saves it for everyone. Any role.
    id: 'kanban.setMyFilter',
    label: 'Filter cards for me',
    minRole: 'viewer',
    run(editor, args) {
      if (typeof args?.id === 'string') setMyFilter(editor, args.id, cleanFilter(args.filter, { personal: true }));
    },
  },
  {
    // Sorts every column of kanban { id } by { sort: [{ field, dir }] } ([]: manual order again).
    // Moves the real cards, so it is saved for everyone (editors). One undo step.
    id: 'kanban.setSort',
    label: 'Sort cards by',
    run(editor, args) {
      if (typeof args?.id === 'string' && Array.isArray(args.sort)) setSort(editor, args.id, args.sort as never);
    },
  },
  {
    // Locks or unlocks the saved view of kanban { id, locked }: only whoever locked it and the
    // board's owners change it then (everyone keeps their own view settings). Editors.
    id: 'kanban.lockView',
    label: 'Lock view',
    run(editor, args) {
      if (typeof args?.id === 'string' && typeof args.locked === 'boolean') setViewLocked(editor, args.id, args.locked);
    },
  },
  {
    // "Save for everyone": this person's own view of kanban { id } becomes its saved view.
    id: 'kanban.saveViewForEveryone',
    label: 'Save view for everyone',
    run(editor, args) {
      if (typeof args?.id === 'string') saveViewForEveryone(editor, args.id);
    },
  },
  {
    id: 'kanban.viewSettings',
    label: 'View settings…',
    icon: SlidersHorizontal,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!fieldsTarget(editor),
    run: (editor) => editor.openDock(VIEW_PANEL),
  },
  move('left', 'Move to previous column', ArrowLeft, 'arrowleft'),
  move('right', 'Move to next column', ArrowRight, 'arrowright'),
  move('up', 'Move up in column', ArrowUp, 'arrowup'),
  move('down', 'Move down in column', ArrowDown, 'arrowdown'),
]);

