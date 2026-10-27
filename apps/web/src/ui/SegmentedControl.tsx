import type { KeyboardEvent, ReactNode } from 'react';
import { renderIcon, type IconProp } from './icon';
import { Tooltip } from './Tooltip';
import './SegmentedControl.css';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label; omit for icon-only segments (then `title` is required for a11y). */
  label?: ReactNode;
  icon?: IconProp;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/** A compact single-choice switch (e.g. grid / list view). */
export function SegmentedControl<T extends string>({ options, value, onChange, size = 'md', className, ...aria }: SegmentedControlProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + step + options.length) % options.length];
    onChange(next.value);
    const btn = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`);
    btn?.focus();
  };
  return (
    <div role="radiogroup" aria-label={aria['aria-label']} className={`fr-seg fr-seg--${size}${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const selected = o.value === value;
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label ? undefined : o.title}
            data-value={o.value}
            tabIndex={selected ? 0 : -1}
            className={`fr-seg__item${selected ? ' fr-seg__item--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? <span className="fr-icon">{renderIcon(o.icon, size === 'sm' ? 15 : 16)}</span> : null}
            {o.label ? <span>{o.label}</span> : null}
          </button>
        );
        return !o.label && o.title ? (
          <Tooltip key={o.value} content={o.title}>
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
