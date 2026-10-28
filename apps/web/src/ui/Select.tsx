import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';
import { handleRovingKey } from './layers';
import { renderIcon, type IconProp } from './icon';
import './Select.css';

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: ReactNode;
  /** Secondary line in the dropdown. */
  description?: ReactNode;
  icon?: IconProp;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number = string> {
  /** Options; plain values are shown as their own label. */
  options: ReadonlyArray<SelectOption<T> | T>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** 'default' is a bordered field, 'ghost' a borderless inline control. */
  variant?: 'default' | 'ghost';
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Trigger width (number = px). Defaults to fitting its content. */
  width?: number | string;
  id?: string;
  'aria-label'?: string;
}

function norm<T extends string | number>(o: SelectOption<T> | T): SelectOption<T> {
  return typeof o === 'object' ? o : { value: o, label: String(o) };
}

export function Select<T extends string | number = string>({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'default',
  placeholder = 'Select…',
  disabled,
  className,
  width,
  id,
  ...aria
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const opts = options.map(norm);
  const current = opts.find((o) => o.value === value);

  // Focus the selected option in the commit that opens the list (as Popover content does), so
  // nothing scheduled can steal focus back after a fast close.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const sel = list?.querySelector<HTMLElement>('[aria-selected="true"]:not([disabled])') ?? list?.querySelector<HTMLElement>('[data-fr-item]:not([disabled])');
    sel?.focus({ preventScroll: true });
    sel?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        className={`fr-select fr-select--${size} fr-select--${variant}${open ? ' fr-select--open' : ''}${className ? ` ${className}` : ''}`}
        style={{ width }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {current?.icon ? <span className="fr-icon fr-select__icon">{renderIcon(current.icon, 16)}</span> : null}
        <span className={`fr-select__value${current ? '' : ' fr-select__value--placeholder'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown className="fr-select__chevron" size={size === 'sm' ? 14 : 16} aria-hidden />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={triggerRef.current}
        side="bottom"
        align="start"
        offset={4}
        role="presentation"
        className="fr-select-pop"
        style={{ minWidth: triggerRef.current?.offsetWidth }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            setOpen(false);
            return;
          }
          handleRovingKey(e, listRef.current);
        }}
      >
        <div ref={listRef} id={listId} role="listbox" aria-label={aria['aria-label']} data-fr-keyboard-trap="">
          {opts.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={selected}
                data-fr-item=""
                disabled={o.disabled}
                className={`fr-select__option${selected ? ' fr-select__option--selected' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(o.value);
                }}
              >
                {o.icon ? <span className="fr-icon fr-select__icon">{renderIcon(o.icon, 16)}</span> : null}
                <span className="fr-select__option-text">
                  <span className="fr-select__option-label">{o.label}</span>
                  {o.description ? <span className="fr-select__option-desc">{o.description}</span> : null}
                </span>
                <span className="fr-icon fr-select__check">{selected ? <Check size={15} strokeWidth={2.4} /> : null}</span>
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
