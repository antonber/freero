import { useRef, type KeyboardEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { readableTextColor } from './color';
import './ColorSwatches.css';

export interface ColorSwatchesProps {
  colors: readonly string[];
  value: string | null | undefined;
  onChange: (color: string) => void;
  /** Adds a "+" swatch that opens the native color picker. */
  allowCustom?: boolean;
  /** Swatch diameter in px (default 24). */
  size?: number;
  /** Fixed number of columns (default: wrap). */
  columns?: number;
  /** Optional display names, keyed by color value. */
  names?: Record<string, string>;
  className?: string;
  'aria-label'?: string;
}

const isTransparent = (c: string) => c === 'transparent' || c === 'none';

export function ColorSwatches({
  colors,
  value,
  onChange,
  allowCustom,
  size = 24,
  columns,
  names,
  className,
  ...aria
}: ColorSwatchesProps) {
  const customRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const norm = (c: string | null | undefined) => (c ?? '').toLowerCase();
  const isCustom = !!value && !colors.some((c) => norm(c) === norm(value));
  const list = isCustom && allowCustom && value ? [...colors, value] : colors;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(groupRef.current?.querySelectorAll<HTMLElement>('.fr-swatch') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    items[(idx + step + items.length) % items.length].focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={aria['aria-label'] ?? 'Colors'}
      className={`fr-swatches${className ? ` ${className}` : ''}`}
      style={{
        ['--fr-swatch' as string]: `${size}px`,
        gridTemplateColumns: columns ? `repeat(${columns}, var(--fr-swatch))` : undefined,
        display: columns ? 'grid' : undefined,
      }}
      onKeyDown={onKeyDown}
    >
      {list.map((c) => {
        const selected = norm(c) === norm(value);
        const label = names?.[c] ?? (isTransparent(c) ? 'Transparent' : c);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            tabIndex={selected || (!value && c === list[0]) ? 0 : -1}
            className={`fr-swatch${selected ? ' fr-swatch--selected' : ''}${isTransparent(c) ? ' fr-swatch--transparent' : ''}`}
            style={isTransparent(c) ? undefined : { background: c }}
            onClick={() => onChange(c)}
          >
            {selected && !isTransparent(c) ? (
              <Check size={Math.round(size * 0.55)} strokeWidth={3} color={readableTextColor(c)} aria-hidden />
            ) : null}
          </button>
        );
      })}
      {allowCustom ? (
        <label className="fr-swatch fr-swatch--custom" title="Custom color" tabIndex={-1}>
          <Plus size={Math.round(size * 0.6)} aria-hidden />
          <span className="fr-sr-only">Custom color</span>
          <input
            ref={customRef}
            type="color"
            value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#5b3ff0'}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}
