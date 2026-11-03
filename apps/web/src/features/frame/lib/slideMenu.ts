// The slide menus the side deck and the filmstrip share: a slide's options, and the layouts.
import { Copy, Eye, EyeOff, LayoutTemplate, Trash2 } from 'lucide-react';
import type { FrameElement } from '@freero/shared';
import type { Editor } from '@engine';
import type { MenuItem } from '@ui';
import { applyLayout, duplicateSlide, setSkipped } from './actions';
import { SLIDE_LAYOUTS, type SlideLayoutId } from './layouts';

export function layoutMenu(onPick: (id: SlideLayoutId | null) => void, blank: boolean): MenuItem[] {
  return [
    ...(blank ? [{ id: 'blank', label: 'Blank', onSelect: () => onPick(null) }] : []),
    ...SLIDE_LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: LayoutTemplate, onSelect: () => onPick(l.id) })),
  ];
}

/** A slide's options: its layout, duplicate, skip, delete — and whatever the panel adds first. */
export function slideMenu(editor: Editor, frame: FrameElement, first: MenuItem[] = []): MenuItem[] {
  return [
    ...first,
    { id: 'layout', label: 'Layout', icon: LayoutTemplate, onSelect: () => undefined, submenu: layoutMenu((id) => id && applyLayout(editor, frame.id, id), false) },
    { id: 'dup', label: 'Duplicate slide', icon: Copy, onSelect: () => duplicateSlide(editor, frame.id) },
    frame.skip
      ? { id: 'unskip', label: 'Include in presentation', icon: Eye, onSelect: () => setSkipped(editor, [frame], false) }
      : { id: 'skip', label: 'Skip in presentation', icon: EyeOff, onSelect: () => setSkipped(editor, [frame], true) },
    { divider: true },
    { id: 'delete', label: 'Delete slide', icon: Trash2, danger: true, onSelect: () => editor.remove([frame.id]) },
  ];
}
