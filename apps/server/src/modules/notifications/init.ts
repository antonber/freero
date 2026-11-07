import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { onAccessDecided, onAccessRequested, onBoardShared, onInviteAccepted } from '../members/index';
import { onCardAssignment, onCommentMessage } from '../realtime/index';
import * as boardChanges from './boardChanges';
import * as cards from './cards';
import { cardChangesSettled, commentMessagesHandled, digestRuns } from './metrics';
import * as service from './service';

export const DIGEST_LOCK_KEY = 7_202_610_291; // arbitrary, constant across releases

/** One step of the digest job; a failure is logged and the next run tries it again. */
async function step<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    logError(`notifications: ${what} failed; trying again next run`, e);
    return null;
  }
}

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
    await service.slackDeliveriesSettled();
  });
  scheduleExclusiveJob(ctx, {
    name: 'notifications:digest',
    lockKey: DIGEST_LOCK_KEY,
    intervalMs: ctx.config.notifyEmailIntervalMs,
    // Each step on its own: one that fails (logged) never keeps the others' email from going out.
    run: async () => {
      await step('sweeping pending mentions', () => service.sweepPendingMentions());
      // Due-date reminders first, so one due now goes out in this run's digest.
      await step('due-date reminders', () => cards.sendDueReminders());
      const sent = await step('the notification digest', () => service.sendDigests());
      // "Changes on your boards" (opt-in, daily / weekly in each person's time zone).
      await step('"changes on your boards"', () => boardChanges.sendBoardChangeDigests());
      digestRuns.inc();
      return sent;
    },
  });
}
