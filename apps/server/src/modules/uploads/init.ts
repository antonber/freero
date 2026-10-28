// Deletes uploads nothing references any more (sweep.ts). Scheduled on EVERY instance shortly
// after startup and then every few hours; platform/jobs lets one instance sweep at a time, and a
// round is idempotent. Missing a round (a deploy, a crash) only delays the cleanup.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { sweepUploadsLocked, UPLOAD_SWEEP_LOCK_KEY } from './sweep';

export default function initUploads(ctx: ServerContext): void {
  scheduleExclusiveJob(ctx, {
    name: 'uploads:sweep',
    lockKey: UPLOAD_SWEEP_LOCK_KEY,
    intervalMs: 6 * 60 * 60 * 1000,
    run: async () => {
      const n = await sweepUploadsLocked();
      if (n > 0) log(`uploads: deleted ${n} unreferenced upload(s)`);
    },
  });
}
