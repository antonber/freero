// Runs webhooks: the outbox consumer that turns recorded events into deliveries, the job that
// sends the due ones (retries with backoff), and the delivery log's retention. One instance at a
// time each; nothing runs when the operator turned webhooks off.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { consumeOutbox } from '../../platform/outbox';
import { deliverDue, pruneDeliveries, webhooksConsumer } from './service';

export default function initWebhooks(ctx: ServerContext): void {
  if (!ctx.config.webhooks.enabled) return;
  consumeOutbox(ctx, webhooksConsumer);
  scheduleExclusiveJob(ctx, { name: 'webhooks:deliver', lockKey: 7_202_611_122, intervalMs: 1000, run: () => deliverDue() });
  scheduleExclusiveJob(ctx, { name: 'webhooks:retention', lockKey: 7_202_611_123, intervalMs: 3600_000, firstRunMs: 180_000, run: () => pruneDeliveries() });
}
