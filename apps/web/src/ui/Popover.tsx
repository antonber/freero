import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { layerZ, useDismissableLayer, useFloatingPosition, useRestoreFocus } from './layers';
import type { Align, Box, Side } from './position';
import './Popover.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element or viewport rect to attach to. Nothing renders while null. */
  anchor: HTMLElement | DOMRect | Box | null;
  side?: Side;
  align?: Align;
  /** Gap to the anchor in px (default 8). */
  offset?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Panel width (number = px). */
  width?: number | string;
  /**
   * Focus when it opens (default true): content that focuses itself while mounting (an input
   * with `autoFocus`, a layout effect) keeps focus, otherwise the panel takes it. Focus moves
   * in the same commit as the open, so no keystroke can reach the board in between. Set false
   * for non-modal hover cards.
   */
  autoFocus?: boolean;
  /**
   * Escape inside the popover goes to the focused content first: an inline editor that handles
   * it (preventDefault) cancels its edit and the popover stays; the next Escape closes it.
   */
  escapeToContent?: boolean;
  /** Close when clicking outside (default true). */
  closeOnOutside?: boolean;
  role?: string;
  'aria-label'?: string;
  id?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  {
    open,
    onClose,
    anchor,
    side = 'bottom',
    align = 'center',
    offset = 8,
    children,
    className,
    style,
    width,
    autoFocus = true,
    closeOnOutside = true,
    escapeToContent = false,
    role = 'dialog',
    id,
    onKeyDown,
    ...aria
  },
  forwarded,
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwarded, () => ref.current as HTMLDivElement);
  const visible = open && !!anchor;
  const depth = useDismissableLayer({ open: visible, onClose, ref, anchor, closeOnOutside, escapeToContent });
  const { style: posStyle } = useFloatingPosition({ open: visible, anchor, ref, side, align, offset });
  useRestoreFocus(visible, ref);

  // Runs after the content's own mount-time focus (children commit first), before paint.
  useLayoutEffect(() => {
    if (!visible || !autoFocus) return;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [visible, autoFocus]);

  if (!visible) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      tabIndex={-1}
      className={`fr-popover fr-anim${className ? ` ${className}` : ''}`}
      style={{ ...posStyle, zIndex: layerZ('popover', depth) as unknown as number, width, ...style }}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {children}
    </div>,
    document.body,
  );
});
