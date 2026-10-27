import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { renderIcon, type IconProp } from './icon';
import { Spinner } from './misc';
import { Tooltip } from './Tooltip';
import type { Side } from './position';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (node or icon component). */
  icon?: IconProp;
  /** Trailing icon (node or icon component). */
  iconRight?: IconProp;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 18 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = [
    'fr-btn',
    `fr-btn--${variant}`,
    `fr-btn--${size}`,
    block ? 'fr-btn--block' : '',
    loading ? 'fr-btn--loading' : '',
    !children ? 'fr-btn--icon-only' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? (
        <Spinner size={ICON_SIZE[size]} />
      ) : icon ? (
        <span className="fr-icon">{renderIcon(icon, ICON_SIZE[size])}</span>
      ) : null}
      {children !== undefined && children !== null && children !== false ? <span className="fr-btn__label">{children}</span> : null}
      {iconRight && !loading ? <span className="fr-icon">{renderIcon(iconRight, ICON_SIZE[size])}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconProp;
  /** Accessible label; also the tooltip text. */
  label: string;
  /** Pressed / selected state (e.g. the active tool). */
  active?: boolean;
  size?: 32 | 40;
  /** Shortcut shown in the tooltip, e.g. "Mod+Z". */
  shortcut?: string;
  tooltipSide?: Side;
  /** Set false to suppress the tooltip. Default true. */
  tooltip?: boolean;
  /** 'ghost' (default) is transparent; 'solid' has a surface + shadow (floating chrome). */
  variant?: 'ghost' | 'solid';
  /** Extra content such as a badge or a color dot, rendered after the icon. */
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, active, size = 40, shortcut, tooltipSide = 'bottom', tooltip = true, variant = 'ghost', className, type = 'button', children, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={[
        'fr-iconbtn',
        `fr-iconbtn--${size}`,
        `fr-iconbtn--${variant}`,
        active ? 'fr-iconbtn--active' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <span className="fr-icon">{renderIcon(icon, size === 40 ? 20 : 18)}</span>
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  );
});
