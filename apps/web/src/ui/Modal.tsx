import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { focusableIn, layerZ, useDismissableLayer, useRestoreFocus } from './layers';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Panel width in px (default 440). */
  width?: number;
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Secondary line under the title. */
  description?: ReactNode;
  /** Close on backdrop click (default true). */
  dismissable?: boolean;
  className?: string;
}

let scrollLocks = 0;

export function Modal({ open, onClose, title, width = 440, footer, children, description, dismissable = true, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const depth = useDismissableLayer({ open, onClose, ref: panelRef, closeOnOutside: dismissable });
  useRestoreFocus(open, panelRef);

  useEffect(() => {
    if (!open) return;
    if (scrollLocks++ === 0) document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const preferred =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>('.fr-modal__body input:not([disabled]), .fr-modal__body textarea:not([disabled])');
      (preferred ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (--scrollLocks === 0) document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fr-modal-backdrop fr-anim" style={{ zIndex: layerZ('modal', depth) as unknown as number }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`fr-modal fr-anim${className ? ` ${className}` : ''}`}
        style={{ width }}
        onKeyDown={trapTab}
      >
        <header className="fr-modal__header">
          <div className="fr-modal__titles">
            <h2 id={titleId} className="fr-modal__title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="fr-modal__desc">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="fr-modal__close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children !== undefined && children !== null ? <div className="fr-modal__body">{children}</div> : null}
        {footer ? <footer className="fr-modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
