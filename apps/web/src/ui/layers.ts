// Shared behavior for floating layers (popover, menu, select, modal):
// a module-level stack so Escape / outside-click only dismiss the topmost
// layer, nested layers (a Select inside a Modal) count as "inside" their
// parents, and z-index follows the open order.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { anchorBox, computePosition, type Align, type Box, type Side } from './position';

interface Layer {
  el: () => HTMLElement | null;
}

const stack: Layer[] = [];

/** Elements marked with this attribute never count as an "outside" click (e.g. toasts). */
export const IGNORE_OUTSIDE_ATTR = 'data-fr-ignore-outside';

export interface DismissOptions {
  open: boolean;
  onClose: () => void;
  /** The layer's own element. */
  ref: RefObject<HTMLElement>;
  /** Clicks on the anchor are not "outside" (the anchor usually toggles). */
  anchor?: HTMLElement | DOMRect | Box | null;
  closeOnEscape?: boolean;
  closeOnOutside?: boolean;
  /**
   * Escape pressed inside the layer goes to the focused content first (an inline editor
   * cancels its edit); the layer closes only if the content didn't handle it
   * (preventDefault / stopPropagation).
   */
  escapeToContent?: boolean;
}

/** Registers a dismissable layer; returns its depth in the stack (0 = bottom). */
export function useDismissableLayer({
  open,
  onClose,
  ref,
  anchor,
  closeOnEscape = true,
  closeOnOutside = true,
  escapeToContent = false,
}: DismissOptions): number {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const optsRef = useRef({ closeOnEscape, closeOnOutside, escapeToContent });
  optsRef.current = { closeOnEscape, closeOnOutside, escapeToContent };
  const [depth, setDepth] = useState(0);

  useLayoutEffect(() => {
    if (!open) return;
    const layer: Layer = { el: () => ref.current };
    stack.push(layer);
    setDepth(stack.length - 1);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !optsRef.current.closeOnEscape) return;
      if (stack[stack.length - 1] !== layer) return;
      const el = ref.current;
      if (optsRef.current.escapeToContent && el && e.target instanceof Node && e.target !== el && el.contains(e.target)) {
        // Hand the key to the content; if it reaches the window's bubble phase unhandled, close.
        const after = (ev: KeyboardEvent) => {
          window.removeEventListener('keydown', after);
          if (ev === e && !e.defaultPrevented && stack[stack.length - 1] === layer) onCloseRef.current();
        };
        window.addEventListener('keydown', after);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!optsRef.current.closeOnOutside) return;
      const t = e.target as Node | null;
      if (!t || !(t instanceof Node)) return;
      const idx = stack.indexOf(layer);
      for (let i = idx; i < stack.length; i++) {
        const el = stack[i].el();
        if (el && el.contains(t)) return;
      }
      const a = anchorRef.current;
      if (a instanceof HTMLElement && a.contains(t)) return;
      if (t instanceof Element && t.closest(`[${IGNORE_OUTSIDE_ATTR}]`)) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, ref]);

  return depth;
}

/** z-index for a layer: base token for the bottom layer, above modals when nested. */
export function layerZ(kind: 'popover' | 'modal', depth: number): string {
  if (kind === 'modal') return `calc(var(--fr-z-modal) + ${depth * 2})`;
  return depth === 0 ? 'var(--fr-z-popover)' : `calc(var(--fr-z-modal) + ${depth * 2})`;
}

export interface FloatingOptions {
  open: boolean;
  anchor: HTMLElement | DOMRect | Box | null | undefined;
  ref: RefObject<HTMLElement>;
  side?: Side;
  align?: Align;
  offset?: number;
  padding?: number;
}

/** Positions a fixed floating element next to its anchor, kept in the viewport. */
export function useFloatingPosition({
  open,
  anchor,
  ref,
  side = 'bottom',
  align = 'center',
  offset = 8,
  padding = 8,
}: FloatingOptions): { style: CSSProperties; side: Side } {
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null);
  // DOMRect anchors are compared by value so callers can pass fresh objects.
  const anchorKey =
    anchor && !(anchor instanceof HTMLElement)
      ? `${anchor.x},${anchor.y},${anchor.width},${anchor.height}`
      : anchor;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = ref.current;
      const box = anchorBox(anchor ?? null);
      if (!el || !box) return;
      const r = el.getBoundingClientRect();
      const next = computePosition({
        anchor: box,
        floating: { width: el.offsetWidth || r.width, height: el.offsetHeight || r.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
        offset,
        padding,
      });
      setPos((p) => (p && p.x === next.x && p.y === next.y && p.side === next.side ? p : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      if (ref.current) ro.observe(ref.current);
      if (anchor instanceof HTMLElement) ro.observe(anchor);
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorKey, side, align, offset, padding]);

  return {
    style: pos
      ? { position: 'fixed', left: Math.round(pos.x), top: Math.round(pos.y) }
      : // Not placed yet (only until the layout effect above re-renders, before paint). Invisible
        // but NOT visibility:hidden, so content can take focus while mounting (autoFocus).
        { position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none' },
    side: pos?.side ?? side,
  };
}

/** Remembers the focused element when a layer opens and restores it on close. */
export function useRestoreFocus(open: boolean, ref: RefObject<HTMLElement>) {
  // Captured while rendering the open: by the time effects run, mount-time autofocus has
  // already moved focus into the layer.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const prev = opener.current;
    return () => {
      const el = ref.current;
      const active = document.activeElement;
      // Only restore if focus is inside the closing layer (or was lost to body).
      if (prev && typeof prev.focus === 'function' && (!active || active === document.body || (el && el.contains(active)))) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Arrow-key navigation between `[data-fr-item]` elements inside a container. */
export function handleRovingKey(e: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null): boolean {
  if (!container) return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-fr-item]:not([disabled])'));
  if (items.length === 0) return false;
  const idx = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  switch (e.key) {
    case 'ArrowDown': next = idx < 0 ? 0 : (idx + 1) % items.length; break;
    case 'ArrowUp': next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length; break;
    case 'Home': next = 0; break;
    case 'End': next = items.length - 1; break;
    default: {
      // Typeahead: jump to the next item starting with the typed letter.
      if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        for (let i = 1; i <= items.length; i++) {
          const it = items[(idx + i + items.length) % items.length];
          if ((it.textContent ?? '').trim().toLowerCase().startsWith(k)) {
            next = items.indexOf(it);
            break;
          }
        }
      }
    }
  }
  if (next < 0) return false;
  e.preventDefault();
  items[next].focus();
  return true;
}
