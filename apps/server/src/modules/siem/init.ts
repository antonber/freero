// Runs audit streaming: the job that sends every due sink what it hasn't received yet (in order,
// retried with backoff). One instance at a time; nothing runs when the operator turned it off.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { deliverDueSinks } from './service';

export default function initSiem(ctx: ServerContext): void {
  if (!ctx.config.siem.enabled) return;
  scheduleExclusiveJob(ctx, { name: 'siem:deliver', lockKey: 7_202_611_233, intervalMs: 5000, run: async () => void (await deliverDueSinks()) });
}
