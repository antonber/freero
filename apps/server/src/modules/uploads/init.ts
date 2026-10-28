// Deletes uploads nothing references any more (sweep.ts). Runs at startup and then every few hours
// on EVERY instance; a round is idempotent, and only one instance deletes at a time (advisory
// lock). Missing a round (a deploy, a crash) only delays the cleanup until the next one.
import type { ServerContext } from '../../platform/context';
import { log, logError } from '../../platform/log';
import { sweepUploads } from './sweep';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function initUploads(ctx: ServerContext): void {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return; // the previous round is still going
    running = sweepUploads()
      .then((n) => {
        if (n > 0) log(`uploads: deleted ${n} unreferenced upload(s)`);
      })
      .catch((e) => logError('uploads: sweep failed', e))
      .finally(() => {
        running = null;
      });
  };
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  // Stop before the database closes; let a round in progress finish.
  ctx.onShutdown(async () => {
    clearInterval(timer);
    await running;
  });
}
