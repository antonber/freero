import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Popover } from './Popover';
import { handleRovingKey } from './layers';
import { renderIcon, type IconProp } from './icon';
import { Kbd } from './misc';
import type { Align, Box, Side } from './position';
import './Menu.css';

export interface MenuAction {
  id: string;
  label: ReactNode;
  icon?: IconProp;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check mark (toggle / radio style items). */
  checked?: boolean;
  onSelect: () => void;
}
export interface MenuDivider { divider: true }
export interface MenuHeading { heading: string }
export type MenuItem = MenuAction | MenuDivider | MenuHeading;

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | DOMRect | Box | null;
  items: MenuItem[];
  side?: Side;
  align?: Align;
  /** Minimum width in px (default 200). */
  minWidth?: number;
  className?: string;
  'aria-label'?: string;
}

export function Menu({ open, onClose, anchor, items, side = 'bottom', align = 'start', minWidth = 200, className, ...aria }: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const hasChecks = items.some((i) => 'id' in i && i.checked !== undefined);
  const hasIcons = items.some((i) => 'id' in i && !!i.icon);

  useEffect(() => {
    if (!open || !anchor) return;
    const raf = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[data-fr-item]:not([disabled])')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, anchor]);

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      side={side}
      align={align}
      offset={6}
      role="presentation"
      className={`fr-menu${className ? ` ${className}` : ''}`}
      style={{ minWidth }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
          return;
        }
        handleRovingKey(e, listRef.current);
      }}
    >
      <div ref={listRef} role="menu" aria-label={aria['aria-label']}>
        {items.map((item, i) => {
          if ('divider' in item) return <div key={`d${i}`} role="separator" className="fr-menu__divider" />;
          if ('heading' in item)
            return (
              <div key={`h${i}`} role="presentation" className="fr-menu__heading">
                {item.heading}
              </div>
            );
          return (
            <button
              key={item.id}
              type="button"
              role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.checked}
              data-fr-item=""
              disabled={item.disabled}
              className={`fr-menu__item${item.danger ? ' fr-menu__item--danger' : ''}`}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {hasChecks ? (
                <span className="fr-menu__check fr-icon">{item.checked ? <Check size={15} strokeWidth={2.4} /> : null}</span>
              ) : null}
              {hasIcons ? <span className="fr-menu__icon fr-icon">{item.icon ? renderIcon(item.icon, 16) : null}</span> : null}
              <span className="fr-menu__label">{item.label}</span>
              {item.shortcut ? <Kbd className="fr-menu__kbd">{item.shortcut}</Kbd> : null}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
