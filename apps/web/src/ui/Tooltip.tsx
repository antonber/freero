import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from './layers';
import type { Align, Side } from './position';
import { Kbd } from './misc';
import './Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut shown as key caps, e.g. "Mod+Z". */
  shortcut?: string;
  side?: Side;
  align?: Align;
  /** Hover delay in ms (skipped while another tooltip was just visible). */
  delay?: number;
  disabled?: boolean;
  /** A single element that can hold a ref (DOM element or forwardRef component). */
  children: ReactElement;
}

// After one tooltip was shown, neighbours open instantly (toolbar scanning).
let warmUntil = 0;

function setRef<T>(ref: Ref<T> | undefined, value: T) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T }).current = value;
}

type Handler = ((e: SyntheticEvent) => void) | undefined;

export function Tooltip({ content, shortcut, side = 'top', align = 'center', delay = 450, disabled, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number>();
  const floatRef = useRef<HTMLDivElement>(null);
  const { style, side: placed } = useFloatingPosition({ open, anchor, ref: floatRef, side, align, offset: 8 });

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen((o) => {
      if (o) warmUntil = Date.now() + 500;
      return false;
    });
  }, []);

  const show = useCallback(
    (el: HTMLElement, instant = false) => {
      window.clearTimeout(timer.current);
      setAnchor(el);
      if (instant || Date.now() < warmUntil) setOpen(true);
      else timer.current = window.setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);
  useEffect(() => {
    if (!open) return;
    const off = () => hide();
    window.addEventListener('scroll', off, true);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('blur', off);
    };
  }, [open, hide]);
  // Hide if the anchor is detached from the DOM while open.
  useEffect(() => {
    if (open && anchor && !anchor.isConnected) hide();
  });

  const child = Children.only(children);
  if (!isValidElement(child)) return child;
  const props = child.props as Record<string, Handler>;
  const childRef = (child as unknown as { ref?: Ref<HTMLElement> }).ref;
  const chain = (name: string, fn: (e: SyntheticEvent) => void) => (e: SyntheticEvent) => {
    props[name]?.(e);
    fn(e);
  };

  const trigger = cloneElement(child as ReactElement<Record<string, unknown>>, {
    ref: (el: HTMLElement | null) => setRef(childRef, el),
    onMouseEnter: chain('onMouseEnter', (e) => {
      if (!disabled && content) show(e.currentTarget as HTMLElement);
    }),
    onMouseLeave: chain('onMouseLeave', hide),
    onPointerDown: chain('onPointerDown', hide),
    onFocus: chain('onFocus', (e) => {
      const el = e.currentTarget as HTMLElement;
      let visible = false;
      try {
        visible = el.matches(':focus-visible');
      } catch {
        visible = false;
      }
      if (!disabled && content && visible) show(el, true);
    }),
    onBlur: chain('onBlur', hide),
  });

  return (
    <>
      {trigger}
      {open && content && !disabled
        ? createPortal(
            <div
              ref={floatRef}
              role="tooltip"
              className={`fr-tooltip fr-anim fr-tooltip--${placed}`}
              style={{ ...style, zIndex: 'var(--fr-z-tooltip)' as unknown as number }}
            >
              <span className="fr-tooltip__text">{content}</span>
              {shortcut ? <Kbd className="fr-tooltip__kbd">{shortcut}</Kbd> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
