import './Logo.css';

export interface LogoProps {
  /** Mark size in px (default 28). The wordmark scales with it. */
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

/** Freero's mark: a violet rounded square with a geometric "F" and a mint dot. */
export function Logo({ size = 28, withWordmark, className }: LogoProps) {
  return (
    <span className={`fr-logo${className ? ` ${className}` : ''}`} style={{ gap: Math.round(size * 0.32) }}>
      <svg width={size} height={size} viewBox="0 0 64 64" role={withWordmark ? undefined : 'img'} aria-label={withWordmark ? undefined : 'Freero'} aria-hidden={withWordmark ? true : undefined}>
        <rect width="64" height="64" rx="16" fill="var(--fr-primary, #5B3FF0)" />
        <path d="M21 46V18h22v6H28v6h12v6H28v10z" fill="#fff" />
        <circle cx="45" cy="43" r="4" fill="var(--fr-accent, #2EE6B8)" />
      </svg>
      {withWordmark ? (
        <span className="fr-logo__word" style={{ fontSize: Math.round(size * 0.72) }}>
          freero
        </span>
      ) : null}
    </span>
  );
}
