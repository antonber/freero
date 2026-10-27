import { Frame, GalleryVertical, Maximize2 } from 'lucide-react';
import { defineCommands } from '@engine';
import { frameSelection, selectedFrames, zoomToFrame } from './lib/actions';
import { PANEL_ID } from './lib/frames';

export default defineCommands([
  {
    id: 'frame.wrapSelection',
    icon: Frame,
    label: 'Frame selection',
    shortcut: 'mod+alt+f',
    menus: ['context'],
    when: (editor) => editor.getSelection().some((id) => editor.getElement(id)?.type !== 'frame'),
    run(editor) {
      frameSelection(editor);
    },
  },
  {
    id: 'frame.zoomTo',
    icon: Maximize2,
    label: 'Zoom to frame',
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => selectedFrames(editor).length === 1,
    run(editor) {
      const [f] = selectedFrames(editor);
      if (f) zoomToFrame(editor, f);
    },
  },
  {
    id: 'frame.openPanel',
    icon: GalleryVertical,
    label: 'Frames panel',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID);
    },
  },
]);
