// Runs the event stream: the outbox consumer that records board and membership events and queues
// saved boards, the job that compares settled boards (item and comment events), and retention.
// Each runs on one instance at a time and resumes where it stopped.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { consumeOutbox } from '../../platform/outbox';
import { deriveDueBoards, eventsConsumer, pruneEvents } from './service';

export default function initEvents(ctx: ServerContext): void {
  consumeOutbox(ctx, eventsConsumer);
  scheduleExclusiveJob(ctx, { name: 'events:derive', lockKey: 7_202_611_112, intervalMs: 1000, run: () => deriveDueBoards() });
  scheduleExclusiveJob(ctx, { name: 'events:retention', lockKey: 7_202_611_113, intervalMs: 3600_000, firstRunMs: 120_000, run: () => pruneEvents() });
}
