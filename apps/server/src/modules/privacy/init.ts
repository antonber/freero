import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { EXPORT_LOCK_KEY, processExports } from './service';

export default function initPrivacy(ctx: ServerContext): void {
  // Builds queued exports, retries ones an instance dropped, deletes expired and orphaned files.
  scheduleExclusiveJob(ctx, {
    name: 'privacy:exports',
    lockKey: EXPORT_LOCK_KEY,
    intervalMs: ctx.config.dataExportIntervalMs,
    run: () => processExports(),
  });
}
