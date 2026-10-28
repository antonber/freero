import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownFromLine,
  ArrowRightFromLine,
  LayoutGrid,
  ListTree,
  Network,
  Palette,
  Tags,
} from 'lucide-react';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { applyMoves, movableCount, planAlign, planDistribute, planTidy, selectedUnits, type AlignEdge, type DistributeAxis } from './lib/arrange';
import { clusterSelection, selectedStickies } from './lib/cluster';
import { autoLayout, hasDiagram, type AutoLayoutMode } from './lib/autoLayout';

// Never while typing: Alt+letter shortcuts are dispatched during text edits too.
const idle = (editor: Editor) => !editor.getEditingId();

const align = (edge: AlignEdge, label: string, shortcut: string, icon: CommandDefinition['icon']): CommandDefinition => ({
  id: `arrange.align${edge[0].toUpperCase()}${edge.slice(1)}`,
  label,
  shortcut,
  icon,
  menus: ['context'],
  group: 'Align',
  when: (editor) => idle(editor) && selectedUnits(editor).length >= 2 && movableCount(editor) >= 1,
  disabledReason: 'Select two or more unlocked items',
  run: (editor) => applyMoves(editor, planAlign(selectedUnits(editor), edge)),
});

const distribute = (axis: DistributeAxis, label: string, shortcut: string, icon: CommandDefinition['icon']): CommandDefinition => ({
  id: `arrange.distribute${axis === 'horizontal' ? 'Horizontally' : 'Vertically'}`,
  label,
  shortcut,
  icon,
  menus: ['context'],
  group: 'Align',
  when: (editor) => idle(editor) && movableCount(editor) >= 3,
  disabledReason: 'Select three or more unlocked items',
  run: (editor) => applyMoves(editor, planDistribute(selectedUnits(editor), axis)),
});

export const ARRANGE_COMMANDS = [
  align('left', 'Align left', 'alt+a', AlignStartVertical),
  align('center', 'Align center', 'alt+h', AlignCenterVertical),
  align('right', 'Align right', 'alt+d', AlignEndVertical),
  align('top', 'Align top', 'alt+w', AlignStartHorizontal),
  align('middle', 'Align middle', 'alt+v', AlignCenterHorizontal),
  align('bottom', 'Align bottom', 'alt+s', AlignEndHorizontal),
  distribute('horizontal', 'Distribute horizontally', 'alt+shift+h', AlignHorizontalSpaceAround),
  distribute('vertical', 'Distribute vertically', 'alt+shift+v', AlignVerticalSpaceAround),
  {
    id: 'arrange.tidyUp',
    label: 'Tidy up',
    shortcut: 'mod+alt+t',
    icon: LayoutGrid,
    menus: ['context'],
    group: 'Align',
    when: (editor) => idle(editor) && movableCount(editor) >= 2,
    disabledReason: 'Select two or more unlocked items',
    run: (editor) => applyMoves(editor, planTidy(selectedUnits(editor))),
  },
] satisfies CommandDefinition[];

/** Sort selected stickies into labelled clusters (context menu "Cluster ▸", Align popover). */
export const CLUSTER_COMMANDS = [
  {
    id: 'arrange.clusterByColor',
    label: 'Cluster by colour',
    icon: Palette,
    menus: ['context'],
    group: 'Cluster',
    when: (editor) => idle(editor) && selectedStickies(editor).length >= 2,
    disabledReason: 'Select two or more sticky notes',
    run: (editor) => clusterSelection(editor, 'color'),
  },
  {
    id: 'arrange.clusterByTag',
    label: 'Cluster by tag',
    icon: Tags,
    menus: ['context'],
    group: 'Cluster',
    when: (editor) => idle(editor) && selectedStickies(editor).length >= 2,
    disabledReason: 'Select two or more sticky notes',
    run: (editor) => clusterSelection(editor, 'tag'),
  },
] satisfies CommandDefinition[];

const layout = (mode: AutoLayoutMode, label: string, icon: CommandDefinition['icon']): CommandDefinition => ({
  id: `arrange.autoLayout${mode[0].toUpperCase()}${mode.slice(1)}`,
  label,
  icon,
  menus: ['context'],
  group: 'Auto-layout',
  when: (editor) => idle(editor) && hasDiagram(editor),
  disabledReason: 'Select two or more unlocked items joined by connectors',
  run: (editor) => autoLayout(editor, mode),
});

/** A selected diagram (items joined by connectors) laid out again: context menu "Auto-layout ▸", Align popover. */
export const LAYOUT_COMMANDS = [
  layout('down', 'Top-down', ArrowDownFromLine),
  layout('right', 'Left to right', ArrowRightFromLine),
  layout('tree', 'Tree', ListTree),
  layout('orgchart', 'Org chart', Network),
] satisfies CommandDefinition[];

export default defineCommands([...ARRANGE_COMMANDS, ...CLUSTER_COMMANDS, ...LAYOUT_COMMANDS]);
