import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { IGNORE_OUTSIDE_ATTR } from './layers';
import './Toast.css';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  /** Auto-dismiss after ms (default 3500, errors 6000). 0 keeps it until closed. */
  duration?: number;
  /** Optional action button. */
  action?: { label: string; onClick: () => void };
}

export type NotifyFn = (message: string, kind?: ToastKind, options?: ToastOptions) => void;

/**
 * `useToast()` returns a callable that is also `{ notify }`, so both
 * `const notify = useToast()` and `const { notify } = useToast()` work.
 */
export type ToastApi = NotifyFn & { notify: NotifyFn };

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  options?: ToastOptions;
}

const ToastContext = createContext<ToastApi | null>(null);

const fallback: ToastApi = Object.assign(
  ((message: string, kind?: ToastKind) => {
    // eslint-disable-next-line no-console
    console.warn(`[toast:${kind ?? 'info'}] ${message} (no <ToastProvider> mounted)`);
  }) as NotifyFn,
  {} as { notify: NotifyFn },
);
fallback.notify = fallback;

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? fallback;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const api = useMemo<ToastApi>(() => {
    const notify: NotifyFn = (message, kind = 'info', options) => {
      const id = ++seq;
      setItems((list) => {
        // Collapse exact duplicates that are still on screen.
        const rest = list.filter((t) => !(t.message === message && t.kind === kind));
        return [...rest, { id, message, kind, options }].slice(-4);
      });
    };
    return Object.assign(notify, { notify });
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="fr-toasts" aria-live="polite" aria-relevant="additions" {...{ [IGNORE_OUTSIDE_ATTR]: '' }}>
          {items.map((t) => (
            <Toast key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert } as const;

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const duration = item.options?.duration ?? (item.kind === 'error' ? 6000 : 3500);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!duration || paused) return;
    started.current = Date.now();
    const t = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current -= Date.now() - started.current;
    };
  }, [duration, paused, item.id, onDismiss]);

  const Icon = ICONS[item.kind];
  return (
    <div
      className={`fr-toast fr-toast--${item.kind} fr-anim`}
      role={item.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Icon className="fr-toast__icon" size={18} aria-hidden />
      <span className="fr-toast__msg">{item.message}</span>
      {item.options?.action ? (
        <button
          type="button"
          className="fr-toast__action"
          onClick={() => {
            item.options?.action?.onClick();
            onDismiss(item.id);
          }}
        >
          {item.options.action.label}
        </button>
      ) : null}
      <button type="button" className="fr-toast__close" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
        <X size={15} />
      </button>
    </div>
  );
}
