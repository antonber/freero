import { Focus, Layers, Minimize2, PinOff, Workflow, Wand2 } from 'lucide-react';
import { DIAGRAM_LAYOUTS, type DiagramLayout } from '@freero/shared';
import { defineCommands } from '@engine';
import { diagramOfSelection, focusDiagram, insertDiagram, relayout, selectedMembers, setLayout, unpin, wrappable, wrapSelection } from './lib/actions';
import { LAYERS_PANEL } from './lib/ids';

export default defineCommands([
  {
    id: 'diagram.insert',
    label: 'Insert diagram',
    icon: Workflow,
    menus: ['board'],
    run: (editor) => void insertDiagram(editor),
  },
  {
    // The selected items (and the lines between them) as one diagram, drawn as they are.
    id: 'diagram.wrap',
    label: 'Make a diagram',
    icon: Workflow,
    menus: ['context'],
    when: (editor) => !diagramOfSelection(editor) && wrappable(editor).length > 0,
    disabledReason: 'Select shapes and lines that aren’t in a diagram',
    run: (editor) => void wrapSelection(editor),
  },
  {
    id: 'diagram.focus',
    label: 'Focus on diagram',
    icon: Focus,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!diagramOfSelection(editor) && editor.getFocus() !== diagramOfSelection(editor)?.id,
    disabledReason: 'Select a diagram or something in one',
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) focusDiagram(editor, d.id);
    },
  },
  {
    id: 'diagram.exitFocus',
    label: 'Leave focus mode',
    icon: Minimize2,
    minRole: 'viewer',
    palette: true,
    when: (editor) => !!editor.getFocus(),
    disabledReason: 'Not focusing on a diagram',
    run: (editor) => editor.setFocus(null),
  },
  {
    // Every pin cleared, the whole diagram laid out again by its layout.
    id: 'diagram.relayout',
    label: 'Lay out again',
    icon: Wand2,
    menus: ['context'],
    when: (editor) => {
      const d = diagramOfSelection(editor);
      return !!d && d.layout !== 'manual';
    },
    disabledReason: 'Select a diagram with a layout (not manual)',
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) relayout(editor, d.id);
    },
  },
  {
    id: 'diagram.unpin',
    label: 'Let the layout place it',
    icon: PinOff,
    menus: ['context'],
    when: (editor) => {
      const d = diagramOfSelection(editor);
      return !!d && d.layout !== 'manual' && selectedMembers(editor, d).some((el) => el.diagramPinned);
    },
    disabledReason: 'Select steps of a diagram that were moved by hand',
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) unpin(editor, d, editor.getSelection());
    },
  },
  {
    id: 'diagram.layers',
    label: 'Diagram layers…',
    icon: Layers,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!diagramOfSelection(editor),
    disabledReason: 'Select a diagram or something in one',
    run: (editor) => editor.openDock(LAYERS_PANEL),
  },
  {
    // How other features (and the format bar) switch a diagram's layout: { id, layout }.
    id: 'diagram.setLayout',
    label: 'Set diagram layout',
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : diagramOfSelection(editor)?.id;
      const layout = args?.layout as DiagramLayout;
      if (id && DIAGRAM_LAYOUTS.includes(layout)) setLayout(editor, id, layout);
    },
  },
]);
