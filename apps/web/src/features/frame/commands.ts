import { EyeOff, Frame, GalleryVertical, Maximize2, Presentation } from 'lucide-react';
import { defineCommands } from '@engine';
import { applyLayout, frameSelection, newSlide, selectedFrames, setSkipped, zoomToFrame } from './lib/actions';
import { DECK_PANEL_ID } from './lib/DeckPanel';
import { SLIDE_LAYOUTS, type SlideLayoutId } from './lib/layouts';
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
  {
    id: 'frame.openDeck',
    icon: Presentation,
    label: 'Slide deck',
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openDock(editor.getDock() === DECK_PANEL_ID ? null : DECK_PANEL_ID);
    },
  },
  {
    id: 'frame.skipSlide',
    icon: EyeOff,
    label: 'Skip in presentation',
    menus: ['context'],
    when: (editor) => selectedFrames(editor).length > 0,
    detail: (editor) => (selectedFrames(editor).every((f) => f.skip) ? '(on)' : ''),
    run(editor) {
      const frames = selectedFrames(editor);
      setSkipped(editor, frames, !frames.every((f) => f.skip));
    },
  },
  {
    // Other features (templates, AI, MCP apps) give a slide a layout through this:
    // args { frameId, layout } puts the layout into that frame; { layout, after? } adds a new slide.
    id: 'frame.applyLayout',
    label: 'Apply slide layout',
    run(editor, args) {
      const layout = SLIDE_LAYOUTS.find((l) => l.id === args?.layout)?.id as SlideLayoutId | undefined;
      if (!layout) return;
      if (typeof args?.frameId === 'string') applyLayout(editor, args.frameId, layout);
      else newSlide(editor, layout, typeof args?.after === 'string' ? args.after : undefined);
    },
  },
]);
