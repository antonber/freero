import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
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
  /** Opens these items in a submenu to the side (hover, click, → key); onSelect is then unused. */
  submenu?: MenuItem[];
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
  const [sub, setSub] = useState<{ id: string; el: HTMLElement } | null>(null);
  const subItems = sub ? items.find((i): i is MenuAction => 'id' in i && i.id === sub.id)?.submenu : undefined;
  // Choosing in the submenu closes this menu too.
  const closeAll = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const nested = subItems?.map((i) => ('id' in i && !i.submenu ? { ...i, onSelect: closeAll(i.onSelect) } : i));
  useEffect(() => {
    if (!open) setSub(null);
  }, [open]);

  // Focus the first item in the commit that opens the menu (after the Popover focused its panel,
  // before paint), like Popover content: no keystroke can reach the board in between, and nothing
  // is left scheduled to steal focus back after a fast close.
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    listRef.current?.querySelector<HTMLElement>('[data-fr-item]:not([disabled])')?.focus({ preventScroll: true });
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
        // Keys from an open submenu bubble here through the portal: only ← (back) is ours.
        if (!listRef.current?.contains(e.target as Node)) {
          if (e.key === 'ArrowLeft' && sub) {
            e.preventDefault();
            sub.el.focus({ preventScroll: true });
            setSub(null);
          }
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
          return;
        }
        handleRovingKey(e, listRef.current);
      }}
    >
      {/* Keys pressed on an item (Enter, Space) belong to the menu, never to the board behind it. */}
      <div ref={listRef} role="menu" aria-label={aria['aria-label']} data-fr-keyboard-trap="">
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
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? sub?.id === item.id : undefined}
              data-fr-item=""
              disabled={item.disabled}
              className={`fr-menu__item${item.danger ? ' fr-menu__item--danger' : ''}${item.submenu && sub?.id === item.id ? ' is-open' : ''}`}
              onMouseEnter={(e) => {
                if (item.submenu && !item.disabled) setSub({ id: item.id, el: e.currentTarget });
                else if (sub) setSub(null);
              }}
              onKeyDown={(e) => {
                if (item.submenu && e.key === 'ArrowRight') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSub({ id: item.id, el: e.currentTarget });
                }
              }}
              onClick={(e) => {
                if (item.submenu) {
                  const el = e.currentTarget;
                  setSub((cur) => (cur?.id === item.id ? null : { id: item.id, el }));
                  return;
                }
                onClose();
                item.onSelect();
              }}
            >
              {hasChecks ? (
                <span className="fr-menu__check fr-icon">{item.checked ? <Check size={15} strokeWidth={2.4} /> : null}</span>
              ) : null}
              {hasIcons ? <span className="fr-menu__icon fr-icon">{item.icon ? renderIcon(item.icon, 16) : null}</span> : null}
              <span className="fr-menu__label">{item.label}</span>
              {item.shortcut ? <Kbd className="fr-menu__kbd" compact>{item.shortcut}</Kbd> : null}
              {item.submenu ? <ChevronRight className="fr-menu__more" size={15} aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {nested && sub && (
        <Menu
          open
          onClose={() => {
            setSub(null);
            sub.el.focus({ preventScroll: true });
          }}
          anchor={sub.el}
          items={nested}
          side="right"
          align="start"
          minWidth={minWidth > 200 ? 200 : minWidth}
        />
      )}
    </Popover>
  );
}
