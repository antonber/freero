// The audit log in the app: account-event fan-out, the platform/audit.ts sink, and retention
// (hourly on every instance, one at a time through platform/jobs; pruning is idempotent).
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { anchorChains } from './service';
import { connectAudit, pruneAuditByPolicy } from './wiring';

const AUDIT_PRUNE_LOCK_KEY = 7_202_610_300; // arbitrary, constant across releases
const AUDIT_ANCHOR_LOCK_KEY = 7_202_611_232;

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
  // Signed checkpoints of every chain head that moved (#17): a chain rewritten wholesale shows.
  scheduleExclusiveJob(ctx, {
    name: 'audit:anchor',
    lockKey: AUDIT_ANCHOR_LOCK_KEY,
    intervalMs: 60 * 60 * 1000,
    firstRunMs: 2 * 60_000 + Math.random() * 60_000,
    run: async () => void (await anchorChains()),
  });
}
