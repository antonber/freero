import { Focus, Layers, Minimize2, PinOff, Workflow, Wand2 } from 'lucide-react';
import { DIAGRAM_LAYOUTS, type DiagramLayout } from '@freero/shared';
import { defineCommands } from '@engine';
import { diagramOfSelection, focusDiagram, insertDiagram, relayout, selectedMembers, setLayout, unpin, wrappable, wrapSelection } from './lib/actions';
import { LAYERS_PANEL } from './lib/ids';

import { t } from './messages';
export default defineCommands([
  {
    id: 'diagram.insert',
    label: t('insertDiagram'),
    icon: Workflow,
    menus: ['board'],
    run: (editor) => void insertDiagram(editor),
  },
  {
    // The selected items (and the lines between them) as one diagram, drawn as they are.
    id: 'diagram.wrap',
    label: t('makeADiagram'),
    icon: Workflow,
    menus: ['context'],
    when: (editor) => !diagramOfSelection(editor) && wrappable(editor).length > 0,
    disabledReason: t('selectShapesAndLinesThat'),
    run: (editor) => void wrapSelection(editor),
  },
  {
    id: 'diagram.focus',
    label: t('focusOnDiagram'),
    icon: Focus,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!diagramOfSelection(editor) && editor.getFocus() !== diagramOfSelection(editor)?.id,
    disabledReason: t('selectADiagramOrSomething'),
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) focusDiagram(editor, d.id);
    },
  },
  {
    id: 'diagram.exitFocus',
    label: t('leaveFocusMode'),
    icon: Minimize2,
    minRole: 'viewer',
    palette: true,
    when: (editor) => !!editor.getFocus(),
    disabledReason: t('notFocusingOnADiagram'),
    run: (editor) => editor.setFocus(null),
  },
  {
    // Every pin cleared, the whole diagram laid out again by its layout.
    id: 'diagram.relayout',
    label: t('layOutAgain'),
    icon: Wand2,
    menus: ['context'],
    when: (editor) => {
      const d = diagramOfSelection(editor);
      return !!d && d.layout !== 'manual';
    },
    disabledReason: t('selectADiagramWithA'),
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) relayout(editor, d.id);
    },
  },
  {
    id: 'diagram.unpin',
    label: t('letTheLayoutPlaceIt'),
    icon: PinOff,
    menus: ['context'],
    when: (editor) => {
      const d = diagramOfSelection(editor);
      return !!d && d.layout !== 'manual' && selectedMembers(editor, d).some((el) => el.diagramPinned);
    },
    disabledReason: t('selectStepsOfADiagram'),
    run(editor) {
      const d = diagramOfSelection(editor);
      if (d) unpin(editor, d, editor.getSelection());
    },
  },
  {
    id: 'diagram.layers',
    label: t('diagramLayers'),
    icon: Layers,
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => !!diagramOfSelection(editor),
    disabledReason: t('selectADiagramOrSomething'),
    run: (editor) => editor.openDock(LAYERS_PANEL),
  },
  {
    // How other features (and the format bar) switch a diagram's layout: { id, layout }.
    id: 'diagram.setLayout',
    label: t('setDiagramLayout'),
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : diagramOfSelection(editor)?.id;
      const layout = args?.layout as DiagramLayout;
      if (id && DIAGRAM_LAYOUTS.includes(layout)) setLayout(editor, id, layout);
    },
  },
]);
