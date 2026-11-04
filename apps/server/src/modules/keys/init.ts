// Workspace keys in the app: other instances' state changes (pubsub), the `keys:check` probe (a key
// revoked at its KMS becomes unavailable even while data keys are cached; one that answers again
// becomes active) and the `keys:seal` job (content stored before the key, under an older data key
// or another workspace's key is sealed again). Both jobs are idempotent, one instance at a time.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { checkKeys, listenForKeyChanges, sealPendingContent } from './service';

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
}
