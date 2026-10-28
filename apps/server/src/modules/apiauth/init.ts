// Credentials end with the account's sessions when it is signed out everywhere (a reset, "this
// wasn't me", recovery, suspension, deletion, a directory deprovisioning it), and expired codes,
// tokens and abandoned self-registered apps are cleared hourly (one instance at a time).
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import * as repo from './repo';
import { connectRevocation } from './wiring';

const CLEANUP_LOCK_KEY = 7_202_611_021; // arbitrary, constant across releases
const ABANDONED_CLIENT_MS = 7 * 86_400_000;

export default function initApiAuth(ctx: ServerContext): void {
  ctx.onShutdown(connectRevocation());
  scheduleExclusiveJob(ctx, {
    name: 'apiauth:cleanup',
    lockKey: CLEANUP_LOCK_KEY,
    intervalMs: 3_600_000,
    firstRunMs: 60_000,
    run: async () => {
      const now = Date.now();
      await repo.deleteExpired(now);
      await repo.deleteUnusedDynamicClients(now - ABANDONED_CLIENT_MS);
    },
  });
}
