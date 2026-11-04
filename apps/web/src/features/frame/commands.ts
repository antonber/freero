import { EyeOff, Frame, GalleryVertical, Maximize2, Presentation, SquarePen } from 'lucide-react';
import { defineCommands } from '@engine';
import { applyLayout, frameSelection, newSlide, selectedFrames, setSkipped, zoomToFrame } from './lib/actions';
import { FILMSTRIP_ID } from './lib/Filmstrip';
import { editSlide } from './lib/slideEditor';
import { SLIDE_LAYOUTS, type SlideLayoutId } from './lib/layouts';
import { PANEL_ID } from './lib/frames';

import { t } from './messages';
export default defineCommands([
  {
    id: 'frame.wrapSelection',
    icon: Frame,
    label: t('frameSelection'),
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
    label: t('zoomToFrame'),
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => selectedFrames(editor).length === 1,
    run(editor) {
      const [f] = selectedFrames(editor);
      if (f) zoomToFrame(editor, f);
    },
  },
  {
    // One slide on its own (#135): at 100%, the rest of the board out of the way, Esc to go back.
    id: 'frame.editSlide',
    icon: SquarePen,
    label: t('editSlide'),
    menus: ['context'],
    when: (editor) => selectedFrames(editor).length === 1,
    run(editor) {
      const [f] = selectedFrames(editor);
      if (f) editSlide(editor, f.id);
    },
  },
  {
    id: 'frame.openPanel',
    icon: GalleryVertical,
    label: t('framesPanel'),
    menus: ['board'],
    minRole: 'viewer',
    run(editor) {
      editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID);
    },
  },
  {
    // The filmstrip under the canvas (#52); its notes button opens the side deck with speaker notes.
    id: 'frame.openDeck',
    icon: Presentation,
    label: t('slideDeck'),
    menus: ['board'],
    minRole: 'viewer',
    detail: (editor) => (editor.getBottomDock() === FILMSTRIP_ID ? '(on)' : ''),
    run(editor) {
      editor.openBottomDock(editor.getBottomDock() === FILMSTRIP_ID ? null : FILMSTRIP_ID);
    },
  },
  {
    id: 'frame.skipSlide',
    icon: EyeOff,
    label: t('skipInPresentation'),
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
    label: t('applySlideLayout'),
    run(editor, args) {
      const layout = SLIDE_LAYOUTS.find((l) => l.id === args?.layout)?.id as SlideLayoutId | undefined;
      if (!layout) return;
      if (typeof args?.frameId === 'string') applyLayout(editor, args.frameId, layout);
      else newSlide(editor, layout, typeof args?.after === 'string' ? args.after : undefined);
    },
  },
]);
