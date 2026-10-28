// The audit log in the app: account-event fan-out, the platform/audit.ts sink, and retention
// (hourly on every instance, one at a time through platform/jobs; pruning is idempotent).
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { connectAudit, pruneAuditByPolicy } from './wiring';

const AUDIT_PRUNE_LOCK_KEY = 7_202_610_300; // arbitrary, constant across releases

export default function initAudit(ctx: ServerContext): void {
  const disconnect = connectAudit();
  ctx.onShutdown(() => void disconnect());
  scheduleExclusiveJob(ctx, {
    name: 'audit:retention',
    lockKey: AUDIT_PRUNE_LOCK_KEY,
    intervalMs: 60 * 60 * 1000,
    firstRunMs: 60_000 + Math.random() * 4 * 60_000,
    run: async () => {
      const n = await pruneAuditByPolicy();
      if (n > 0) log(`audit: removed ${n} event(s) past their workspace's retention`);
    },
  });
}
