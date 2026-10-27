import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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
  /** Focus the panel when it opens (default true). Set false for non-modal hover cards. */
  autoFocus?: boolean;
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
  const depth = useDismissableLayer({ open: visible, onClose, ref, anchor, closeOnOutside });
  const { style: posStyle } = useFloatingPosition({ open: visible, anchor, ref, side, align, offset });
  useRestoreFocus(visible, ref);

  useEffect(() => {
    if (!visible || !autoFocus) return;
    const el = ref.current;
    if (!el) return;
    // Let content (e.g. Menu) claim focus first; otherwise focus the panel.
    const raf = requestAnimationFrame(() => {
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
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
