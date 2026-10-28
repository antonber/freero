// Empties the trash: boards deleted more than TRASH_RETENTION_DAYS ago are deleted for good.
// Runs at startup and then hourly on EVERY instance; purgeExpiredTrash takes an advisory lock, so
// replicas never purge at the same time, and a round that finds nothing (or loses the lock) is a
// no-op. Missing a round (a deploy, a crash) only delays the purge until the next one.
import type { ServerContext } from '../../platform/context';
import { log, logError } from '../../platform/log';
import { purgeExpiredTrash } from './service';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export default function initBoards(ctx: ServerContext): void {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return; // the previous round is still going
    running = purgeExpiredTrash()
      .then((n) => {
        if (n > 0) log(`boards: purged ${n} board(s) from the trash`);
      })
      .catch((e) => logError('boards: trash purge failed', e))
      .finally(() => {
        running = null;
      });
  };
  run();
  const timer = setInterval(run, PURGE_INTERVAL_MS);
  timer.unref();
  // Stop before the database closes; let a round in progress finish.
  ctx.onShutdown(async () => {
    clearInterval(timer);
    await running;
  });
}
