import { useLayoutEffect, type RefObject } from 'react';

const MARGIN = 12;

/**
 * Workaround: the engine pins a tool's Options flyout to the top of its toolbar button and
 * doesn't keep it on screen. The emoji picker is tall, so when its flyout would run past the
 * bottom of the window we nudge the flyout container up (and undo that on unmount).
 * Engine extension point: clamp `.fr-tool-options` to the viewport in Toolbar.
 */
export function useFitFlyout(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    box.style.marginTop = '';
    const over = box.getBoundingClientRect().bottom - (window.innerHeight - MARGIN);
    if (over > 0) box.style.marginTop = `${-Math.min(over, box.getBoundingClientRect().top - MARGIN)}px`;
    return () => {
      box.style.marginTop = '';
    };
  });
}
