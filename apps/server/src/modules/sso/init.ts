import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { onSignInRestriction } from '../auth/index';
import { enforcedSsoRestriction } from './policy';
import * as repo from './repo';

const CLEANUP_LOCK_KEY = 7_202_610_301; // arbitrary, constant across releases

export default function initSso(ctx: ServerContext): void {
  // "Enforce SSO": every way of signing in asks auth, auth asks here.
  const stop = onSignInRestriction(enforcedSsoRestriction);
  ctx.onShutdown(() => void stop());
  // Sign-ins nobody finished, requests nobody answered, assertion IDs past their validity.
  scheduleExclusiveJob(ctx, {
    name: 'sso:cleanup',
    lockKey: CLEANUP_LOCK_KEY,
    intervalMs: 15 * 60_000,
    run: () => repo.deleteExpired(Date.now()),
  });
}
