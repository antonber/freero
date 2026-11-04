// Deletes uploads nothing references any more (sweep.ts). Scheduled on EVERY instance shortly
// after startup and then every few hours; platform/jobs lets one instance sweep at a time, and a
// round is idempotent. Missing a round (a deploy, a crash) only delays the cleanup.
//
// Files under a workspace's key (#159, keyed.ts): a moved board's own files go with it, and the
// `uploads:seal` job seals files again whose workspace now seals differently.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { followBoardMoves, sealPendingFiles } from './keyed';
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
  const stop = followBoardMoves();
  ctx.onShutdown(async () => stop());
  scheduleExclusiveJob(ctx, {
    name: 'uploads:seal',
    lockKey: 7_202_612_041,
    intervalMs: 60_000,
    run: async () => {
      const n = await sealPendingFiles();
      if (n) log(`uploads: sealed ${n} file(s) again with their workspace's current key`);
    },
  });
}
