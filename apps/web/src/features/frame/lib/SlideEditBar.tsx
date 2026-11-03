// The slide editor's bar (#135, top-center): which slide, previous / next, Done. It also ends the
// slide editor when the engine's focus ends (Esc, the slide deleted), so the board comes back.
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useElements, useFocus, type PanelProps } from '@engine';
import { Button, IconButton } from '@ui';
import { isFrame, orderFrames } from './frames';
import { focusChanged, forgetSlide, leaveSlide, stepSlide, useSlideEdit } from './slideEditor';

export function SlideEditBar({ editor }: PanelProps) {
  const frameId = useSlideEdit(editor, (s) => s.frameId);
  const focus = useFocus();
  useEffect(() => focusChanged(editor, focus), [editor, focus]);
  useEffect(() => () => forgetSlide(editor), [editor]);

  // Page Up / Page Down step through the deck while a slide is open (not while typing).
  useEffect(() => {
    if (!frameId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      if (editor.getEditingId() || (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      stepSlide(editor, e.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, frameId]);

  const frames = useElements('frame');
  if (!frameId) return null;
  const order = orderFrames(frames.filter(isFrame));
  const at = order.findIndex((f) => f.id === frameId);
  const frame = order[at];
  if (!frame) return null;
  return (
    <div className="fr-slide-editbar" role="toolbar" aria-label="Slide editor">
      <IconButton icon={ChevronLeft} label="Previous slide" shortcut="PageUp" size={32} disabled={at <= 0} onClick={() => stepSlide(editor, -1)} />
      <span className="fr-slide-editbar__where">
        <span className="fr-slide-editbar__pos">
          {at + 1} / {order.length}
        </span>
        <strong title={frame.title}>{frame.title || 'Untitled slide'}</strong>
      </span>
      <IconButton icon={ChevronRight} label="Next slide" shortcut="PageDown" size={32} disabled={at >= order.length - 1} onClick={() => stepSlide(editor, 1)} />
      <span className="fr-slide-editbar__hint">Esc to go back</span>
      <Button size="sm" variant="primary" onClick={() => leaveSlide(editor)}>
        Done
      </Button>
    </div>
  );
}
