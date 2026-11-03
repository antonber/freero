// The daily usage rollup (#65): every instance schedules it, one runs it at a time (platform/jobs).
// Hourly, so today's row stays current and a missed round costs an hour; an upsert per day, so
// rounds never double-count.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { rollUpUsage, USAGE_ROLLUP_LOCK_KEY } from './usage';

export default function initAdmin(ctx: ServerContext): void {
  scheduleExclusiveJob(ctx, {
    name: 'admin:usage-rollup',
    lockKey: USAGE_ROLLUP_LOCK_KEY,
    intervalMs: 60 * 60 * 1000,
    firstRunMs: 60 * 1000,
    run: () => rollUpUsage(),
  });
}
