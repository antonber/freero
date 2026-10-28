// Thins out old board snapshots (retention.ts, KAI-72). Runs shortly after startup and then hourly
// on EVERY instance; pruneSnapshots takes an advisory lock, so replicas never prune at the same
// time, and a round that loses the lock or finds nothing is a no-op.
import type { ServerContext } from '../../platform/context';
import { log, logError } from '../../platform/log';
import { pruneSnapshots } from './retention';

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Not at startup itself: several replicas restarting together would all try at once. */
const FIRST_RUN_MAX_DELAY_MS = 5 * 60 * 1000;

export default function initRealtime(ctx: ServerContext): void {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return; // the previous round is still going
    running = pruneSnapshots()
      .then((n) => {
        if (n) log(`realtime: pruned ${n} old board snapshot(s)`);
      })
      .catch((e) => logError('realtime: snapshot pruning failed', e))
      .finally(() => {
        running = null;
      });
  };
  const first = setTimeout(run, Math.random() * FIRST_RUN_MAX_DELAY_MS);
  first.unref();
  const timer = setInterval(run, PRUNE_INTERVAL_MS);
  timer.unref();
  ctx.onShutdown(async () => {
    clearTimeout(first);
    clearInterval(timer);
    await running;
  });
}
