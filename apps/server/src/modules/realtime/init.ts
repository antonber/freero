// Thins out old board snapshots (retention.ts, KAI-72) and applies workspaces' version-history
// retention (KAI-51). Runs shortly after startup and then hourly on EVERY instance; pruneSnapshots
// takes an advisory lock, so replicas never prune at the same time, and a round that loses the lock
// or finds nothing is a no-op.
import type { ServerContext } from '../../platform/context';
import { log, logError } from '../../platform/log';
import { boardWorkspaceId } from '../boards/index';
import { retentionOverrides } from '../workspaces/index';
import { DEFAULT_RETENTION, pruneSnapshots, type RetentionPolicyFor } from './retention';

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Not at startup itself: several replicas restarting together would all try at once. */
const FIRST_RUN_MAX_DELAY_MS = 5 * 60 * 1000;
const DAY = 86_400_000;

/** One round: the default thinning everywhere, plus each workspace's maximum age for unnamed versions. */
export async function pruneSnapshotsByPolicy(now = Date.now()): Promise<number | null> {
  const days = new Map((await retentionOverrides()).flatMap((o) => (o.versionDays === null ? [] : [[o.id, o.versionDays] as const])));
  const policyFor: RetentionPolicyFor = async (boardId) => {
    if (!days.size) return DEFAULT_RETENTION;
    const d = days.get((await boardWorkspaceId(boardId)) ?? '');
    return d === undefined ? DEFAULT_RETENTION : { ...DEFAULT_RETENTION, maxAgeMs: d * DAY };
  };
  return pruneSnapshots({ now, policyFor, shortestMaxAgeMs: days.size ? Math.min(...days.values()) * DAY : null });
}

export default function initRealtime(ctx: ServerContext): void {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return; // the previous round is still going
    running = pruneSnapshotsByPolicy()
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
