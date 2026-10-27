// Prometheus metrics of the realtime module (registered with the platform registry).
import { counter, histogram } from '../../platform/metrics';

export const persistDuration = histogram(
  'freero_realtime_persist_duration_seconds',
  'Time to persist one board document (encode + database write)',
);

export const persistFailures = counter('freero_realtime_persist_failures_total', 'Board document persists that failed (and are retried)');
