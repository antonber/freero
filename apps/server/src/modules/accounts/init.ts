import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { PURGE_LOCK_KEY, purgeDueLocked } from './purge';

/** Purges accounts whose deletion grace period is over (scheduled on every instance; one runs). */
export default function initAccounts(ctx: ServerContext): void {
  scheduleExclusiveJob(ctx, {
    name: 'accounts:purge',
    lockKey: PURGE_LOCK_KEY,
    intervalMs: ctx.config.accountPurgeIntervalMs,
    run: () => purgeDueLocked(), // scheduleExclusiveJob holds PURGE_LOCK_KEY around it
  });
}
