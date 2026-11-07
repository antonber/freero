// Periodic background jobs that every instance schedules but only one runs at a time (a Postgres
// advisory lock; with PGlite there is only one process). A job must be idempotent: a run can be
// cut short by a crash or deploy, and the next run (on any instance) finishes the work.
//
//   scheduleExclusiveJob(ctx, { name: 'accounts:purge', lockKey: 7_202_610_281, intervalMs, run })
//
// Each lock key belongs to one job or outbox consumer: registering a second one under a key
// already taken fails at startup (reserveLockKey). On shutdown, a run in progress here is waited
// for (within SHUTDOWN_WAIT_MS for all of them together) before the database closes.
import type { ServerContext } from './context';
import { reserveLockKey, withAdvisoryLock } from './db';
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

/**
 * How long a shutdown waits, in all, for runs still in progress (jobs and outbox consumers), so the
 * watchdog in platform/runtime.ts still leaves time to flush boards. A run cut short after it is
 * finished by the next one (jobs are idempotent).
 */
const SHUTDOWN_WAIT_MS = 10_000;
const shutdownDeadlines = new WeakMap<ServerContext, Promise<void>>();

/**
 * Waits for `run` (a run in progress on this instance) to settle, but not past the shutdown's
 * shared deadline, which starts with the first wait of that shutdown. Logs a run left behind.
 */
export async function settleOnShutdown(ctx: ServerContext, name: string, run: Promise<unknown> | null): Promise<void> {
  if (!run) return;
  let deadline = shutdownDeadlines.get(ctx);
  if (!deadline) {
    deadline = new Promise<void>((res) => setTimeout(res, SHUTDOWN_WAIT_MS).unref());
    shutdownDeadlines.set(ctx, deadline);
  }
  let settled = false;
  await Promise.race([run.then(() => void (settled = true), () => void (settled = true)), deadline]);
  if (!settled) logError(`shutdown: ${name} is still running after ${SHUTDOWN_WAIT_MS / 1000}s; closing without waiting for it (its next run finishes the work)`, null);
}

export function scheduleExclusiveJob(ctx: ServerContext, job: ExclusiveJob): void {
  reserveLockKey(job.lockKey, `job ${job.name}`);
  // The run in progress on this instance. A tick while it lasts is skipped here, so this always
  // points at the run itself (what shutdown must wait for), never at a skipped tick.
  let running: Promise<unknown> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running) return;
    const run = runExclusive(job.lockKey, job.run)
      .catch((e) => logError(`job ${job.name} failed`, e))
      .finally(() => {
        if (running === run) running = null;
      });
    running = run;
  };
  const timer = setInterval(tick, job.intervalMs);
  timer.unref();
  const first = setTimeout(tick, job.firstRunMs ?? 1000);
  first.unref();
  ctx.onShutdown(async () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(first);
    await settleOnShutdown(ctx, `job ${job.name}`, running); // never close the database under a running job
  });
}
