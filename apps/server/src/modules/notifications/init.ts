import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { onAccessDecided, onAccessRequested, onBoardShared, onInviteAccepted } from '../members/index';
import { onCardAssignment, onCommentMessage } from '../realtime/index';
import * as cards from './cards';
import { cardChangesSettled, commentMessagesHandled, digestRuns } from './metrics';
import * as service from './service';

export const DIGEST_LOCK_KEY = 7_202_610_291; // arbitrary, constant across releases

/** Sources of notifications + the email digest job (scheduled on every instance; one runs). */
export default function initNotifications(ctx: ServerContext): void {
  const stops = [
    // Realtime calls this synchronously while applying the change; the work runs after it.
    onCommentMessage(
      (e) =>
        void service
          .onCommentMessage(e)
          .catch((err) => logError('notifications: comment notification failed', err))
          .finally(() => commentMessagesHandled.inc()),
    ),
    onBoardShared(service.onBoardShared),
    onInviteAccepted(service.onInviteAccepted),
    onAccessRequested(service.onAccessRequested),
    onAccessDecided(service.onAccessDecided),
    // Task cards (KAI-135): settled for a moment, then the assignee hears about it.
    onCardAssignment((e) => cards.onCardAssignment(e, () => cardChangesSettled.inc())),
  ];
  ctx.onShutdown(async () => {
    stops.forEach((stop) => stop());
    await cards.flushCardNotifications();
  });
  scheduleExclusiveJob(ctx, {
    name: 'notifications:digest',
    lockKey: DIGEST_LOCK_KEY,
    intervalMs: ctx.config.notifyEmailIntervalMs,
    run: async () => {
      await service.sweepPendingMentions();
      // Due-date reminders first, so one due now goes out in this run's digest.
      await cards.sendDueReminders();
      const sent = await service.sendDigests();
      digestRuns.inc();
      return sent;
    },
  });
}
