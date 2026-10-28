// Periodic background jobs that every instance schedules but only one runs at a time (a Postgres
// advisory lock; with PGlite there is only one process). A job must be idempotent: a run can be
// cut short by a crash or deploy, and the next run (on any instance) finishes the work.
//
//   scheduleExclusiveJob(ctx, { name: 'accounts:purge', lockKey: 7_202_610_281, intervalMs, run })
import type { ServerContext } from './context';
import { withAdvisoryLock } from './db';
import { logError } from './log';

export interface ExclusiveJob {
  name: string;
  /** Postgres advisory lock key, unique per job and constant across releases. */
  lockKey: number;
  intervalMs: number;
  /** Delay before the first run after startup. */
  firstRunMs?: number;
  run: () => Promise<unknown>;
}

/** Runs `fn` unless another instance runs the same lock right now (then resolves to null). */
export function runExclusive<T>(lockKey: number, fn: () => Promise<T>): Promise<T | null> {
  return withAdvisoryLock(lockKey, fn);
}

export function scheduleExclusiveJob(ctx: ServerContext, job: ExclusiveJob): void {
  let running: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    running = runExclusive(job.lockKey, job.run).catch((e) => logError(`job ${job.name} failed`, e));
  };
  const timer = setInterval(tick, job.intervalMs);
  timer.unref();
  const first = setTimeout(tick, job.firstRunMs ?? 1000);
  first.unref();
  ctx.onShutdown(async () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(first);
    await running; // never close the database under a running job
  });
}
