// Workspace keys in the app: other instances' state changes (pubsub), the `keys:check` probe (a key
// revoked at its KMS becomes unavailable even while data keys are cached; one that answers again
// becomes active) and the `keys:seal` job (content stored before the key, under an older data key
// or another workspace's key is sealed again). Both jobs are idempotent, one instance at a time.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log, logError } from '../../platform/log';
import { checkKeys, listenForKeyChanges, rewrapInstanceKeys, sealPendingContent } from './service';

export default function initKeys(ctx: ServerContext): void {
  const stop = listenForKeyChanges();
  ctx.onShutdown(async () => stop());
  // Half the cache lifetime: a revocation at the KMS takes effect within one cache period.
  scheduleExclusiveJob(ctx, { name: 'keys:check', lockKey: 7_202_611_301, intervalMs: Math.max(5000, ctx.config.workspaceKeys.cacheMs / 2), run: checkKeys });
  scheduleExclusiveJob(ctx, {
    name: 'keys:seal',
    lockKey: 7_202_611_302,
    intervalMs: 60_000,
    run: async () => {
      const n = await sealPendingContent();
      if (n) log(`keys: sealed the stored content of ${n} board(s) with their workspace's current key`);
    },
  });
  // A SESSION_SECRET rotation is settling: instance-wrapped data keys are wrapped again under the
  // current secret in the background (and on use), like the other sealed secrets.
  if (ctx.config.sessionSecretsPrevious.length)
    scheduleExclusiveJob(ctx, {
      name: 'keys:rewrap-instance',
      lockKey: 7_202_611_303,
      intervalMs: 3_600_000,
      run: async () => {
        const { rewrapped, unreadable } = await rewrapInstanceKeys();
        if (rewrapped) log(`keys: wrapped ${rewrapped} workspace data key(s) again under the current SESSION_SECRET`);
        if (unreadable) logError(`keys: ${unreadable} workspace data key(s) open with no configured SESSION_SECRET; put the secret they were made with back in SESSION_SECRET_PREVIOUS or their workspaces' content stays unreadable`, null);
        // Repeated every run on purpose: a reminder to finish the rotation.
        log('keys: every readable workspace data key is wrapped under the current SESSION_SECRET; SESSION_SECRET_PREVIOUS can be removed once every instance runs with it');
      },
    });
}
