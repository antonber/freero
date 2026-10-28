import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { onAccessDecided, onAccessRequested, onBoardShared, onInviteAccepted } from '../members/index';
import { onCommentMessage } from '../realtime/index';
import * as service from './service';

export const DIGEST_LOCK_KEY = 7_202_610_291; // arbitrary, constant across releases

/** Sources of notifications + the email digest job (scheduled on every instance; one runs). */
export default function initNotifications(ctx: ServerContext): void {
  const stops = [
    // Realtime calls this synchronously while applying the change; the work runs after it.
    onCommentMessage((e) => void service.onCommentMessage(e).catch((err) => logError('notifications: comment notification failed', err))),
    onBoardShared(service.onBoardShared),
    onInviteAccepted(service.onInviteAccepted),
    onAccessRequested(service.onAccessRequested),
    onAccessDecided(service.onAccessDecided),
  ];
  ctx.onShutdown(() => stops.forEach((stop) => stop()));
  scheduleExclusiveJob(ctx, {
    name: 'notifications:digest',
    lockKey: DIGEST_LOCK_KEY,
    intervalMs: ctx.config.notifyEmailIntervalMs,
    run: async () => {
      await service.sweepPendingMentions();
      return service.sendDigests();
    },
  });
}
