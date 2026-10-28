// Empties the trash: boards deleted more than TRASH_RETENTION_DAYS ago are deleted for good.
// Runs shortly after startup and then hourly on EVERY instance (platform/jobs: an advisory lock
// lets one instance purge at a time; a round that finds nothing is a no-op). Missing a round (a
// deploy, a crash) only delays the purge until the next one.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { applyExpiredLinks } from './linkProtection';
import { registerBoardObjectTypes } from './objects';
import { purgeExpiredTrashLocked, TRASH_PURGE_LOCK_KEY } from './service';

const LINK_EXPIRY_LOCK_KEY = 7_202_611_031; // arbitrary, constant across releases

export default function initBoards(ctx: ServerContext): void {
  // Boards and items are objects others can address, check and resolve (modules/objects).
  registerBoardObjectTypes();
  scheduleExclusiveJob(ctx, {
    name: 'boards:trash-purge',
    lockKey: TRASH_PURGE_LOCK_KEY,
    intervalMs: 60 * 60 * 1000,
    run: async () => {
      const n = await purgeExpiredTrashLocked();
      if (n > 0) log(`boards: purged ${n} board(s) from the trash`);
    },
  });
  // Share links that just expired (KAI-145): their link-only visitors are disconnected.
  scheduleExclusiveJob(ctx, {
    name: 'boards:link-expiry',
    lockKey: LINK_EXPIRY_LOCK_KEY,
    intervalMs: 10_000,
    run: async () => {
      const n = await applyExpiredLinks();
      if (n > 0) log(`boards: ${n} share link(s) expired`);
    },
  });
}
