import { guestDisplayName, isGuestId } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { getGuests, getUser } from '../auth/index';
import { onAccessDecided, onBoardShared } from '../members/index';
import { onBoardChange, onCommentMessage } from '../realtime/index';
import * as service from './service';

const PRUNE_LOCK_KEY = 7_202_610_302; // arbitrary, constant across releases
/** How often ended bursts are written (each instance writes its own sockets' bursts). */
const FLUSH_EVERY_MS = 15_000;

/** The activity feed's sources (trusted server events), its burst writer and retention. */
export default function initActivity(ctx: ServerContext): void {
  const stops = [
    onBoardChange((e) => service.recordChanges(e)),
    // Realtime calls this synchronously; the author's name is looked up after (guests have no account).
    onCommentMessage((e) => {
      if (e.previousText !== null) return;
      const name = isGuestId(e.authorId)
        ? getGuests([e.authorId]).then((g) => guestDisplayName(g.get(e.authorId)?.name ?? 'visitor'))
        : getUser(e.authorId).then((u) => u?.name ?? 'Someone');
      void name.then((n) => service.recordComment(e, n)).catch((err) => logError('activity: could not record a comment', err));
    }),
    onBoardShared((e) => service.onBoardShared(e)),
    onAccessDecided((e) => service.onAccessDecided(e)),
  ];
  const timer = setInterval(() => void service.flushBursts(), FLUSH_EVERY_MS);
  timer.unref();
  ctx.onShutdown(async () => {
    clearInterval(timer);
    stops.forEach((stop) => stop());
    await service.flushBursts(Date.now(), true);
  });
  scheduleExclusiveJob(ctx, { name: 'activity:prune', lockKey: PRUNE_LOCK_KEY, intervalMs: 6 * 3_600_000, run: () => service.pruneOld() });
}
