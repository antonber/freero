// The slide menus the side deck and the filmstrip share: a slide's options, and the layouts.
import { Copy, Eye, EyeOff, LayoutTemplate, MoveDown, MoveUp, Trash2 } from 'lucide-react';
import type { FrameElement } from '@freero/shared';
import type { Editor } from '@engine';
import type { MenuItem } from '@ui';
import { applyLayout, duplicateSlide, framesInOrder, moveSlide, setSkipped } from './actions';
import { SLIDE_LAYOUTS, type SlideLayoutId } from './layouts';

import { t } from '../messages';
export function layoutMenu(onPick: (id: SlideLayoutId | null) => void, blank: boolean): MenuItem[] {
  return [
    ...(blank ? [{ id: 'blank', label: t('blank'), onSelect: () => onPick(null) }] : []),
    ...SLIDE_LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: LayoutTemplate, onSelect: () => onPick(l.id) })),
  ];
}

/** A slide's options: its layout, duplicate, skip, delete — and whatever the panel adds first. */
export function slideMenu(editor: Editor, frame: FrameElement, first: MenuItem[] = []): MenuItem[] {
  const order = framesInOrder(editor);
  const at = order.findIndex((f) => f.id === frame.id);
  return [
    ...first,
    // Reordering without dragging (WCAG 2.5.7): one place earlier or later in the deck.
    { id: 'earlier', label: t('moveSlideEarlier'), icon: MoveUp, disabled: at <= 0, onSelect: () => moveSlide(editor, frame.id, at - 1) },
    { id: 'later', label: t('moveSlideLater'), icon: MoveDown, disabled: at < 0 || at >= order.length - 1, onSelect: () => moveSlide(editor, frame.id, at + 2) },
    { id: 'layout', label: t('layout'), icon: LayoutTemplate, onSelect: () => undefined, submenu: layoutMenu((id) => id && applyLayout(editor, frame.id, id), false) },
    { id: 'dup', label: t('duplicateSlide'), icon: Copy, onSelect: () => duplicateSlide(editor, frame.id) },
    frame.skip
      ? { id: 'unskip', label: t('includeInPresentation'), icon: Eye, onSelect: () => setSkipped(editor, [frame], false) }
      : { id: 'skip', label: t('skipInPresentation'), icon: EyeOff, onSelect: () => setSkipped(editor, [frame], true) },
    { divider: true },
    { id: 'delete', label: t('deleteSlide'), icon: Trash2, danger: true, onSelect: () => editor.remove([frame.id]) },
  ];
}
