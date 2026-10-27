import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { renderIcon, type IconProp } from './icon';
import './fields.css';

interface FieldChrome {
  /** Visible label above the control. */
  label?: ReactNode;
  /** Helper text below the control. */
  hint?: ReactNode;
  /** Error text below the control (also marks it invalid). */
  error?: ReactNode;
}

function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldChrome & { id: string; className?: string; children: ReactNode }) {
  return (
    <div className={`fr-field${error ? ' fr-field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      {label ? (
        <label className="fr-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <div className="fr-field__error" id={`${id}-msg`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="fr-field__hint" id={`${id}-msg`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, FieldChrome {
  /** Leading icon inside the box. */
  icon?: IconProp;
  /** Trailing content inside the box (e.g. a button). */
  suffix?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, suffix, size = 'md', className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} className={className}>
      <div className={`fr-input fr-input--${size}${rest.disabled ? ' fr-input--disabled' : ''}`}>
        {icon ? <span className="fr-input__icon fr-icon">{renderIcon(icon, size === 'sm' ? 15 : 17)}</span> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-msg` : undefined}
          {...rest}
        />
        {suffix ? <span className="fr-input__suffix">{suffix}</span> : null}
      </div>
    </Field>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChrome {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, className, id, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className="fr-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-msg` : undefined}
        {...rest}
      />
    </Field>
  );
});

export interface ToggleProps {
  /** On/off state. (`value` is accepted as an alias.) */
  checked?: boolean;
  value?: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export function Toggle({ checked, value, onChange, label, disabled, size = 'md', className, id, ...aria }: ToggleProps) {
  const on = checked ?? value ?? false;
  const autoId = useId();
  const btnId = id ?? autoId;
  const sw = (
    <button
      id={btnId}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={aria['aria-label']}
      disabled={disabled}
      className={`fr-toggle fr-toggle--${size}${on ? ' fr-toggle--on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="fr-toggle__thumb" />
    </button>
  );
  if (!label) return className ? <span className={className}>{sw}</span> : sw;
  return (
    <div className={`fr-toggle-row${disabled ? ' fr-toggle-row--disabled' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={btnId} className="fr-toggle-row__label">
        {label}
      </label>
      {sw}
    </div>
  );
}

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** Fires once when the user releases the thumb (good for undoable commits). */
  onCommit?: (value: number) => void;
  label?: ReactNode;
  /** Show the current value on the right. */
  showValue?: boolean;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  label,
  showValue,
  format = String,
  disabled,
  className,
  ...aria
}: SliderProps) {
  const id = useId();
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className={`fr-slider${disabled ? ' fr-slider--disabled' : ''}${className ? ` ${className}` : ''}`}>
      {label || showValue ? (
        <div className="fr-slider__top">
          {label ? (
            <label htmlFor={id} className="fr-slider__label">
              {label}
            </label>
          ) : (
            <span />
          )}
          {showValue ? <span className="fr-slider__value">{format(value)}</span> : null}
        </div>
      ) : null}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={aria['aria-label']}
        style={{ ['--fr-slider-pct' as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}
