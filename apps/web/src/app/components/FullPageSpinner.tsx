import { Spinner } from '@ui';

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: '60vh', color: 'var(--fr-primary)' }}>
      <Spinner size={28} label={label} />
    </div>
  );
}
