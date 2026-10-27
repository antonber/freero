import type { CSSProperties, ReactNode } from 'react';
import { formatShortcut, shortcutKeys, isApplePlatform } from './shortcut';
import './misc.css';

export interface DividerProps {
  vertical?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Divider({ vertical, className, style }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={`fr-divider ${vertical ? 'fr-divider--v' : 'fr-divider--h'}${className ? ` ${className}` : ''}`}
      style={style}
    />
  );
}

export interface KbdProps {
  /** A shortcut like "Mod+Shift+Z" (formatted per platform) or any node. */
  children: ReactNode;
  className?: string;
  /**
   * One compact label ("Ctrl+Shift+Z", "⌘⇧Z") instead of a keycap per key — for menus, where
   * the shortcut is a quiet hint at the row's end.
   */
  compact?: boolean;
}

export function Kbd({ children, className, compact }: KbdProps) {
  if (typeof children !== 'string') return <kbd className={`fr-kbd${className ? ` ${className}` : ''}`}>{children}</kbd>;
  const apple = isApplePlatform();
  // The caller's class sits on the whole shortcut (one box), never repeated on every key.
  const group = `fr-kbd-group${compact ? ' fr-kbd-group--compact' : ''}${className ? ` ${className}` : ''}`;
  if (compact)
    return (
      <span className={group} aria-label={children}>
        <kbd className="fr-kbd">{formatShortcut(children, apple)}</kbd>
      </span>
    );
  return (
    <span className={group} aria-label={children}>
      {shortcutKeys(children, apple).map((k, i) => (
        <kbd key={i} className="fr-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

export interface SpinnerProps {
  size?: number;
  className?: string;
  /** Accessible label; omit when the surrounding element already describes the busy state. */
  label?: string;
}

export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <svg
      className={`fr-spinner fr-anim${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

/** Shimmering placeholder block for loading states. */
export function Skeleton({ width = '100%', height = 14, radius = 6, className, style }: SkeletonProps) {
  return (
    <div
      className={`fr-skeleton fr-anim${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden
    />
  );
}
