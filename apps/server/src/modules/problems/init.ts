import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { alertOperatorsOfNewProblems, forgetFormerOperators } from './alerts';
import { purgeClosedProblems } from './service';

const RETENTION_LOCK_KEY = 7_202_611_201; // arbitrary, constant across releases
const ALERTS_LOCK_KEY = 7_202_612_071; // arbitrary, constant across releases
const ALERTS_INTERVAL_MS = 60_000;

/**
 * Closed problem reports (and their screenshots) are deleted PROBLEM_RETENTION_DAYS after closing.
 * Reports filed while an operator's alert window was closed are mailed once it opens (alerts.ts).
 */
export default function problemsInit(ctx: ServerContext): void {
  scheduleExclusiveJob(ctx, {
    name: 'problems:retention',
    lockKey: RETENTION_LOCK_KEY,
    intervalMs: ctx.config.moderationRetentionIntervalMs,
    run: async () => {
      const n = await purgeClosedProblems();
      if (n) log(`problems: deleted ${n} closed problem report${n === 1 ? '' : 's'} past PROBLEM_RETENTION_DAYS`);
    },
  });
  scheduleExclusiveJob(ctx, {
    name: 'problems:alerts',
    lockKey: ALERTS_LOCK_KEY,
    intervalMs: ALERTS_INTERVAL_MS,
    run: async () => {
      await forgetFormerOperators();
      await alertOperatorsOfNewProblems();
    },
  });
}
